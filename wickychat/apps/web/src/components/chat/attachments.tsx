'use client'
import type { Attachment } from '@quid/shared'
import { Dialog, DialogContent, IconButton } from '@quid/ui'
import {
  Download,
  FileArchive,
  FileAudio,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from 'lucide-react'
import { useState } from 'react'
import { fileSize } from '@/lib/format'

export function fileIcon(mime: string) {
  if (mime.startsWith('video/')) return FileVideo
  if (mime.startsWith('audio/')) return FileAudio
  if (mime.includes('zip')) return FileArchive
  if (mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv')
    return FileSpreadsheet
  if (
    mime.startsWith('text/') ||
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('presentation') ||
    mime.includes('json')
  )
    return FileText
  return FileIcon
}

function typeLabel(a: Attachment) {
  if (a.mime === 'application/pdf') return 'PDF'
  const ext = a.name.split('.').pop()
  return ext && ext.length <= 5 ? ext.toUpperCase() : a.mime.split('/')[1]?.toUpperCase()
}

export function FileCard({ a }: { a: Attachment }) {
  const Icon = fileIcon(a.mime)
  return (
    <a
      href={a.url}
      className="group/file flex w-full max-w-sm items-center gap-3 rounded-lg border border-border bg-bg p-2.5 pr-3 transition-colors hover:bg-bg-subtle"
      download={a.name}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-text">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{a.name}</span>
        <span className="block text-xs text-fg-subtle">
          {typeLabel(a)} · {fileSize(a.size)}
        </span>
      </span>
      <Download className="size-4 text-fg-subtle opacity-0 transition-opacity group-hover/file:opacity-100" />
    </a>
  )
}

export function Attachments({ items }: { items: Attachment[] }) {
  const [preview, setPreview] = useState<Attachment | null>(null)
  if (!items.length) return null
  const images = items.filter((a) => a.isImage)
  const others = items.filter((a) => !a.isImage)
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((a) => {
            const w = Math.min(a.width ?? 360, 360)
            const h = a.width && a.height ? Math.round((w / a.width) * a.height) : 240
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setPreview(a)}
                className="overflow-hidden rounded-lg border border-border bg-bg-muted"
                aria-label={`Open ${a.name}`}
              >
                <img
                  src={a.thumbnailUrl ?? a.url}
                  alt={a.name}
                  loading="lazy"
                  width={w}
                  height={Math.min(h, 320)}
                  className="max-h-80 object-cover"
                  style={{ width: w, height: Math.min(h, 320) }}
                />
              </button>
            )
          })}
        </div>
      )}
      {others.map((a) => (
        <FileCard key={a.id} a={a} />
      ))}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        {preview && (
          <DialogContent
            title={preview.name}
            description={fileSize(preview.size)}
            wide
            className="max-w-4xl"
          >
            <img
              src={`${preview.url}?inline=1`}
              alt={preview.name}
              className="mx-auto max-h-[60vh] rounded-md object-contain"
            />
            <div className="mt-3 flex justify-end">
              <IconButton
                label="Download"
                onClick={() => window.open(preview.url, '_blank', 'noopener')}
              >
                <Download />
              </IconButton>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
