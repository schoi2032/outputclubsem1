'use client'
import { type Attachment, cssImageUrl } from '@quid/shared'
import { toast } from '@quid/ui'
import { ImagePlus } from 'lucide-react'
import { type RefObject, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, upload } from '@/lib/api'

export function insertAtCursor(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  text: string,
  set: (v: string) => void,
) {
  const el = ref.current
  const at = el && document.activeElement === el ? el.selectionStart : value.length
  const next = value.slice(0, at) + text + value.slice(at)
  set(next)
  requestAnimationFrame(() => {
    if (!el) return
    el.focus()
    el.selectionStart = el.selectionEnd = at + text.length
  })
}

export function CssImageButton({ onAdd }: { onAdd: (snippet: string) => void }) {
  const { api } = useOrgContext()
  const [busy, setBusy] = useState(false)
  return (
    <label
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-bg-muted"
      onMouseDown={(e) => e.preventDefault()}
    >
      <ImagePlus className="size-3.5" /> {busy ? 'Uploading…' : 'Add image'}
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setBusy(true)
          try {
            const a = await upload<Attachment>(`${api}/files?purpose=cosmetic`, f).promise
            onAdd(cssImageUrl(a.id))
            toast.success('Image added to your CSS')
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      />
    </label>
  )
}
