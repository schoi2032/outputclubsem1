/**
 * Realtime gateway.
 *
 * The browser fetches a short-lived signed ticket through the web origin
 * (where its session cookie lives), then connects straight to this API's
 * WebSocket URL. Tickets are stateless HMACs so any instance can verify them;
 * single use is enforced per instance within the 30-second validity window.
 */
import { channelMembers, orgMemberships } from '@quid/db'
import type { ClientEvent, ServerEvent } from '@quid/shared'
import { topics } from '@quid/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { WebSocket } from 'ws'
import { requireUser, scopeFor } from '../core/auth'
import type { AppContext } from '../core/context'
import { hmacSha256, randomToken, safeEqual } from '../core/crypto'
import type { App } from '../core/http'
import { getChannelAccess } from '../modules/channels/service'
import { recordActivity } from '../modules/presence/service'

const TICKET_TTL_MS = 30_000
const usedNonces = new Map<string, number>()

function ticketSecret(ctx: AppContext) {
  return hmacSha256(ctx.config.ENCRYPTION_KEY ?? 'quid-dev-only-ticket-secret', 'ws-ticket')
}

export function issueTicket(ctx: AppContext, userId: string) {
  const payload = `${userId}.${Date.now() + TICKET_TTL_MS}.${randomToken(12)}`
  return `${payload}.${hmacSha256(ticketSecret(ctx), payload)}`
}

export function verifyTicket(ctx: AppContext, ticket: string): string | null {
  const parts = ticket.split('.')
  if (parts.length !== 4) return null
  const [userId, exp, nonce, sig] = parts as [string, string, string, string]
  if (!safeEqual(sig, hmacSha256(ticketSecret(ctx), `${userId}.${exp}.${nonce}`))) return null
  if (Number(exp) < Date.now() || usedNonces.has(nonce)) return null
  usedNonces.set(nonce, Number(exp))
  if (usedNonces.size > 10_000) {
    for (const [n, e] of usedNonces) if (e < Date.now()) usedNonces.delete(n)
  }
  return userId
}

class Connection {
  readonly id = uuidv7()
  private readonly subs = new Map<string, () => void>()
  private lastTyping = new Map<string, number>()
  private lastPointer = 0
  private pointerAccess = new Map<string, { ok: boolean; at: number }>()
  alive = true

  constructor(
    private readonly ctx: AppContext,
    readonly socket: WebSocket,
    readonly userId: string,
  ) {}

  send(event: ServerEvent) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(event))
  }

  subscribe(topic: string) {
    if (this.subs.has(topic)) return
    this.subs.set(
      topic,
      this.ctx.bus.subscribe(topic, (e) => this.onEvent(topic, e)),
    )
  }

  unsubscribe(topic: string) {
    this.subs.get(topic)?.()
    this.subs.delete(topic)
  }

  private onEvent(topic: string, e: ServerEvent) {
    // Keep channel subscriptions in sync with membership.
    if (topic === topics.user(this.userId)) {
      if (e.type === 'channel.joined') this.subscribe(topics.channel(e.channel.id))
      if (e.type === 'channel.left') this.unsubscribe(topics.channel(e.channelId))
    }
    // Don't echo a user's own typing or pointer back to them.
    if ((e.type === 'typing' || e.type === 'board.pointer') && e.userId === this.userId) return
    this.send(e)
  }

  async init() {
    this.subscribe(topics.user(this.userId))
    const orgs = await this.ctx.db
      .select({ orgId: orgMemberships.orgId })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.userId, this.userId), isNull(orgMemberships.deactivatedAt)))
    for (const o of orgs) this.subscribe(topics.org(o.orgId))
    const chans = await this.ctx.db
      .select({ channelId: channelMembers.channelId })
      .from(channelMembers)
      .where(eq(channelMembers.userId, this.userId))
    for (const c of chans) this.subscribe(topics.channel(c.channelId))
  }

  async handle(raw: string) {
    let msg: ClientEvent
    try {
      msg = JSON.parse(raw) as ClientEvent
    } catch {
      return
    }
    switch (msg.type) {
      case 'ping':
        this.send({ type: 'pong' })
        return
      case 'activity':
        await recordActivity(this.ctx, this.userId)
        return
      case 'typing': {
        if (typeof msg.channelId !== 'string') return
        const key = `${msg.channelId}:${msg.parentId ?? ''}`
        const now = Date.now()
        if (now - (this.lastTyping.get(key) ?? 0) < 2_500) return
        this.lastTyping.set(key, now)
        const access = await this.access(msg.channelId)
        if (!access?.membership) return
        await this.ctx.bus.publish(topics.channel(msg.channelId), {
          type: 'typing',
          orgId: access.channel.orgId,
          channelId: msg.channelId,
          parentId: typeof msg.parentId === 'string' ? msg.parentId : null,
          userId: this.userId,
        })
        return
      }
      case 'board.pointer': {
        // Live cursors on whiteboards: frequent, so throttled and with a short access cache.
        if (typeof msg.channelId !== 'string' || typeof msg.canvasId !== 'string') return
        if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y) || msg.canvasId.length > 64) return
        const now = Date.now()
        if (now - this.lastPointer < 40 && !msg.gone) return
        this.lastPointer = now
        const cached = this.pointerAccess.get(msg.channelId)
        let ok = cached && now - cached.at < 30_000 ? cached.ok : undefined
        if (ok === undefined) {
          ok = !!(await this.access(msg.channelId))?.membership
          this.pointerAccess.set(msg.channelId, { ok, at: now })
        }
        if (!ok) return
        await this.ctx.bus.publish(topics.channel(msg.channelId), {
          type: 'board.pointer',
          channelId: msg.channelId,
          canvasId: msg.canvasId,
          userId: this.userId,
          x: msg.x,
          y: msg.y,
          button: msg.button === 'down' ? 'down' : 'up',
          ...(msg.gone && { gone: true }),
        })
        return
      }
      case 'subscribe': {
        // Lets people preview public channels they haven't joined, live.
        if (typeof msg.channelId !== 'string') return
        if (await this.access(msg.channelId)) this.subscribe(topics.channel(msg.channelId))
        return
      }
      case 'unsubscribe':
        // Members stay subscribed so their unread counts keep updating.
        if (typeof msg.channelId === 'string') {
          const a = await this.access(msg.channelId)
          if (!a?.membership) this.unsubscribe(topics.channel(msg.channelId))
        }
        return
    }
  }

  private async access(channelId: string) {
    const ch = await this.ctx.db.query.channels.findFirst({
      where: (c, { eq }) => eq(c.id, channelId),
      columns: { orgId: true },
    })
    if (!ch) return null
    const scope = await scopeFor(this.ctx, ch.orgId, this.userId)
    if (!scope) return null
    return getChannelAccess(this.ctx, scope, channelId).catch(() => null)
  }

  close() {
    for (const off of this.subs.values()) off()
    this.subs.clear()
  }
}

export async function registerGateway(app: App, ctx: AppContext) {
  app.get('/api/realtime/ticket', async (req) => {
    const me = requireUser(req)
    return { ticket: issueTicket(ctx, me.id), url: ctx.config.PUBLIC_WS_URL }
  })

  const connections = new Set<Connection>()
  const heartbeat = setInterval(() => {
    for (const c of connections) {
      if (!c.alive) {
        c.socket.terminate()
        continue
      }
      c.alive = false
      c.socket.ping()
    }
  }, 30_000)
  heartbeat.unref()
  app.addHook('onClose', async () => clearInterval(heartbeat))

  app.get('/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin
    if (origin && !ctx.config.allowedOrigins.includes(origin)) {
      socket.close(4003, 'Origin not allowed')
      return
    }
    const ticket = new URL(req.url, 'http://x').searchParams.get('ticket') ?? ''
    const userId = verifyTicket(ctx, ticket)
    if (!userId) {
      socket.close(4001, 'Invalid ticket')
      return
    }

    const conn = new Connection(ctx, socket, userId)
    connections.add(conn)
    // Buffer messages that arrive before subscriptions are ready.
    const pending: string[] = []
    let ready = false
    socket.on('message', (data) => {
      const raw = data.toString()
      if (raw.length > 4096) return
      if (!ready) pending.push(raw)
      else void conn.handle(raw).catch((err) => ctx.log.warn({ err }, 'ws message failed'))
    })
    socket.on('pong', () => {
      conn.alive = true
    })
    socket.on('close', () => {
      connections.delete(conn)
      conn.close()
      ctx.online.disconnect(userId)
    })

    void conn
      .init()
      .then(async () => {
        ready = true
        ctx.online.connect(userId)
        conn.send({ type: 'hello', userId, connectionId: conn.id })
        for (const raw of pending) await conn.handle(raw)
      })
      .catch((err) => {
        ctx.log.error({ err }, 'ws init failed')
        socket.close(1011, 'Initialization failed')
      })
  })
}
