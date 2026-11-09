'use client'
import type { Meeting } from '@quid/shared'
import { Button, Dialog, DialogContent, DialogFooter, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, RefreshCw, Send, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { errorMessage, get, post } from '@/lib/api'
import { relative } from '@/lib/format'
import { AiText } from '../chat/catch-up'
import { useOrgContext } from '../org-context'

type Notes = {
  summary: string
  transcriptLines: number
  outdated: boolean
  updatedAt: string
}

/** Claude's notes for a meeting: view, (re)write and share to the meeting's channel. */
export function MeetingNotesDialog({
  m,
  open,
  onOpenChange,
}: {
  m: Meeting
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const key = ['meeting-notes', org.id, m.code]
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      get<{ notes: Notes | null }>(`${api}/meetings/${m.code}/notes`, signal),
    enabled: open,
  })
  const [writing, setWriting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const notes = q.data?.notes ?? null

  const write = async () => {
    setWriting(true)
    try {
      const r = await post<{ notes: Notes }>(`${api}/meetings/${m.code}/notes`)
      qc.setQueryData(key, r)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setWriting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Notes: ${m.title}`}
        description="Written by Claude from the meeting transcript. Only attendees can see them unless someone shares them."
        wide
      >
        {q.isLoading || writing ? (
          <div className="space-y-2" role="status" aria-label="Loading notes">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5" />
            <Skeleton className="h-3.5 w-1/2" />
            {writing && (
              <p className="pt-1 text-xs text-fg-subtle">Claude is reading the transcript…</p>
            )}
          </div>
        ) : q.isError ? (
          <p className="text-[13px] text-fg-muted">{errorMessage(q.error)}</p>
        ) : notes ? (
          <>
            {notes.outdated && (
              <p className="mb-3 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-xs text-fg-muted">
                The transcript has new lines since these notes were written.
              </p>
            )}
            <div className="max-h-[50vh] overflow-y-auto">
              <AiText text={notes.summary} />
            </div>
            <p className="mt-3 text-2xs text-fg-subtle">
              Updated {relative(notes.updatedAt)} from {notes.transcriptLines} transcript lines.
              Captions can mishear, so check anything important.
            </p>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 text-[13px] text-fg-muted">
            No notes yet. Claude can write a summary, decisions and action items from the
            transcript.
            <Button variant="primary" onClick={() => void write()}>
              <Sparkles /> Write notes
            </Button>
          </div>
        )}
        {notes && !writing && (
          <DialogFooter>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(notes.summary)
                toast.success('Notes copied')
              }}
            >
              <Copy /> Copy
            </Button>
            <Button onClick={() => void write()}>
              <RefreshCw /> {notes.outdated ? 'Update' : 'Rewrite'}
            </Button>
            {m.channelId && (
              <Button
                variant="primary"
                loading={sharing}
                onClick={async () => {
                  setSharing(true)
                  try {
                    await post(`${api}/meetings/${m.code}/notes/share`)
                    toast.success('Notes shared to the channel')
                  } catch (e) {
                    toast.error(errorMessage(e))
                  } finally {
                    setSharing(false)
                  }
                }}
              >
                <Send /> Share to channel
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
