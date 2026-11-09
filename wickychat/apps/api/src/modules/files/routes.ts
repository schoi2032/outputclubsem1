import { createHash } from 'node:crypto'
import { files, users } from '@quid/db'
import {
  ALLOWED_MIME_TYPES,
  MAX_AVATAR_BYTES,
  MAX_EMOJI_BYTES,
  MAX_SOUND_BYTES,
  MAX_UPLOAD_BYTES,
  PREVIEWABLE_IMAGE_TYPES,
  SOUND_AUDIO_TYPES,
} from '@quid/shared'
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { fileTypeFromBuffer } from 'file-type'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { requireOrg, requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden, notFound, tooLarge } from '../../core/errors'
import { type App, idParams, orgIdParams, orgParams } from '../../core/http'
import { check, getChannelAccess, requireChannel } from '../channels/service'
import { toUserSummary, userCols } from '../users/serialize'
import { serializeFile } from './serialize'

const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json'])
const THUMB_WIDTH = 720
/** file-type's names for audio we store under the canonical type. */
const AUDIO_ALIASES: Record<string, string> = {
  'audio/vnd.wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/opus': 'audio/ogg',
}
const THUMB_SIZE = { attachment: THUMB_WIDTH, avatar: 256, logo: 256, emoji: 128, sound: 0 }

/**
 * Determines the real type of an upload from its bytes. The client-declared
 * type is only trusted for plain-text formats, which have no magic bytes, and
 * only if the content really is text.
 */
async function sniff(buf: Buffer, declared: string, filename: string): Promise<string> {
  const detected = await fileTypeFromBuffer(buf)
  if (detected) {
    // Office files are zip containers; trust the extension to pick the precise type.
    if (
      detected.mime === 'application/zip' &&
      /\.(docx|xlsx|pptx)$/i.test(filename) &&
      ALLOWED_MIME_TYPES.has(declared)
    ) {
      return declared
    }
    if (
      detected.mime === 'application/x-cfb' &&
      /\.(doc|xls|ppt)$/i.test(filename) &&
      ALLOWED_MIME_TYPES.has(declared)
    ) {
      return declared
    }
    return detected.mime
  }
  const isText =
    !buf.subarray(0, 8192).includes(0) && Buffer.from(buf.toString('utf8'), 'utf8').equals(buf)
  if (!isText) return 'application/octet-stream'
  if (TEXT_TYPES.has(declared)) return declared
  if (/\.md$/i.test(filename)) return 'text/markdown'
  if (/\.csv$/i.test(filename)) return 'text/csv'
  if (/\.json$/i.test(filename)) return 'application/json'
  return 'text/plain'
}

function safeName(name: string) {
  const cleaned = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .trim()
    .slice(0, 200)
  return cleaned || 'file'
}

export async function fileRoutes(app: App, ctx: AppContext) {
  app.post(
    '/api/orgs/:orgId/files',
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          purpose: z.enum(['attachment', 'avatar', 'logo', 'emoji', 'sound']).default('attachment'),
          channelId: z.uuid().optional(),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { purpose, channelId } = req.query
      if (purpose === 'logo' && scope.role !== 'owner' && scope.role !== 'admin') throw forbidden()
      if (channelId) await requireChannel(ctx, scope, channelId, 'post')

      const part = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })
      if (!part) throw badRequest('No file was uploaded.')
      const buf = await part.toBuffer().catch((e: unknown) => {
        if (e instanceof Error && /too large/i.test(e.message))
          throw tooLarge('Files can be up to 4 MB.')
        throw e
      })
      if (part.file.truncated) throw tooLarge('Files can be up to 4 MB.')
      if (buf.length === 0) throw badRequest('The file is empty.')

      const name = safeName(part.filename)
      const sniffed = await sniff(buf, part.mimetype, name)
      const mime = AUDIO_ALIASES[sniffed] ?? sniffed
      if (!ALLOWED_MIME_TYPES.has(mime)) throw badRequest("This file type isn't supported.")
      const isImage = PREVIEWABLE_IMAGE_TYPES.has(mime)
      if (purpose === 'sound') {
        if (!SOUND_AUDIO_TYPES.has(mime)) throw badRequest('Choose an MP3, WAV or OGG file.')
        if (buf.length > MAX_SOUND_BYTES) throw tooLarge('Sounds can be up to 1 MB.')
      } else if (purpose !== 'attachment') {
        if (!isImage) throw badRequest('Choose a PNG, JPEG, GIF or WebP image.')
        if (purpose === 'emoji' && buf.length > MAX_EMOJI_BYTES)
          throw tooLarge('Emoji can be up to 512 KB.')
        if (buf.length > MAX_AVATAR_BYTES) throw tooLarge('Images can be up to 5 MB.')
      }

      const id = uuidv7()
      const key = `orgs/${scope.orgId}/files/${id}`
      let width: number | null = null
      let height: number | null = null
      let animated = false
      if (isImage) {
        try {
          const sharp = (await import('sharp')).default
          const img = sharp(buf, {
            animated: mime === 'image/gif' || mime === 'image/webp',
            limitInputPixels: 100_000_000,
          })
          const meta = await img.metadata()
          width = meta.width ?? null
          height = meta.pageHeight ?? meta.height ?? null
          animated = (meta.pages ?? 1) > 1
          // A still first frame: list views and avatars that only play on hover use it.
          const thumb = await sharp(buf, { limitInputPixels: 100_000_000 })
            .rotate()
            .resize({ width: THUMB_SIZE[purpose], withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer()
          await ctx.storage.put(`${key}_thumb`, thumb, 'image/webp')
        } catch {
          throw badRequest("This image couldn't be read.")
        }
      }
      await ctx.storage.put(key, buf, mime)
      const [row] = await ctx.db
        .insert(files)
        .values({
          id,
          orgId: scope.orgId,
          uploaderId: scope.userId,
          storageKey: key,
          name,
          mime,
          size: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
          width,
          height,
          animated,
          channelId: channelId ?? null,
          purpose,
        })
        .returning()
      return reply.code(201).send(serializeFile(row!))
    },
  )

  app.get(
    '/api/files/:id/content',
    {
      schema: {
        params: idParams,
        querystring: z.object({ inline: z.string().optional(), thumb: z.string().optional() }),
      },
    },
    async (req, reply) => {
      const me = requireUser(req)
      const f = await ctx.db.query.files.findFirst({
        where: and(eq(files.id, req.params.id), isNull(files.deletedAt)),
      })
      if (!f) throw notFound('File')

      if (f.purpose === 'attachment') {
        const scope = await requireOrg(ctx, req, f.orgId).catch(() => {
          throw notFound('File')
        })
        if (f.messageId || f.channelId) {
          if (f.channelId)
            await getChannelAccess(ctx, scope, f.channelId).catch(() => {
              throw notFound('File')
            })
          if (!f.messageId && f.uploaderId !== me.id) throw notFound('File')
        } else if (f.uploaderId !== me.id) {
          throw notFound('File')
        }
      }
      // Avatars, logos, emoji and sounds are visible to any signed-in user.

      const isImage = PREVIEWABLE_IMAGE_TYPES.has(f.mime)
      const useThumb = isImage && req.query.thumb === '1'
      const inline = isImage && req.query.inline === '1'
      const key = useThumb ? `${f.storageKey}_thumb` : f.storageKey
      const contentType = useThumb ? 'image/webp' : f.mime

      const signed = await ctx.storage.signedUrl(key, { filename: f.name, inline, contentType })
      if (signed) return reply.redirect(signed, 302)

      const obj = await ctx.storage.get(key).catch(() => null)
      if (!obj) throw notFound('File')
      return reply
        .header('Content-Type', contentType)
        .header('Content-Length', obj.size)
        .header(
          'Content-Disposition',
          `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Cache-Control', 'private, max-age=3600')
        .send(obj.stream)
    },
  )

  app.get(
    '/api/orgs/:orgId/channels/:id/files',
    {
      schema: {
        params: orgIdParams,
        querystring: z.object({
          before: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.id, 'read')
      const rows = await ctx.db
        .select({ f: files, uploader: userCols })
        .from(files)
        .leftJoin(users, eq(users.id, files.uploaderId))
        .where(
          and(
            eq(files.channelId, channel.id),
            isNotNull(files.messageId),
            isNull(files.deletedAt),
            req.query.before ? lt(files.id, req.query.before) : undefined,
          ),
        )
        .orderBy(desc(files.id))
        .limit(req.query.limit + 1)
      const more = rows.length > req.query.limit
      const list = rows.slice(0, req.query.limit).map((r) => ({
        ...serializeFile(r.f),
        channelId: r.f.channelId,
        messageId: r.f.messageId,
        uploader: r.uploader?.id ? toUserSummary(r.uploader) : null,
        createdAt: r.f.createdAt.toISOString(),
      }))
      return { files: list, nextCursor: more ? list[list.length - 1]!.id : null }
    },
  )

  app.delete('/api/orgs/:orgId/files/:id', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const f = await ctx.db.query.files.findFirst({
      where: and(
        eq(files.id, req.params.id),
        eq(files.orgId, scope.orgId),
        isNull(files.deletedAt),
      ),
    })
    if (!f) throw notFound('File')
    let allowed = f.uploaderId === scope.userId
    if (!allowed && f.channelId) {
      const a = await getChannelAccess(ctx, scope, f.channelId).catch(() => null)
      allowed = !!a && check(scope, a, 'manage')
    }
    if (!allowed) throw forbidden()
    await ctx.db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, f.id))
    await ctx.storage.delete(f.storageKey)
    await ctx.storage.delete(`${f.storageKey}_thumb`)
    return { ok: true }
  })
}
