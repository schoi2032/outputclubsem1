/**
 * Fan-out of realtime events between API instances.
 *
 * The in-memory bus is enough for a single instance. With more than one API
 * instance, set EVENT_BUS=redis so every instance sees every event.
 */
import type { ServerEvent } from '@quid/shared'

export type Handler = (event: ServerEvent) => void

export interface EventBus {
  publish(topics: string | string[], event: ServerEvent): Promise<void>
  subscribe(topic: string, handler: Handler): () => void
  close(): Promise<void>
}

class LocalRegistry {
  private readonly handlers = new Map<string, Set<Handler>>()

  add(topic: string, handler: Handler): { unsubscribe: () => void; first: boolean } {
    let set = this.handlers.get(topic)
    const first = !set
    if (!set) {
      set = new Set()
      this.handlers.set(topic, set)
    }
    set.add(handler)
    return {
      first,
      unsubscribe: () => {
        set.delete(handler)
        if (set.size === 0) this.handlers.delete(topic)
      },
    }
  }

  has(topic: string) {
    return this.handlers.has(topic)
  }

  dispatch(topic: string, event: ServerEvent) {
    for (const h of this.handlers.get(topic) ?? []) {
      try {
        h(event)
      } catch {
        // A broken subscriber must not affect others.
      }
    }
  }
}

export class MemoryEventBus implements EventBus {
  private readonly registry = new LocalRegistry()

  async publish(topics: string | string[], event: ServerEvent) {
    for (const t of Array.isArray(topics) ? topics : [topics]) this.registry.dispatch(t, event)
  }

  subscribe(topic: string, handler: Handler) {
    return this.registry.add(topic, handler).unsubscribe
  }

  async close() {}
}

export class RedisEventBus implements EventBus {
  private readonly registry = new LocalRegistry()

  private constructor(
    private readonly pub: import('ioredis').Redis,
    private readonly sub: import('ioredis').Redis,
  ) {
    sub.on('message', (topic: string, raw: string) => {
      try {
        this.registry.dispatch(topic, JSON.parse(raw) as ServerEvent)
      } catch {
        // ignore malformed payloads
      }
    })
  }

  static async connect(url: string): Promise<RedisEventBus> {
    const { Redis } = await import('ioredis')
    return new RedisEventBus(new Redis(url), new Redis(url))
  }

  async publish(topics: string | string[], event: ServerEvent) {
    const payload = JSON.stringify(event)
    const list = Array.isArray(topics) ? topics : [topics]
    await Promise.all(list.map((t) => this.pub.publish(t, payload)))
  }

  subscribe(topic: string, handler: Handler) {
    const { first, unsubscribe } = this.registry.add(topic, handler)
    if (first) void this.sub.subscribe(topic)
    return () => {
      unsubscribe()
      if (!this.registry.has(topic)) void this.sub.unsubscribe(topic)
    }
  }

  async close() {
    await Promise.all([this.pub.quit(), this.sub.quit()])
  }
}

/**
 * Postgres LISTEN/NOTIFY fan-out, so WickyChat on Vercel (many short-lived instances) needs
 * no Redis. NOTIFY payloads are capped near 8 kB, so bigger events go through a small table
 * and only their id is sent.
 */
export class PostgresEventBus implements EventBus {
  private readonly registry = new LocalRegistry()
  private static readonly CHANNEL = 'wickychat_events'
  private static readonly INLINE_LIMIT = 7000
  private cleanup: ReturnType<typeof setInterval> | null = null

  private constructor(private readonly sql: import('postgres').Sql) {}

  static async connect(url: string): Promise<PostgresEventBus> {
    const { default: postgres } = await import('postgres')
    const sql = postgres(url, { max: 2, idle_timeout: 0, onnotice: () => {} })
    const bus = new PostgresEventBus(sql)
    await sql`create table if not exists realtime_events (
      id bigserial primary key,
      payload text not null,
      created_at timestamptz not null default now()
    )`
    await sql.listen(PostgresEventBus.CHANNEL, (raw) => void bus.receive(raw))
    bus.cleanup = setInterval(() => {
      void sql`delete from realtime_events where created_at < now() - interval '10 minutes'`.catch(
        () => {},
      )
    }, 60_000)
    bus.cleanup.unref()
    return bus
  }

  private async receive(raw: string) {
    try {
      let msg = raw
      if (raw.startsWith('#')) {
        const rows = await this.sql<{ payload: string }[]>`
          select payload from realtime_events where id = ${raw.slice(1)}`
        if (!rows[0]) return
        msg = rows[0].payload
      }
      const { t, e } = JSON.parse(msg) as { t: string[]; e: ServerEvent }
      for (const topic of t) this.registry.dispatch(topic, e)
    } catch {
      // ignore malformed payloads
    }
  }

  async publish(topics: string | string[], event: ServerEvent) {
    const payload = JSON.stringify({ t: Array.isArray(topics) ? topics : [topics], e: event })
    if (Buffer.byteLength(payload) <= PostgresEventBus.INLINE_LIMIT) {
      await this.sql.notify(PostgresEventBus.CHANNEL, payload)
      return
    }
    const [row] = await this.sql<{ id: string }[]>`
      insert into realtime_events (payload) values (${payload}) returning id`
    await this.sql.notify(PostgresEventBus.CHANNEL, `#${row!.id}`)
  }

  subscribe(topic: string, handler: Handler) {
    return this.registry.add(topic, handler).unsubscribe
  }

  async close() {
    if (this.cleanup) clearInterval(this.cleanup)
    await this.sql.end({ timeout: 5 })
  }
}
