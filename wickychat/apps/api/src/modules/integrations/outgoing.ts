/**
 * Outgoing webhooks: signed HTTP callbacks to external systems when events
 * happen in WickyChat. Delivery runs through the job queue with retries.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  channels,
  integrationCredentials,
  integrations,
  plugins,
  webhookDeliveries,
} from '@quid/db'
import { and, eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context'
import { hmacSha256 } from '../../core/crypto'
import { enqueue, registerJob } from '../../core/jobs'

export async function enqueueOutgoingWebhooks(
  ctx: AppContext,
  orgId: string,
  event: string,
  payload: { channelId: string } & Record<string, unknown>,
) {
  const hooks = await ctx.db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.orgId, orgId),
        eq(integrations.kind, 'outgoing_webhook'),
        eq(integrations.enabled, true),
      ),
    )
  if (!hooks.length) return

  const channel = await ctx.db.query.channels.findFirst({
    where: eq(channels.id, payload.channelId),
    columns: { kind: true },
  })
  for (const h of hooks) {
    const cfg = h.config as { events?: string[]; channelIds?: string[] }
    if (!cfg.events?.includes(event)) continue
    const listed = cfg.channelIds?.length ? cfg.channelIds.includes(payload.channelId) : false
    // Private conversations only leave WickyChat when an admin explicitly listed the channel.
    if (!listed && (cfg.channelIds?.length || channel?.kind !== 'public')) continue
    const [d] = await ctx.db
      .insert(webhookDeliveries)
      .values({
        orgId,
        integrationId: h.id,
        event,
        payload: { event, orgId, ...payload },
        status: 'pending',
      })
      .returning({ id: webhookDeliveries.id })
    await enqueue(ctx, 'webhook.deliver', { deliveryId: d!.id })
  }
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
]

/** Blocks webhook targets on private networks (SSRF protection). */
export async function assertPublicUrl(raw: string, allowLocal: boolean) {
  const url = new URL(raw)
  if (allowLocal) return
  if (url.protocol !== 'https:') throw new Error('Webhook URLs must use https')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  for (const a of addrs) {
    if (
      PRIVATE_V4.some((r) => r.test(a)) ||
      a === '::1' ||
      /^f[cd]/i.test(a) ||
      /^fe80/i.test(a) ||
      a.startsWith('::ffff:')
    ) {
      throw new Error('Webhook URL resolves to a private address')
    }
  }
}

registerJob('webhook.deliver', async (ctx, payload) => {
  const delivery = await ctx.db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, String(payload.deliveryId)),
  })
  if (!delivery || delivery.status === 'delivered') return
  const hook = await ctx.db.query.integrations.findFirst({
    where: eq(integrations.id, delivery.integrationId),
  })
  if (!hook?.enabled) return
  if (hook.kind === 'plugin') {
    // Suspended or removed plugins stop receiving events at once.
    const p = await ctx.db.query.plugins.findFirst({
      where: eq(plugins.id, String((hook.config as { pluginId?: string }).pluginId)),
      columns: { status: true },
    })
    if (p?.status !== 'verified' && p?.status !== 'unverified') return
  }
  const url = String((hook.config as { url?: string }).url ?? '')
  const cred = await ctx.db.query.integrationCredentials.findFirst({
    where: eq(integrationCredentials.integrationId, hook.id),
  })
  const secret = cred ? ctx.secrets.decrypt(cred) : ''

  await assertPublicUrl(url, ctx.config.NODE_ENV !== 'production')
  const body = JSON.stringify(delivery.payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'content-type': 'application/json',
      'user-agent': 'WickyChat-Webhooks/1.0',
      'x-quid-event': delivery.event,
      'x-quid-delivery': delivery.id,
      'x-quid-timestamp': timestamp,
      'x-quid-signature': `sha256=${hmacSha256(secret, `${timestamp}.${body}`)}`,
    },
    body,
  })
  await ctx.db
    .update(webhookDeliveries)
    .set({
      attempts: delivery.attempts + 1,
      responseStatus: res.status,
      status: res.ok ? 'delivered' : 'pending',
      deliveredAt: res.ok ? new Date() : null,
    })
    .where(eq(webhookDeliveries.id, delivery.id))
  if (!res.ok) throw new Error(`Webhook responded with ${res.status}`)
})
