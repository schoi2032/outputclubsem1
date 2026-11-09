/**
 * Custom emoji and soundboard sounds. Members upload the file first
 * (`POST /files?purpose=emoji|sound`), then register it here under a name.
 * Anyone can remove what they added; admins can remove anything.
 */
import { customEmojis, files, soundboardSounds, users } from '@quid/db'
import {
  type CustomEmoji,
  can,
  createEmojiSchema,
  createSoundSchema,
  MAX_CUSTOM_EMOJIS,
  MAX_SOUNDBOARD_SOUNDS,
  type SoundboardSound,
  topics,
  updateSoundSchema,
} from '@quid/shared'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { audit } from '../../core/audit'
import { authorize, type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams, orgParams } from '../../core/http'
import { loadCustomization } from '../orgs/customization'
import { toUserSummary, userCols } from '../users/serialize'

const fileUrl = (id: string) => `/api/files/${id}/content?inline=1`

/** The caller's own, unused upload with the given purpose. */
async function ownUpload(ctx: AppContext, scope: OrgScope, fileId: string, purpose: string) {
  const f = await ctx.db.query.files.findFirst({
    where: and(
      eq(files.id, fileId),
      eq(files.orgId, scope.orgId),
      eq(files.uploaderId, scope.userId),
      isNull(files.deletedAt),
    ),
  })
  if (!f || f.purpose !== purpose) throw notFound('File')
  return f
}

/** Members can add emoji and sounds unless the org limits it to admins. */
async function authorizeCreate(ctx: AppContext, scope: OrgScope) {
  authorize(scope, 'expressions.create')
  const { expressionsPolicy } = await loadCustomization(ctx, scope.orgId)
  if (expressionsPolicy === 'admins' && !can(scope.role, 'expressions.manage_any'))
    throw forbidden('Only admins can add emoji and sounds in this workspace.')
}

function canRemove(scope: OrgScope, createdBy: string | null) {
  return createdBy === scope.userId || can(scope.role, 'expressions.manage_any')
}

const count = async (
  ctx: AppContext,
  table: typeof customEmojis | typeof soundboardSounds,
  orgId: string,
) => {
  const [r] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.orgId, orgId))
  return r?.n ?? 0
}

/** Drizzle wraps driver errors, so the Postgres code may be on `cause`. */
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  ((e as { code?: string }).code === '23505' || isUniqueViolation((e as { cause?: unknown }).cause))

export async function expressionRoutes(app: App, ctx: AppContext) {
  const base = '/api/orgs/:orgId'
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }

  const changed = (orgId: string, kind: 'emoji' | 'sound') =>
    ctx.bus.publish(topics.org(orgId), { type: 'expressions.updated', orgId, kind })

  // --- Custom emoji -------------------------------------------------------------

  app.get(
    `${base}/emojis`,
    { schema: { params: orgParams } },
    async (req): Promise<CustomEmoji[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select({ e: customEmojis, by: userCols })
        .from(customEmojis)
        .leftJoin(users, eq(users.id, customEmojis.createdBy))
        .where(eq(customEmojis.orgId, scope.orgId))
        .orderBy(asc(customEmojis.name))
      return rows.map(({ e, by }) => ({
        id: e.id,
        name: e.name,
        url: fileUrl(e.fileId),
        animated: e.animated,
        createdBy: by?.id ? toUserSummary(by) : null,
        createdAt: e.createdAt.toISOString(),
      }))
    },
  )

  app.post(
    `${base}/emojis`,
    { ...limit, schema: { params: orgParams, body: createEmojiSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await authorizeCreate(ctx, scope)
      const f = await ownUpload(ctx, scope, req.body.fileId, 'emoji')
      if ((await count(ctx, customEmojis, scope.orgId)) >= MAX_CUSTOM_EMOJIS)
        throw badRequest(`An organization can have up to ${MAX_CUSTOM_EMOJIS} custom emoji.`)
      try {
        const [row] = await ctx.db
          .insert(customEmojis)
          .values({
            orgId: scope.orgId,
            name: req.body.name,
            fileId: f.id,
            animated: f.animated,
            createdBy: scope.userId,
          })
          .returning()
        await changed(scope.orgId, 'emoji')
        return reply.code(201).send({ id: row!.id, name: row!.name, url: fileUrl(f.id) })
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict(`:${req.body.name}: is already taken.`)
        throw e
      }
    },
  )

  app.delete(`${base}/emojis/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await ctx.db.query.customEmojis.findFirst({
      where: and(eq(customEmojis.id, req.params.id), eq(customEmojis.orgId, scope.orgId)),
    })
    if (!row) throw notFound('Emoji')
    if (!canRemove(scope, row.createdBy)) throw forbidden()
    await ctx.db.delete(customEmojis).where(eq(customEmojis.id, row.id))
    if (row.createdBy !== scope.userId)
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'emoji.removed',
        targetType: 'emoji',
        targetId: row.id,
        metadata: { name: row.name },
      })
    await changed(scope.orgId, 'emoji')
    return { ok: true }
  })

  // --- Soundboard -----------------------------------------------------------------

  app.get(
    `${base}/sounds`,
    { schema: { params: orgParams } },
    async (req): Promise<SoundboardSound[]> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const rows = await ctx.db
        .select({ s: soundboardSounds, by: userCols })
        .from(soundboardSounds)
        .leftJoin(users, eq(users.id, soundboardSounds.createdBy))
        .where(eq(soundboardSounds.orgId, scope.orgId))
        .orderBy(asc(soundboardSounds.id))
      return rows.map(({ s, by }) => ({
        id: s.id,
        name: s.name,
        emoji: s.emoji,
        url: `/api/files/${s.fileId}/content`,
        volume: s.volume,
        createdBy: by?.id ? toUserSummary(by) : null,
        createdAt: s.createdAt.toISOString(),
      }))
    },
  )

  app.post(
    `${base}/sounds`,
    { ...limit, schema: { params: orgParams, body: createSoundSchema } },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await authorizeCreate(ctx, scope)
      const f = await ownUpload(ctx, scope, req.body.fileId, 'sound')
      if ((await count(ctx, soundboardSounds, scope.orgId)) >= MAX_SOUNDBOARD_SOUNDS)
        throw badRequest(`An organization can have up to ${MAX_SOUNDBOARD_SOUNDS} sounds.`)
      const [row] = await ctx.db
        .insert(soundboardSounds)
        .values({
          orgId: scope.orgId,
          name: req.body.name,
          emoji: req.body.emoji || null,
          fileId: f.id,
          volume: req.body.volume,
          createdBy: scope.userId,
        })
        .returning()
      await changed(scope.orgId, 'sound')
      return reply.code(201).send({ id: row!.id })
    },
  )

  app.patch(
    `${base}/sounds/:id`,
    { schema: { params: orgIdParams, body: updateSoundSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const row = await ctx.db.query.soundboardSounds.findFirst({
        where: and(eq(soundboardSounds.id, req.params.id), eq(soundboardSounds.orgId, scope.orgId)),
      })
      if (!row) throw notFound('Sound')
      if (!canRemove(scope, row.createdBy)) throw forbidden()
      const { name, emoji, volume } = req.body
      await ctx.db
        .update(soundboardSounds)
        .set({
          ...(name !== undefined && { name }),
          ...(emoji !== undefined && { emoji: emoji || null }),
          ...(volume !== undefined && { volume }),
        })
        .where(eq(soundboardSounds.id, row.id))
      await changed(scope.orgId, 'sound')
      return { ok: true }
    },
  )

  app.delete(`${base}/sounds/:id`, { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const row = await ctx.db.query.soundboardSounds.findFirst({
      where: and(eq(soundboardSounds.id, req.params.id), eq(soundboardSounds.orgId, scope.orgId)),
    })
    if (!row) throw notFound('Sound')
    if (!canRemove(scope, row.createdBy)) throw forbidden()
    await ctx.db.delete(soundboardSounds).where(eq(soundboardSounds.id, row.id))
    if (row.createdBy !== scope.userId)
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'sound.removed',
        targetType: 'sound',
        targetId: row.id,
        metadata: { name: row.name },
      })
    await changed(scope.orgId, 'sound')
    return { ok: true }
  })
}
