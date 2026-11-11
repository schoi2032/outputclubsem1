/**
 * Canvases: shared documents inside a channel (notes, agendas, specs). Anyone who
 * can read the channel can read them; members can edit. Saves name the version
 * they edited, so two people can't silently overwrite each other: the second
 * save gets a 409 and the editor merges or reloads.
 *
 * Whiteboards are canvases too (kind "whiteboard"): an Excalidraw scene. Clients send
 * just the elements they changed; the server keeps, per element, whichever copy has
 * the higher version, so several people can draw at once without conflicts.
 */
import { canvases } from '@quid/db'
import {
  type Canvas,
  type CanvasSummary,
  type DocNode,
  docToText,
  isDocError,
  sanitizeDoc,
  topics,
} from '@quid/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import type { App } from '../../core/http'
import { check, getChannelAccess, requireChannel } from '../channels/service'
import { postSystemMessage } from '../messages/service'
import { userSummaries } from './common'

type Row = typeof canvases.$inferSelect

const EMPTY_DOC: DocNode = { type: 'doc', content: [{ type: 'paragraph' }] }

function parseCanvasBody(input: unknown) {
  try {
    return sanitizeDoc(input, { rich: true })
  } catch (e) {
    if (isDocError(e)) throw badRequest(e.message)
    throw e
  }
}

async function serialize(ctx: AppContext, rows: Row[]): Promise<CanvasSummary[]>
async function serialize(ctx: AppContext, rows: Row[], full: true): Promise<Canvas[]>
async function serialize(ctx: AppContext, rows: Row[], full = false) {
  const people = await userSummaries(
    ctx,
    rows.flatMap((r) => [r.createdBy, r.updatedBy]),
  )
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    kind: r.kind,
    title: r.title,
    preview: r.bodyText.slice(0, 160),
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: (r.updatedBy && people.get(r.updatedBy)) || null,
    ...(full && {
      body: r.bodyJson,
      scene: r.kind === 'whiteboard' ? (r.scene ?? []) : null,
      createdAt: r.createdAt.toISOString(),
      createdBy: (r.createdBy && people.get(r.createdBy)) || null,
    }),
  }))
}

async function publish(ctx: AppContext, r: Row, deleted = false) {
  await ctx.bus.publish(topics.channel(r.channelId), {
    type: 'canvas.updated',
    orgId: r.orgId,
    channelId: r.channelId,
    canvasId: r.id,
    version: r.version,
    updatedBy: r.updatedBy,
    ...(deleted && { deleted: true }),
  })
}

export async function canvasRoutes(app: App, ctx: AppContext) {
  const params = z.object({ orgId: z.uuid(), id: z.uuid() })
  const chanParams = z.object({ orgId: z.uuid(), channelId: z.uuid() })

  /** Loads a canvas whose channel the caller may read. */
  async function load(req: FastifyRequest, p: { orgId: string; id: string }) {
    const scope = await requireOrg(ctx, req, p.orgId)
    const row = await ctx.db.query.canvases.findFirst({
      where: and(
        eq(canvases.id, p.id),
        eq(canvases.orgId, scope.orgId),
        isNull(canvases.deletedAt),
      ),
    })
    if (!row) throw notFound('Canvas')
    const access = await getChannelAccess(ctx, scope, row.channelId)
    return { scope, row, access }
  }

  app.get(
    '/api/orgs/:orgId/channels/:channelId/canvases',
    { schema: { params: chanParams } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      await requireChannel(ctx, scope, req.params.channelId, 'read')
      const rows = await ctx.db
        .select()
        .from(canvases)
        .where(and(eq(canvases.channelId, req.params.channelId), isNull(canvases.deletedAt)))
        .orderBy(desc(canvases.updatedAt))
        .limit(100)
      return serialize(ctx, rows)
    },
  )

  app.post(
    '/api/orgs/:orgId/channels/:channelId/canvases',
    {
      schema: {
        params: chanParams,
        body: z.object({
          title: z.string().trim().min(1).max(120),
          kind: z.enum(['doc', 'whiteboard']).default('doc'),
          body: z.unknown().optional(),
        }),
      },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.channelId, 'reply')
      const whiteboard = req.body.kind === 'whiteboard'
      const body = whiteboard ? EMPTY_DOC : parseCanvasBody(req.body.body ?? EMPTY_DOC)
      const [row] = await ctx.db
        .insert(canvases)
        .values({
          orgId: scope.orgId,
          channelId: channel.id,
          kind: req.body.kind,
          scene: whiteboard ? [] : null,
          title: req.body.title,
          bodyJson: body,
          bodyText: docToText(body),
          createdBy: scope.userId,
          updatedBy: scope.userId,
        })
        .returning()
      await publish(ctx, row!)
      // The author's name is shown with the message, like "started a call".
      await postSystemMessage(
        ctx,
        scope.orgId,
        channel.id,
        scope.userId,
        `created the ${whiteboard ? 'whiteboard' : 'canvas'} “${row!.title}”`,
      )
      return reply.code(201).send((await serialize(ctx, [row!], true))[0])
    },
  )

  app.get('/api/orgs/:orgId/canvases/:id', { schema: { params } }, async (req) => {
    const { row } = await load(req, req.params)
    return (await serialize(ctx, [row], true))[0]
  })

  app.patch(
    '/api/orgs/:orgId/canvases/:id',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        params,
        body: z.object({
          version: z.number().int().min(1).optional(),
          title: z.string().trim().min(1).max(120).optional(),
          body: z.unknown().optional(),
        }),
      },
    },
    async (req) => {
      const { scope, row, access } = await load(req, req.params)
      if (!check(scope, access, 'reply')) throw forbidden('Join the channel to edit its canvases.')
      if (row.kind === 'whiteboard' && req.body.body !== undefined)
        throw badRequest('Whiteboards are saved element by element.')
      if (req.body.version === undefined && (req.body.body !== undefined || row.kind === 'doc'))
        throw badRequest('Say which version you edited.')
      const body = req.body.body === undefined ? null : parseCanvasBody(req.body.body)
      // Only applies if nobody saved in between (whiteboard renames don't need that).
      const [saved] = await ctx.db
        .update(canvases)
        .set({
          ...(req.body.title && { title: req.body.title }),
          ...(body && { bodyJson: body, bodyText: docToText(body) }),
          version: row.version + 1,
          updatedBy: scope.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(canvases.id, row.id),
            req.body.version === undefined ? undefined : eq(canvases.version, req.body.version),
          ),
        )
        .returning()
      if (!saved) throw conflict('Someone else changed this canvas. Reload to see their edits.')
      await publish(ctx, saved)
      return (await serialize(ctx, [saved], true))[0]
    },
  )

  /** Whiteboards: merge changed elements. Answers with the ones that were kept. */
  app.post(
    '/api/orgs/:orgId/canvases/:id/elements',
    {
      bodyLimit: 4 * 1024 * 1024,
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: { params, body: z.object({ elements: z.array(z.unknown()).min(1).max(2000) }) },
    },
    async (req) => {
      const { scope, row, access } = await load(req, req.params)
      if (row.kind !== 'whiteboard') throw badRequest('Not a whiteboard.')
      if (!check(scope, access, 'reply')) throw forbidden('Join the channel to draw here.')
      const incoming = req.body.elements.map(cleanElement)
      const kept = await ctx.db.transaction(async (tx) => {
        const [cur] = await tx
          .select({ scene: canvases.scene })
          .from(canvases)
          .where(eq(canvases.id, row.id))
          .for('update')
        const byId = new Map((cur?.scene ?? []).map((e) => [e.id as string, e]))
        const won: Record<string, unknown>[] = []
        for (const el of incoming) {
          const have = byId.get(el.id as string)
          if (!have || newer(el, have)) {
            byId.set(el.id as string, el)
            won.push(el)
          }
        }
        if (!won.length) return won
        const scene = [...byId.values()]
        if (scene.length > MAX_ELEMENTS)
          throw badRequest('This whiteboard is full. Start a new one.')
        if (JSON.stringify(scene).length > MAX_SCENE_BYTES)
          throw badRequest('This whiteboard is too big. Start a new one.')
        await tx
          .update(canvases)
          .set({
            scene,
            bodyText: sceneText(scene),
            version: row.version + 1,
            updatedBy: scope.userId,
            updatedAt: new Date(),
          })
          .where(eq(canvases.id, row.id))
        return won
      })
      if (kept.length)
        await ctx.bus.publish(topics.channel(row.channelId), {
          type: 'board.updated',
          orgId: row.orgId,
          channelId: row.channelId,
          canvasId: row.id,
          userId: scope.userId,
          elements: kept,
        })
      return { kept: kept.length }
    },
  )

  app.delete('/api/orgs/:orgId/canvases/:id', { schema: { params } }, async (req) => {
    const { scope, row, access } = await load(req, req.params)
    if (row.createdBy !== scope.userId && !check(scope, access, 'manage'))
      throw forbidden('Only the canvas creator or a channel admin can delete it.')
    const [gone] = await ctx.db
      .update(canvases)
      .set({ deletedAt: new Date() })
      .where(eq(canvases.id, row.id))
      .returning()
    await publish(ctx, gone!, true)
    return { ok: true }
  })
}

// ---------------------------------------------------------------------------
// Whiteboard elements
// ---------------------------------------------------------------------------

const MAX_ELEMENTS = 20_000
const MAX_SCENE_BYTES = 8 * 1024 * 1024
/** Drawing primitives only: no images, embeds or iframes. */
const ELEMENT_TYPES = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'arrow',
  'line',
  'freedraw',
  'text',
  'frame',
])

/** Checks one Excalidraw element and drops anything that could reach outside the board. */
export function cleanElement(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw badRequest('Invalid element')
  const el = { ...(input as Record<string, unknown>) }
  if (typeof el.id !== 'string' || !/^[\w-]{1,64}$/.test(el.id))
    throw badRequest('Invalid element id')
  if (typeof el.type !== 'string' || !ELEMENT_TYPES.has(el.type))
    throw badRequest(`Unsupported element: ${String(el.type)}`)
  if (!Number.isInteger(el.version) || (el.version as number) < 1)
    throw badRequest('Invalid element version')
  if (!Number.isInteger(el.versionNonce)) throw badRequest('Invalid element version')
  // Links may only go to web pages.
  if (
    el.link != null &&
    !(typeof el.link === 'string' && /^https?:\/\//i.test(el.link) && el.link.length <= 2000)
  )
    el.link = null
  delete el.customData
  if (JSON.stringify(el).length > 200_000) throw badRequest('An element is too large.')
  return el
}

/** Excalidraw's rule: higher version wins; on a tie, the lower nonce. */
function newer(a: Record<string, unknown>, b: Record<string, unknown>) {
  const av = a.version as number
  const bv = b.version as number
  return av > bv || (av === bv && (a.versionNonce as number) < (b.versionNonce as number))
}

/** Text on the board, for previews and search. */
function sceneText(scene: Record<string, unknown>[]) {
  return scene
    .filter((e) => e.type === 'text' && !e.isDeleted && typeof e.text === 'string')
    .map((e) => e.text as string)
    .join(' · ')
    .slice(0, 5000)
}
