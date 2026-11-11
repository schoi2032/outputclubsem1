/**
 * WickyChat: the showcase shelf (items pinned on your profile) and your wishlist, which
 * friends see on your profile so they can gift you something.
 */
import { orgMemberships, userItems, users, wishlist } from '@quid/db'
import { SHELF, type Shelf } from '@quid/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, notFound } from '../../core/errors'
import { type App, orgIdParams } from '../../core/http'
import { isItemId } from './contents'

const itemIdSchema = z.string().max(60).refine(isItemId, 'Unknown item')

async function shelfFor(ctx: AppContext, userId: string): Promise<Shelf> {
  const [u, owned, wants] = await Promise.all([
    ctx.db.query.users.findFirst({ where: eq(users.id, userId), columns: { showcase: true } }),
    ctx.db
      .select({ itemId: userItems.itemId, serial: userItems.serial })
      .from(userItems)
      .where(eq(userItems.userId, userId)),
    ctx.db
      .select({ itemId: wishlist.itemId })
      .from(wishlist)
      .where(eq(wishlist.userId, userId))
      .orderBy(asc(wishlist.createdAt)),
  ])
  if (!u) throw notFound('Member')
  const serials = new Map(owned.map((o) => [o.itemId, o.serial]))
  return {
    // Something traded or sold away drops off the shelf on its own.
    showcase: u.showcase
      .filter((id) => serials.has(id))
      .map((itemId) => ({ itemId, serial: serials.get(itemId) ?? null })),
    wishlist: wants.map((w) => w.itemId).filter((id) => !serials.has(id)),
  }
}

export async function profileRoutes(app: App, ctx: AppContext) {
  app.get(
    '/api/orgs/:orgId/members/:id/shelf',
    { schema: { params: orgIdParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const member = await ctx.db.query.orgMemberships.findFirst({
        where: and(
          eq(orgMemberships.orgId, scope.orgId),
          eq(orgMemberships.userId, req.params.id),
          isNull(orgMemberships.deactivatedAt),
        ),
        columns: { id: true },
      })
      if (!member) throw notFound('Member')
      return shelfFor(ctx, req.params.id)
    },
  )

  app.get('/api/me/shelf', async (req) => shelfFor(ctx, requireUser(req).id))

  /** Sets the whole shelf, in order. Only things you own. */
  app.put(
    '/api/me/showcase',
    { schema: { body: z.object({ items: z.array(itemIdSchema).max(SHELF.max) }) } },
    async (req) => {
      const me = requireUser(req)
      const items = [...new Set(req.body.items)]
      if (items.length) {
        const owned = await ctx.db
          .select({ itemId: userItems.itemId })
          .from(userItems)
          .where(and(eq(userItems.userId, me.id), inArray(userItems.itemId, items)))
        if (owned.length !== items.length) throw badRequest('You can only show off things you own.')
      }
      await ctx.db.update(users).set({ showcase: items }).where(eq(users.id, me.id))
      return shelfFor(ctx, me.id)
    },
  )

  app.post(
    '/api/me/wishlist',
    { schema: { body: z.object({ itemId: itemIdSchema }) } },
    async (req) => {
      const me = requireUser(req)
      const cur = await ctx.db
        .select({ itemId: wishlist.itemId })
        .from(wishlist)
        .where(eq(wishlist.userId, me.id))
      if (cur.length >= SHELF.wishlistMax)
        throw badRequest(`Your wishlist is full (${SHELF.wishlistMax} max).`)
      await ctx.db
        .insert(wishlist)
        .values({ userId: me.id, itemId: req.body.itemId })
        .onConflictDoNothing()
      return shelfFor(ctx, me.id)
    },
  )

  app.delete(
    '/api/me/wishlist/:itemId',
    { schema: { params: z.object({ itemId: z.string().max(60) }) } },
    async (req) => {
      const me = requireUser(req)
      await ctx.db
        .delete(wishlist)
        .where(and(eq(wishlist.userId, me.id), eq(wishlist.itemId, req.params.itemId)))
      return shelfFor(ctx, me.id)
    },
  )
}
