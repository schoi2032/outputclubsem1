/**
 * WickyChat official artists: students apply, a teacher approves them, and then anyone can
 * request custom profile art from them. The request's coins are held until the artist
 * delivers (they get ARTIST.share) or it's declined or cancelled (all coins back).
 */
import {
  artistFollows,
  artists,
  commissions,
  cosmetics,
  organizations,
  userItems,
  users,
} from '@quid/db'
import {
  ARTIST,
  type Artist,
  type ArtistPage,
  type ArtistsPage,
  builtinMakers,
  type Commission,
  censorText,
  SPEC_KINDS,
  topics,
} from '@quid/shared'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { authorize, type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { createNotifications } from '../notifications/service'
import { toUserSummary, userCols } from '../users/serialize'
import { loadWallet, serializeCosmetic, takeCopy } from './routes'
import { changeCoins } from './service'

const isTeacher = (s: OrgScope) => s.role === 'owner' || s.role === 'admin'

async function notify(ctx: AppContext, orgId: string, userId: string, text: string) {
  await ctx.bus.publish(topics.user(userId), { type: 'wicky.updated', orgId, text }).catch(() => {})
}

async function artistRows(
  ctx: AppContext,
  orgId: string,
  where: ReturnType<typeof and>,
  viewerId: string,
) {
  const rows = await ctx.db
    .select({ a: artists, user: userCols })
    .from(artists)
    .innerJoin(users, eq(users.id, artists.userId))
    .where(and(eq(artists.orgId, orgId), where))
  if (!rows.length) return []
  const counts = await ctx.db
    .select({
      artistId: commissions.artistId,
      delivered: sql<number>`count(*) filter (where ${commissions.status} = 'delivered')::int`,
      waiting: sql<number>`count(*) filter (where ${commissions.status} in ('requested', 'accepted'))::int`,
    })
    .from(commissions)
    .where(
      and(
        eq(commissions.orgId, orgId),
        inArray(
          commissions.artistId,
          rows.map((r) => r.a.userId),
        ),
      ),
    )
    .groupBy(commissions.artistId)
  const by = new Map(counts.map((c) => [c.artistId, c]))
  const ids = rows.map((r) => r.a.userId)
  const follows = await ctx.db
    .select({
      artistId: artistFollows.artistId,
      n: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${artistFollows.followerId} = ${viewerId})`,
    })
    .from(artistFollows)
    .where(and(eq(artistFollows.orgId, orgId), inArray(artistFollows.artistId, ids)))
    .groupBy(artistFollows.artistId)
  const fby = new Map(follows.map((f) => [f.artistId, f]))
  return rows.map(
    (r): Artist => ({
      user: toUserSummary(r.user),
      status: r.a.status as Artist['status'],
      bio: r.a.bio,
      open: r.a.open,
      minPrice: r.a.minPrice,
      delivered: Number(by.get(r.a.userId)?.delivered ?? 0),
      waiting: Number(by.get(r.a.userId)?.waiting ?? 0),
      followers: Number(fby.get(r.a.userId)?.n ?? 0),
      following: !!fby.get(r.a.userId)?.mine,
    }),
  )
}

async function commissionsFor(ctx: AppContext, orgId: string, userId: string) {
  const list = await ctx.db
    .select()
    .from(commissions)
    .where(
      and(
        eq(commissions.orgId, orgId),
        or(eq(commissions.requesterId, userId), eq(commissions.artistId, userId)),
      ),
    )
    .orderBy(desc(commissions.id))
    .limit(100)
  const ids = [...new Set(list.flatMap((c) => [c.requesterId, c.artistId]))]
  const people = ids.length
    ? await ctx.db.select(userCols).from(users).where(inArray(users.id, ids))
    : []
  const who = new Map(people.map((p) => [p.id, toUserSummary(p)]))
  const rows = list
    .filter((c) => who.has(c.requesterId) && who.has(c.artistId))
    .map((c) => ({ c, requester: who.get(c.requesterId)!, artist: who.get(c.artistId)! }))
  const out = rows.map(
    (r): Commission => ({
      id: r.c.id,
      requester: r.requester,
      artist: r.artist,
      kind: r.c.kind as Commission['kind'],
      description: r.c.description,
      offer: r.c.offer,
      status: r.c.status as Commission['status'],
      note: r.c.note,
      itemId: r.c.itemId,
      createdAt: r.c.createdAt.toISOString(),
      acceptedAt: r.c.acceptedAt?.toISOString() ?? null,
      deliveredAt: r.c.deliveredAt?.toISOString() ?? null,
    }),
  )
  return {
    sent: out.filter((c) => c.requester.id === userId),
    received: out.filter((c) => c.artist.id === userId),
  }
}

async function page(ctx: AppContext, scope: OrgScope): Promise<ArtistsPage> {
  const [list, mine, pending, comm] = await Promise.all([
    artistRows(ctx, scope.orgId, eq(artists.status, 'approved'), scope.userId),
    artistRows(ctx, scope.orgId, eq(artists.userId, scope.userId), scope.userId),
    isTeacher(scope)
      ? artistRows(ctx, scope.orgId, eq(artists.status, 'pending'), scope.userId)
      : [],
    commissionsFor(ctx, scope.orgId, scope.userId),
  ])
  return {
    artists: list.sort((a, b) => Number(b.open) - Number(a.open) || b.delivered - a.delivered),
    me: mine[0] ?? null,
    pending,
    ...comm,
  }
}

const idParams = orgIdParams

export async function notifyArtistFollowers(
  ctx: AppContext,
  c: { id: string; orgId: string; creatorId: string; name: string; kind: string },
) {
  const a = await ctx.db.query.artists.findFirst({
    where: and(eq(artists.orgId, c.orgId), eq(artists.userId, c.creatorId)),
  })
  if (a?.status !== 'approved') return
  const fans = await ctx.db
    .select({ id: artistFollows.followerId })
    .from(artistFollows)
    .where(and(eq(artistFollows.orgId, c.orgId), eq(artistFollows.artistId, c.creatorId)))
  if (!fans.length) return
  const [maker] = await ctx.db
    .select({ name: users.name, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, c.creatorId))
  const [org] = await ctx.db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, c.orgId))
  await createNotifications(
    ctx,
    fans.map((f) => ({
      orgId: c.orgId,
      userId: f.id,
      kind: 'artist_drop' as const,
      actorId: c.creatorId,
      channelId: null,
      messageId: null,
      threadId: null,
      title: `${maker?.displayName || maker?.name || 'An artist you follow'} released ${c.name}`,
      preview: 'New in the Shop. Go take a look!',
      link: `/${org?.slug}/artists/${c.creatorId}`,
    })),
  )
}

export async function artistRoutes(app: App, ctx: AppContext) {
  app.get('/api/orgs/:orgId/artists', { schema: { params: orgParams } }, async (req) =>
    page(ctx, await requireOrg(ctx, req, req.params.orgId)),
  )

  /** Apply to be an official artist (or update your artist profile once approved). */
  app.post(
    '/api/orgs/:orgId/artists/me',
    {
      schema: {
        params: orgParams,
        body: z.object({
          bio: z.string().trim().max(300).default(''),
          open: z.boolean().default(true),
          minPrice: z.number().int().min(ARTIST.offer.min).max(ARTIST.offer.max).default(50),
          featured: z.array(z.uuid()).max(4).optional(),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (censorText(req.body.bio).hits) throw badRequest('Keep your bio school-friendly.')
      const cur = await ctx.db.query.artists.findFirst({
        where: and(eq(artists.orgId, scope.orgId), eq(artists.userId, scope.userId)),
      })
      if (cur?.status === 'revoked') throw forbidden('A teacher took away your artist status.')
      if (req.body.featured?.length) {
        const ok = await ctx.db
          .select({ id: cosmetics.id })
          .from(cosmetics)
          .where(
            and(
              inArray(cosmetics.id, req.body.featured),
              eq(cosmetics.creatorId, scope.userId),
              eq(cosmetics.status, 'approved'),
            ),
          )
        if (ok.length !== new Set(req.body.featured).size)
          throw badRequest('You can only feature your own approved cosmetics.')
      }
      if (cur)
        await ctx.db
          .update(artists)
          .set({
            ...req.body,
            // Rejected? Applying again puts it back in the queue.
            status: cur.status === 'rejected' ? 'pending' : cur.status,
          })
          .where(and(eq(artists.orgId, scope.orgId), eq(artists.userId, scope.userId)))
      else
        await ctx.db
          .insert(artists)
          .values({ orgId: scope.orgId, userId: scope.userId, ...req.body })
      return page(ctx, scope)
    },
  )

  app.get(
    '/api/orgs/:orgId/artists/:id/page',
    { schema: { params: idParams } },
    async (req): Promise<ArtistPage> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const [artist] = await artistRows(
        ctx,
        scope.orgId,
        eq(artists.userId, req.params.id),
        scope.userId,
      )
      if (!artist || (artist.status !== 'approved' && artist.user.id !== scope.userId))
        throw notFound('Artist')
      const row = await ctx.db.query.artists.findFirst({
        where: and(eq(artists.orgId, scope.orgId), eq(artists.userId, req.params.id)),
        columns: { featured: true },
      })
      const creator = await ctx.db.query.users.findFirst({
        where: eq(users.id, req.params.id),
        columns: { id: true, name: true, displayName: true, email: true },
      })
      const works = await ctx.db
        .select()
        .from(cosmetics)
        .where(
          and(
            eq(cosmetics.orgId, scope.orgId),
            eq(cosmetics.creatorId, req.params.id),
            eq(cosmetics.status, 'approved'),
            eq(cosmetics.visibility, 'public'),
          ),
        )
        .orderBy(desc(cosmetics.sales), desc(cosmetics.id))
        .limit(200)
      const email = creator?.email.toLowerCase()
      const official = Object.entries(builtinMakers())
        .filter(([, e]) => e === email)
        .map(([id]) => id)
      const who = creator
        ? { id: creator.id, name: creator.name, displayName: creator.displayName }
        : { id: req.params.id, name: 'Artist', displayName: null }
      return {
        artist,
        works: works.map((c) => serializeCosmetic(c, who)),
        featured: (row?.featured ?? []).filter((id) => works.some((w) => w.id === id)),
        official,
        sales: works.reduce((n, w) => n + w.sales, 0),
      }
    },
  )

  app.post(
    '/api/orgs/:orgId/artists/:id/follow',
    {
      schema: { params: idParams, body: z.object({ follow: z.boolean() }) },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (req.params.id === scope.userId) throw badRequest("You can't follow yourself.")
      const a = await ctx.db.query.artists.findFirst({
        where: and(eq(artists.orgId, scope.orgId), eq(artists.userId, req.params.id)),
      })
      if (a?.status !== 'approved') throw notFound('Artist')
      if (req.body.follow)
        await ctx.db
          .insert(artistFollows)
          .values({ orgId: scope.orgId, followerId: scope.userId, artistId: req.params.id })
          .onConflictDoNothing()
      else
        await ctx.db
          .delete(artistFollows)
          .where(
            and(
              eq(artistFollows.followerId, scope.userId),
              eq(artistFollows.artistId, req.params.id),
            ),
          )
      const [artist] = await artistRows(
        ctx,
        scope.orgId,
        eq(artists.userId, req.params.id),
        scope.userId,
      )
      return artist
    },
  )

  /** Teachers approve, reject or revoke an artist. */
  app.post(
    '/api/orgs/:orgId/artists/:id/review',
    {
      schema: {
        params: idParams,
        body: z.object({ decision: z.enum(['approved', 'rejected', 'revoked']) }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const [row] = await ctx.db
        .update(artists)
        .set({ status: req.body.decision, reviewedBy: scope.userId })
        .where(and(eq(artists.orgId, scope.orgId), eq(artists.userId, req.params.id)))
        .returning()
      if (!row) throw notFound('Artist')
      await notify(
        ctx,
        scope.orgId,
        row.userId,
        req.body.decision === 'approved'
          ? "🎨 You're an Official Artist now! People can send you art requests."
          : req.body.decision === 'rejected'
            ? 'Your artist application wasn’t approved this time.'
            : 'A teacher took away your Official Artist status.',
      )
      return page(ctx, scope)
    },
  )

  /** Ask an artist for custom art. The offer is held now. */
  app.post(
    '/api/orgs/:orgId/commissions',
    {
      schema: {
        params: orgParams,
        body: z.object({
          artistId: z.uuid(),
          kind: z.enum(['decoration', 'effect', 'plate', 'theme', ...SPEC_KINDS]),
          description: z.string().trim().min(5).max(500),
          offer: z.number().int().min(ARTIST.offer.min).max(ARTIST.offer.max),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const b = req.body
      if (b.artistId === scope.userId) throw badRequest("You can't send a request to yourself.")
      if (censorText(b.description).hits) throw badRequest('Keep the request school-friendly.')
      const a = await ctx.db.query.artists.findFirst({
        where: and(eq(artists.orgId, scope.orgId), eq(artists.userId, b.artistId)),
      })
      if (a?.status !== 'approved') throw notFound('Artist')
      if (!a.open) throw badRequest("This artist isn't taking requests right now.")
      if (b.offer < a.minPrice)
        throw badRequest(`This artist's requests start at 🪙 ${a.minPrice}.`)
      await ctx.db.transaction(async (tx) => {
        const [open] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(commissions)
          .where(
            and(
              eq(commissions.requesterId, scope.userId),
              inArray(commissions.status, ['requested', 'accepted']),
            ),
          )
        if ((open?.n ?? 0) >= ARTIST.maxOpen)
          throw badRequest(`You can have ${ARTIST.maxOpen} requests going at once.`)
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < b.offer)
          throw badRequest(`You need ${b.offer - (u?.coins ?? 0)} more Wicky Coins.`)
        const [row] = await tx
          .insert(commissions)
          .values({
            orgId: scope.orgId,
            requesterId: scope.userId,
            artistId: b.artistId,
            kind: b.kind,
            description: b.description,
            offer: b.offer,
          })
          .returning()
        await changeCoins(tx, scope.userId, -b.offer, 'commission_hold', row!.id)
      })
      await notify(ctx, scope.orgId, b.artistId, `🎨 New art request for 🪙 ${b.offer}!`)
      return page(ctx, scope)
    },
  )

  for (const action of ['accept', 'decline', 'cancel'] as const)
    app.post(
      `/api/orgs/:orgId/commissions/:id/${action}`,
      {
        schema: {
          params: idParams,
          body: z.object({ note: z.string().trim().max(300).default('') }).optional(),
        },
      },
      async (req) => {
        const scope = await requireOrg(ctx, req, req.params.orgId)
        const note = req.body?.note ?? ''
        if (censorText(note).hits) throw badRequest('Keep it school-friendly.')
        const c = await ctx.db.transaction(async (tx) => {
          const [c] = await tx
            .select()
            .from(commissions)
            .where(and(eq(commissions.id, req.params.id), eq(commissions.orgId, scope.orgId)))
            .for('update')
          if (!c) throw notFound('Request')
          if (action === 'cancel') {
            if (c.requesterId !== scope.userId) throw forbidden()
            const late =
              c.status === 'accepted' &&
              c.acceptedAt &&
              Date.now() - c.acceptedAt.getTime() > ARTIST.deliverDays * 86_400_000
            if (c.status !== 'requested' && !late)
              throw conflict(
                c.status === 'accepted'
                  ? `The artist is working on it. You can cancel if it's not done ${ARTIST.deliverDays} days after they accepted.`
                  : 'This request is already finished.',
              )
          } else {
            if (c.artistId !== scope.userId) throw forbidden()
            if (c.status !== 'requested') throw conflict('This request was already answered.')
          }
          const status =
            action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled'
          await tx
            .update(commissions)
            .set({
              status,
              ...(note && { note }),
              ...(action === 'accept' && { acceptedAt: new Date() }),
            })
            .where(eq(commissions.id, c.id))
          if (action !== 'accept')
            await changeCoins(tx, c.requesterId, c.offer, 'commission_refund', c.id)
          return c
        })
        const who = action === 'cancel' ? c.artistId : c.requesterId
        await notify(
          ctx,
          scope.orgId,
          who,
          action === 'accept'
            ? '🎨 An artist accepted your request! They’re working on it.'
            : action === 'decline'
              ? `An artist declined your request. Your 🪙 ${c.offer} is back.`
              : 'Someone cancelled their art request.',
        )
        return page(ctx, scope)
      },
    )

  /**
   * The artist hands over something they made (an approved cosmetic, often a private one made
   * just for this person). The requester gets a copy and the artist gets paid.
   */
  app.post(
    '/api/orgs/:orgId/commissions/:id/deliver',
    {
      schema: {
        params: idParams,
        body: z.object({
          cosmeticId: z.uuid(),
          note: z.string().trim().max(300).default(''),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { cosmeticId, note } = req.body
      if (censorText(note).hits) throw badRequest('Keep it school-friendly.')
      const c = await ctx.db.transaction(async (tx) => {
        const [c] = await tx
          .select()
          .from(commissions)
          .where(and(eq(commissions.id, req.params.id), eq(commissions.orgId, scope.orgId)))
          .for('update')
        if (!c) throw notFound('Request')
        if (c.artistId !== scope.userId) throw forbidden()
        if (c.status !== 'accepted') throw conflict('Accept the request first.')
        const item = await tx.query.cosmetics.findFirst({ where: eq(cosmetics.id, cosmeticId) })
        if (!item || item.creatorId !== scope.userId || item.orgId !== scope.orgId)
          throw badRequest('Deliver something you made.')
        if (item.status !== 'approved')
          throw badRequest('A teacher needs to approve it first (Create it, then wait for review).')
        if (item.kind !== c.kind) throw badRequest(`They asked for a ${c.kind}.`)
        const itemId = `u:${item.id}`
        const has = await tx.query.userItems.findFirst({
          where: and(eq(userItems.userId, c.requesterId), eq(userItems.itemId, itemId)),
          columns: { itemId: true },
        })
        if (has) throw conflict('They already have that one. Make them something new!')
        const serial = await takeCopy(tx, item.id)
        await tx
          .insert(userItems)
          .values({ userId: c.requesterId, itemId, serial, giftedBy: scope.userId })
        await tx
          .update(commissions)
          .set({ status: 'delivered', itemId, deliveredAt: new Date(), ...(note && { note }) })
          .where(eq(commissions.id, c.id))
        await changeCoins(
          tx,
          scope.userId,
          Math.floor(c.offer * ARTIST.share),
          'commission_pay',
          c.id,
        )
        return c
      })
      await notify(ctx, scope.orgId, c.requesterId, '🎨 Your custom art is here! Check My stuff.')
      return { page: await page(ctx, scope), wallet: await loadWallet(ctx, scope.userId) }
    },
  )
}
