/** Talking to WickyChat: checking its signatures and posting messages back. */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const hmac = (key: string, data: string) =>
  createHmac('sha256', key).update(data).digest('hex')

/** Each plugin's signing secret, derived the same way the WickyChat API does (plugins/official.ts). */
export const pluginSecret = (key: string, slug: string) => `qps_${hmac(key, `plugin:${slug}`)}`

export function validSignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: string,
  now = Date.now(),
) {
  if (!timestamp || !signature?.startsWith('sha256=')) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false
  const want = Buffer.from(`sha256=${hmac(secret, `${timestamp}.${rawBody}`)}`)
  const got = Buffer.from(signature)
  return want.length === got.length && timingSafeEqual(want, got)
}

export interface Install {
  installId: string
  plugin: string
  token: string
  apiBase: string
}

export type Poster = (
  install: Install,
  channelId: string,
  text: string,
  threadId?: string | null,
) => Promise<void>

/** Posts as the plugin's bot in a channel it was added to. */
export const postMessage: Poster = async (install, channelId, text, threadId = null) => {
  const res = await fetch(`${install.apiBase}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${install.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, text, threadId }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`WickyChat answered ${res.status}`)
}
