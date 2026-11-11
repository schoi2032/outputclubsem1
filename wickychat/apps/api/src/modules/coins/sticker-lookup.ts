/** WickyChat: turns sticker keys into what the app draws. */
import { stickerPacks, stickers, userStickerPacks } from '@quid/db'
import { builtinSticker, type Sticker, stickerPackById } from '@quid/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
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

/** Do you have the pack this sticker is from (or did you make it)? */
export async function canUseSticker(
  db: AppContext['db'],
  scope: { orgId: string; userId: string },
  key: string,
) {
  const has = async (packKey: string) =>
    !!(await db.query.userStickerPacks.findFirst({
      where: and(eq(userStickerPacks.userId, scope.userId), eq(userStickerPacks.packKey, packKey)),
      columns: { userId: true },
    }))
  const b = /^b:([a-z0-9-]+):/.exec(key)
  if (b) {
    const pack = stickerPackById(b[1]!)
    return !!pack && !!builtinSticker(key) && (pack.price === 0 || (await has(`b:${pack.id}`)))
  }
  const [row] = await db
    .select({
      packId: stickers.packId,
      creatorId: stickerPacks.creatorId,
      status: stickerPacks.status,
      orgId: stickerPacks.orgId,
    })
    .from(stickers)
    .innerJoin(stickerPacks, eq(stickerPacks.id, stickers.packId))
    .where(sql`'u:' || ${stickers.id}::text = ${key}`)
  return (
    !!row &&
    row.orgId === scope.orgId &&
    row.status !== 'rejected' &&
    (row.creatorId === scope.userId || (await has(row.packId)))
  )
}
