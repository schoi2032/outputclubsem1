/**
 * Automatic safety checks every plugin passes before anyone can install it.
 * Plugins run on their developers' servers, so no plugin code ever runs inside
 * WickyChat or in people's browsers; these checks cover what WickyChat does receive.
 */
import { randomBytes } from 'node:crypto'
import { type PluginCheck, plugins } from '@quid/db'
import { eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context'
import { assertPublicUrl } from '../integrations/outgoing'
import { callPlugin, type PluginRow } from './client'

const MAX_ICON = 512 * 1024

/** PNG, JPEG, WebP or GIF by magic bytes. SVG is refused (it can carry scripts). */
export function imageType(b: Buffer): string | null {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp'
  if (
    b.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    b.subarray(0, 6).toString('ascii') === 'GIF89a'
  )
    return 'image/gif'
  return null
}

async function safeBrowsing(ctx: AppContext, urls: string[]): Promise<PluginCheck> {
  const key = ctx.config.SAFE_BROWSING_API_KEY
  const base = { id: 'reputation', label: 'Not on malware or phishing lists' }
  if (!key)
    return {
      ...base,
      status: 'skipped',
      detail: 'Google Safe Browsing is not configured on this server.',
    }
  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'quid', clientVersion: '1.0' },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
              'POTENTIALLY_HARMFUL_APPLICATION',
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: urls.map((url) => ({ url })),
          },
        }),
      },
    )
    const json = (await res.json()) as { matches?: unknown[] }
    if (!res.ok) return { ...base, status: 'skipped', detail: `Lookup failed (${res.status}).` }
    return json.matches?.length
      ? {
          ...base,
          status: 'failed',
          detail: 'A URL is listed as dangerous by Google Safe Browsing.',
        }
      : { ...base, status: 'passed' }
  } catch {
    return { ...base, status: 'skipped', detail: 'Lookup timed out.' }
  }
}

/** Runs every check, stores the icon, and sets the plugin's status. */
export async function runChecks(
  ctx: AppContext,
  plugin: PluginRow,
  iconUrl: string | null,
): Promise<PluginCheck[]> {
  const allowLocal = ctx.config.NODE_ENV !== 'production'
  const checks: PluginCheck[] = []

  // 1. The server address is HTTPS and public (not a private or internal network).
  try {
    await assertPublicUrl(plugin.manifest.baseUrl, allowLocal)
    checks.push({ id: 'address', label: 'Secure, public server address', status: 'passed' })
  } catch (e) {
    checks.push({
      id: 'address',
      label: 'Secure, public server address',
      status: 'failed',
      detail: (e as Error).message,
    })
  }

  // 2. The developer controls that server: it must echo a one-time challenge, signed with the plugin secret.
  if (checks[0]!.status === 'passed') {
    const challenge = randomBytes(16).toString('hex')
    try {
      const r = await callPlugin<{ challenge?: string }>(ctx, plugin, 'verify', {
        type: 'url_verification',
        challenge,
      })
      checks.push(
        r?.challenge === challenge
          ? { id: 'ownership', label: 'Developer controls the server', status: 'passed' }
          : {
              id: 'ownership',
              label: 'Developer controls the server',
              status: 'failed',
              detail: "The server didn't echo the challenge.",
            },
      )
    } catch (e) {
      checks.push({
        id: 'ownership',
        label: 'Developer controls the server',
        status: 'failed',
        detail: (e as Error).message,
      })
    }
  } else {
    checks.push({
      id: 'ownership',
      label: 'Developer controls the server',
      status: 'failed',
      detail: 'Skipped: the address is not allowed.',
    })
  }

  // 3. The icon is a real, small image (copied into WickyChat so it's never loaded from the developer's server).
  if (iconUrl) {
    const label = 'Icon is a safe image'
    try {
      await assertPublicUrl(iconUrl, allowLocal)
      const res = await fetch(iconUrl, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`Icon request failed (${res.status})`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_ICON) throw new Error('Icon is larger than 512 KB')
      const type = imageType(buf)
      if (!type) throw new Error('Icon must be PNG, JPEG, WebP or GIF')
      const key = `plugins/${plugin.id}/icon`
      await ctx.storage.put(key, buf, type)
      await ctx.db.update(plugins).set({ iconKey: key }).where(eq(plugins.id, plugin.id))
      checks.push({ id: 'icon', label, status: 'passed' })
    } catch (e) {
      checks.push({ id: 'icon', label, status: 'failed', detail: (e as Error).message })
    }
  } else {
    checks.push({
      id: 'icon',
      label: 'Icon is a safe image',
      status: 'skipped',
      detail: 'No icon; a default one is used.',
    })
  }

  // 4. Listing text doesn't pretend to be WickyChat or contain links/markup.
  const text = `${plugin.name} ${plugin.tagline}`
  const impersonates =
    /\b(quid (team|official|staff)|official quid|verified|official)\b/i.test(text) ||
    // Only WickyChat's own plugins carry the WickyChat name.
    /\bquid\b/i.test(`${plugin.name} ${plugin.developerName}`)
  const markup = /<[^>]+>|https?:\/\//i.test(text)
  checks.push(
    impersonates || markup
      ? {
          id: 'listing',
          label: 'Listing text is honest and plain',
          status: 'failed',
          detail: impersonates
            ? 'The name or tagline claims to be official or verified.'
            : 'The name or tagline contains links or HTML.',
        }
      : { id: 'listing', label: 'Listing text is honest and plain', status: 'passed' },
  )

  // 5. None of its addresses are known to be dangerous.
  checks.push(
    await safeBrowsing(
      ctx,
      [plugin.manifest.baseUrl, plugin.homepageUrl, iconUrl].filter((u): u is string => !!u),
    ),
  )

  const failed = checks.some((c) => c.status === 'failed')
  // Verified plugins keep their status when re-checked and passing; anything failing goes back to pending.
  const status = failed
    ? 'pending'
    : plugin.status === 'verified'
      ? 'verified'
      : plugin.status === 'suspended'
        ? 'suspended'
        : 'unverified'
  await ctx.db
    .update(plugins)
    .set({ checks, status, updatedAt: new Date() })
    .where(eq(plugins.id, plugin.id))
  return checks
}
