/**
 * Lists WickyChat's own plugins (apps/plugins) in the directory as verified and official.
 * Each plugin's signing secret is derived from OFFICIAL_PLUGINS_KEY, so the plugin
 * service knows it without the secret ever being copied around.
 */
import { plugins } from '@quid/db'
import { OFFICIAL_PLUGINS } from '@quid/shared'
import { eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context'
import { hmacSha256 } from '../../core/crypto'
import { onTick } from '../../core/jobs'
import { imageType } from './checks'

export const officialSecret = (key: string, slug: string) =>
  `qps_${hmacSha256(key, `plugin:${slug}`)}`

let synced = false

/** Creates or refreshes the official plugins. Returns false if the plugin service wasn't reachable. */
export async function syncOfficialPlugins(ctx: AppContext): Promise<boolean> {
  const { OFFICIAL_PLUGINS_URL: url, OFFICIAL_PLUGINS_KEY: key } = ctx.config
  if (!url || !key) return true
  const base = url.replace(/\/$/, '')
  const contact =
    ctx.config.PLATFORM_ADMIN_EMAILS.split(',')
      .map((e) => e.trim())
      .find(Boolean) ?? 'plugins@quid.invalid'
  let ok = true
  for (const def of OFFICIAL_PLUGINS) {
    const existing = await ctx.db.query.plugins.findFirst({ where: eq(plugins.slug, def.slug) })
    if (existing && !existing.official) {
      ctx.log.warn({ slug: def.slug }, 'a community plugin already uses an official slug')
      continue
    }
    const fields = {
      name: def.name,
      tagline: def.tagline,
      description: def.description,
      developerName: 'WickyChat',
      developerEmail: contact,
      homepageUrl: `${ctx.config.WEB_ORIGIN}/pricing`,
      manifest: { baseUrl: `${base}/${def.slug}`, commands: def.commands, events: def.events },
      ...(() => {
        const enc = ctx.secrets.encrypt(officialSecret(key, def.slug))
        return { secretCiphertext: enc.ciphertext, secretIv: enc.iv, secretTag: enc.tag }
      })(),
      official: true,
      updatedAt: new Date(),
    }
    // A plugin the WickyChat team suspended stays suspended.
    const [row] = existing
      ? await ctx.db.update(plugins).set(fields).where(eq(plugins.id, existing.id)).returning()
      : await ctx.db
          .insert(plugins)
          .values({ ...fields, slug: def.slug, status: 'verified', reviewedAt: new Date() })
          .returning()
    if (row && !row.iconKey) {
      try {
        const res = await fetch(`${base}/icons/${def.slug}.png`, {
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) throw new Error(`icon ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        const type = imageType(buf)
        if (!type) throw new Error('icon is not an image')
        const iconKey = `plugins/${row.id}/icon`
        await ctx.storage.put(iconKey, buf, type)
        await ctx.db.update(plugins).set({ iconKey }).where(eq(plugins.id, row.id))
      } catch (e) {
        ok = false
        ctx.log.warn({ slug: def.slug, err: (e as Error).message }, 'official plugin icon')
      }
    }
  }
  return ok
}

/** Syncs at startup, then retries every tick until the plugin service has answered once. */
export function scheduleOfficialPluginSync(ctx: AppContext) {
  const attempt = async () => {
    if (synced) return
    try {
      synced = await syncOfficialPlugins(ctx)
    } catch (e) {
      ctx.log.warn({ err: (e as Error).message }, 'official plugin sync failed')
    }
  }
  onTick(attempt)
  void attempt()
}
