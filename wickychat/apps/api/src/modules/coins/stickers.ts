/**
 * WickyChat stickers: built-in packs (one free for everyone) and packs students make from
 * their own images. A teacher approves a pack before it's sold; makers earn CREATOR_SHARE.
 */
import {
  files,
  messageStickers,
  messages,
  stickerPacks,
  stickers,
  userStickerPacks,
  users,
} from '@quid/db'
import {
  CREATOR_SHARE,
  censorText,
  STICKER_PACK,
  STICKER_PACKS,
  type StickerPack,
  stickerPackById,
  topics,
} from '@quid/shared'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { authorize, type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { requireChannel } from '../channels/service'
import { createMessage, serializeMessage } from '../messages/service'
import { avatarUrl } from '../users/serialize'
import { checkPerson } from './crates'
import { loadWallet } from './routes'
import { changeCoins } from './service'
import { canUseSticker, resolveStickers } from './sticker-lookup'

const BUILTIN = /^b:([a-z0-9-]+)$/

async function ownedKeys(ctx: AppContext, userId: string) {
  const rows = await ctx.db
    .select({ key: userStickerPacks.packKey })
    .from(userStickerPacks)
    .where(eq(userStickerPacks.userId, userId))
  return new Set(rows.map((r) => r.key))
}

async function listPacks(
  ctx: AppContext,
  scope: OrgScope,
  view: 'shop' | 'mine' | 'review',
): Promise<StickerPack[]> {
  const owned = await ownedKeys(ctx, scope.userId)
  const builtins: StickerPack[] =
    view === 'shop'
      ? STICKER_PACKS.map((p) => ({
          key: `b:${p.id}`,
          name: p.name,
          description: p.description,
          price: p.price,
          colors: p.colors,
          stickers: p.stickers.map((st) => ({
            key: `b:${p.id}:${st.id}`,
            name: st.text,
            emoji: st.emoji,
            text: st.text,
          })),
          status: 'approved',
          owned: p.price === 0 || owned.has(`b:${p.id}`),
        }))
      : []
  const rows = await ctx.db
    .select({
      p: stickerPacks,
      creator: { id: users.id, name: users.name, displayName: users.displayName },
    })
    .from(stickerPacks)
    .innerJoin(users, eq(users.id, stickerPacks.creatorId))
    .where(
      and(
        eq(stickerPacks.orgId, scope.orgId),
        view === 'shop'
          ? eq(stickerPacks.status, 'approved')
          : view === 'mine'
            ? eq(stickerPacks.creatorId, scope.userId)
            : eq(stickerPacks.status, 'pending'),
      ),
    )
    .orderBy(view === 'shop' ? desc(stickerPacks.sales) : desc(stickerPacks.id))
    .limit(200)
  const items = rows.length
    ? await ctx.db
        .select()
        .from(stickers)
        .where(
          inArray(
            stickers.packId,
            rows.map((r) => r.p.id),
          ),
        )
        .orderBy(asc(stickers.position))
    : []
  return [
    ...builtins,
    ...rows.map(
      (r): StickerPack => ({
        key: r.p.id,
        name: r.p.name,
        description: r.p.description,
        price: r.p.price,
        stickers: items
          .filter((i) => i.packId === r.p.id)
          .map((i) => ({ key: `u:${i.id}`, name: i.name, url: avatarUrl(i.fileId, true) ?? '' })),
        creator: r.creator,
        status: r.p.status as StickerPack['status'],
        reviewNote: r.p.reviewNote,
        sales: r.p.sales,
        owned: owned.has(r.p.id) || r.p.creatorId === scope.userId,
      }),
    ),
  ]
}

export async function stickerRoutes(app: App, ctx: AppContext) {
  app.get(
    '/api/orgs/:orgId/sticker-packs',
    {
      schema: {
        params: orgParams,
        querystring: z.object({ view: z.enum(['shop', 'mine', 'review']).default('shop') }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (req.query.view === 'review') authorize(scope, 'audit.read')
      return listPacks(ctx, scope, req.query.view)
    },
  )

  app.post(
    '/api/orgs/:orgId/sticker-packs',
    {
      schema: {
        params: orgParams,
        body: z.object({
          name: z.string().trim().min(2).max(40),
          description: z.string().trim().max(140).default(''),
          price: z.number().int().min(STICKER_PACK.price.min).max(STICKER_PACK.price.max),
          stickers: z
            .array(z.object({ fileId: z.uuid(), name: z.string().trim().min(1).max(30) }))
            .min(STICKER_PACK.minStickers)
            .max(STICKER_PACK.maxStickers),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const b = req.body
      const words = [b.name, b.description, ...b.stickers.map((s) => s.name)]
      if (words.some((w) => censorText(w).hits)) throw badRequest('Keep the names school-friendly.')
      const ids = [...new Set(b.stickers.map((s) => s.fileId))]
      const mine = await ctx.db
        .select({ id: files.id })
        .from(files)
        .where(
          and(
            inArray(files.id, ids),
            eq(files.uploaderId, scope.userId),
            eq(files.purpose, 'cosmetic'),
            isNull(files.deletedAt),
          ),
        )
      if (mine.length !== ids.length) throw badRequest('Upload the images first.')
      const [{ pending } = { pending: 0 }] = await ctx.db
        .select({ pending: sql<number>`count(*)::int` })
        .from(stickerPacks)
        .where(and(eq(stickerPacks.creatorId, scope.userId), eq(stickerPacks.status, 'pending')))
      if (pending >= 3)
        throw badRequest('You have 3 sticker packs waiting for review. Wait for a teacher first.')
      await ctx.db.transaction(async (tx) => {
        const [pack] = await tx
          .insert(stickerPacks)
          .values({
            orgId: scope.orgId,
            creatorId: scope.userId,
            name: b.name,
            description: b.description,
            price: b.price,
          })
          .returning()
        await tx.insert(stickers).values(
          b.stickers.map((s, i) => ({
            packId: pack!.id,
            fileId: s.fileId,
            name: s.name,
            position: i,
          })),
        )
      })
      return reply.code(201).send(await listPacks(ctx, scope, 'mine'))
    },
  )

  app.post(
    '/api/orgs/:orgId/sticker-packs/:id/review',
    {
      schema: {
        params: orgIdParams,
        body: z.object({ approve: z.boolean(), note: z.string().trim().max(200).optional() }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'audit.read')
      const [row] = await ctx.db
        .update(stickerPacks)
        .set({
          status: req.body.approve ? 'approved' : 'rejected',
          reviewNote: req.body.note ?? null,
        })
        .where(and(eq(stickerPacks.id, req.params.id), eq(stickerPacks.orgId, scope.orgId)))
        .returning()
      if (!row) throw notFound('Sticker pack')
      return listPacks(ctx, scope, 'review')
    },
  )

  /** Buys a pack for yourself, or for someone else with `giftTo`. */
  app.post(
    '/api/orgs/:orgId/sticker-packs/:key/buy',
    {
      schema: {
        params: orgParams.extend({ key: z.string().max(60) }),
        body: z.object({ giftTo: z.uuid().optional() }).optional(),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const giftTo = req.body?.giftTo
      if (giftTo) await checkPerson(ctx, scope.userId, giftTo)
      const owner = giftTo ?? scope.userId
      const { key } = req.params
      const b = BUILTIN.exec(key)
      let price: number
      let creatorId: string | null = null
      if (b) {
        const p = stickerPackById(b[1]!)
        if (!p) throw notFound('Sticker pack')
        if (!p.price) throw conflict('Everyone already has this one!')
        price = p.price
      } else {
        const p = await ctx.db.query.stickerPacks.findFirst({
          where: and(
            sql`${stickerPacks.id}::text = ${key}`,
            eq(stickerPacks.orgId, scope.orgId),
            eq(stickerPacks.status, 'approved'),
          ),
        })
        if (!p) throw notFound('Sticker pack')
        if (p.creatorId === owner) throw conflict('They made it, so they already have it.')
        price = p.price
        creatorId = p.creatorId
      }
      await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(userStickerPacks)
          .values({ userId: owner, packKey: key, giftedBy: giftTo ? scope.userId : null })
          .onConflictDoNothing()
          .returning()
        if (!row) throw conflict(giftTo ? 'They already have this pack.' : 'You already have it.')
        const [u] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, scope.userId))
          .for('update')
        if (!u || u.coins < price)
          throw badRequest(`You need ${price - (u?.coins ?? 0)} more Wicky Coins.`)
        await changeCoins(tx, scope.userId, -price, giftTo ? 'sticker_gift' : 'sticker_pack', key)
        if (creatorId) {
          await tx
            .update(stickerPacks)
            .set({ sales: sql`${stickerPacks.sales} + 1` })
            .where(sql`${stickerPacks.id}::text = ${key}`)
          if (creatorId !== scope.userId)
            await changeCoins(tx, creatorId, Math.floor(price * CREATOR_SHARE), 'sticker_sale', key)
        }
      })
      return {
        packs: await listPacks(ctx, scope, 'shop'),
        wallet: await loadWallet(ctx, scope.userId),
      }
    },
  )

  /** Sends a sticker you own as a message. */
  app.post(
    '/api/orgs/:orgId/channels/:id/stickers',
    {
      schema: {
        params: orgIdParams,
        body: z.object({ key: z.string().max(80), parentId: z.uuid().nullable().default(null) }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.id, 'post')
      const { key, parentId } = req.body
      const sticker = (await resolveStickers(ctx.db, [key])).get(key)
      if (!sticker) throw notFound('Sticker')
      const ok = await canUseSticker(ctx.db, scope, key)
      if (!ok) throw badRequest("You don't have that sticker pack. Get it in the Shop!")
      const message = await createMessage(ctx, scope, channel, {
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `${sticker.emoji ?? '🖼️'} ${sticker.name}` }],
            },
          ],
        },
        fileIds: [],
        parentId,
      })
      await ctx.db.insert(messageStickers).values({ messageId: message.id, stickerKey: key })
      const row = await ctx.db.query.messages.findFirst({ where: eq(messages.id, message.id) })
      const full = await serializeMessage(ctx, scope.userId, row!)
      await ctx.bus.publish(topics.channel(channel.id), {
        type: 'message.updated',
        orgId: scope.orgId,
        message: full,
      })
      return reply.code(201).send(full)
    },
  )
}
