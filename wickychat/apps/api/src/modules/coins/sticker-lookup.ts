/** WickyChat: turns sticker keys into what the app draws. */
import { stickers } from '@quid/db'
import { builtinSticker, type Sticker } from '@quid/shared'
import { inArray } from 'drizzle-orm'
import type { AppContext } from '../../core/context'
import { avatarUrl } from '../users/serialize'

const CUSTOM = /^u:([0-9a-f-]{36})$/

export async function resolveStickers(
  db: AppContext['db'],
  keys: string[],
): Promise<Map<string, Sticker>> {
  const out = new Map<string, Sticker>()
  const ids: string[] = []
  for (const k of new Set(keys)) {
    const b = builtinSticker(k)
    if (b) out.set(k, b)
    const m = CUSTOM.exec(k)
    if (m) ids.push(m[1]!)
  }
  if (ids.length) {
    const rows = await db
      .select({ id: stickers.id, name: stickers.name, fileId: stickers.fileId })
      .from(stickers)
      .where(inArray(stickers.id, ids))
    for (const r of rows)
      out.set(`u:${r.id}`, { key: `u:${r.id}`, name: r.name, url: avatarUrl(r.fileId, true) ?? '' })
  }
  return out
}
