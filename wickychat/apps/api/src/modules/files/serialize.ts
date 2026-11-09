import type { files } from '@quid/db'
import type { Attachment } from '@quid/shared'
import { PREVIEWABLE_IMAGE_TYPES } from '@quid/shared'

type FileRow = typeof files.$inferSelect

export function serializeFile(f: FileRow): Attachment {
  const isImage = PREVIEWABLE_IMAGE_TYPES.has(f.mime)
  return {
    id: f.id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    width: f.width,
    height: f.height,
    url: `/api/files/${f.id}/content`,
    thumbnailUrl: isImage ? `/api/files/${f.id}/content?inline=1&thumb=1` : null,
    isImage,
  }
}

export const serializeFiles = (rows: FileRow[]) => rows.map(serializeFile)
