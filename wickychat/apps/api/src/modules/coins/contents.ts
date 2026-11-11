/**
 * WickyChat: what students can put in their crates and bundles: their own approved cosmetics
 * that are for sale, and Shop items (seasonal ones only while their event is on).
 */
import { cosmetics } from '@quid/db'
import { builtinItem, sellableBuiltin } from '@quid/shared'
import { and, eq, inArray } from 'drizzle-orm'
import type { OrgScope } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest } from '../../core/errors'

type Db = AppContext['db']
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export const CUSTOM_ITEM = /^u:([0-9a-f-]{36})$/

/** Item ids that are either a Shop item or `u:<cosmetic id>`. */
export const isItemId = (s: string) => CUSTOM_ITEM.test(s) || !!builtinItem(s)

export async function checkContents(db: Db | Tx, scope: OrgScope, items: string[], what: string) {
  for (const i of items) {
    if (CUSTOM_ITEM.test(i)) continue
    if (!builtinItem(i)) throw badRequest(`Unknown item: ${i}`)
    if (!sellableBuiltin(i))
      throw badRequest(`Seasonal items can only go in a ${what} while their event is on.`)
  }
  const ids = items.map((i) => CUSTOM_ITEM.exec(i)?.[1]).filter((x): x is string => !!x)
  if (!ids.length) return
  const mine = await db
    .select({ id: cosmetics.id })
    .from(cosmetics)
    .where(
      and(
        inArray(cosmetics.id, ids),
        eq(cosmetics.orgId, scope.orgId),
        eq(cosmetics.creatorId, scope.userId),
        eq(cosmetics.status, 'approved'),
        eq(cosmetics.visibility, 'public'),
      ),
    )
  if (mine.length !== ids.length)
    throw badRequest(
      `A ${what} can hold Shop items and your own approved cosmetics that are for sale, not other people's.`,
    )
}

/** Seasonal Shop items in it whose event is over: it can't be sold until the event is back. */
export const outOfSeason = (items: string[]) =>
  items.filter((i) => !CUSTOM_ITEM.test(i) && !sellableBuiltin(i))
