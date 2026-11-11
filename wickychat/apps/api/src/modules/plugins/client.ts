/** Signed HTTPS calls from WickyChat to a plugin's server. */
import type { plugins } from '@quid/db'
import type { AppContext } from '../../core/context'
import { hmacSha256 } from '../../core/crypto'
import { assertPublicUrl } from '../integrations/outgoing'

export type PluginRow = typeof plugins.$inferSelect

export const pluginSecret = (ctx: AppContext, p: PluginRow) =>
  ctx.secrets.decrypt({ ciphertext: p.secretCiphertext, iv: p.secretIv, tag: p.secretTag })

/** Plugins can be used only while they're live. */
export const pluginActive = (p: Pick<PluginRow, 'status'>) =>
  p.status === 'verified' || p.status === 'unverified'

/**
 * POSTs JSON to {baseUrl}/quid/{path}, signed like WickyChat webhooks:
 * x-quid-signature = sha256=HMAC(secret, `${timestamp}.${body}`).
 * Returns the parsed JSON response (or null), and throws on network errors, timeouts and non-2xx.
 */
export async function callPlugin<T = unknown>(
  ctx: AppContext,
  plugin: PluginRow,
  path: 'verify' | 'install' | 'uninstall' | 'command',
  payload: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<T | null> {
  const url = `${plugin.manifest.baseUrl.replace(/\/$/, '')}/quid/${path}`
  await assertPublicUrl(url, ctx.config.NODE_ENV !== 'production')
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      'user-agent': 'WickyChat-Plugins/1.0',
      'x-quid-timestamp': timestamp,
      'x-quid-signature': `sha256=${hmacSha256(pluginSecret(ctx, plugin), `${timestamp}.${body}`)}`,
    },
    body,
  })
  if (!res.ok) throw new Error(`Plugin responded with ${res.status}`)
  const text = await res.text()
  if (text.length > 64 * 1024) throw new Error('Plugin response is too large')
  try {
    return text ? (JSON.parse(text) as T) : null
  } catch {
    throw new Error('Plugin returned invalid JSON')
  }
}
