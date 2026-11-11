'use client'
import type { Message } from '@quid/shared'
import { textToDoc } from '@quid/shared'
import { Button, cn, Dialog, DialogContent, DialogFooter, Input, toast } from '@quid/ui'
import { Hash, Lock, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMessageActions } from '@/lib/actions'
import { errorMessage } from '@/lib/api'
import { channelTitle, isDirect } from '@/lib/channels'
import { useChannels } from '@/lib/queries'
import { useOrgContext } from '../org-context'

export function ForwardDialog({
  message,
  onClose,
}: {
  message: Message | null
  onClose: () => void
}) {
  const { org, me } = useOrgContext()
  const channels = useChannels(org.id)
  const actions = useMessageActions()
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const list = useMemo(
    () =>
      (channels.data ?? [])
        .filter(
          (c) => !c.archivedAt && channelTitle(c, me.id).toLowerCase().includes(q.toLowerCase()),
        )
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
        .slice(0, 30),
    [channels.data, q, me.id],
  )

  return (
    <Dialog
      open={!!message}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setTarget(null)
          setComment('')
          setQ('')
        }
      }}
    >
      <DialogContent
        title="Forward message"
        description="A copy of the message is shared. People there won't get access to the original conversation."
      >
        <Input
          placeholder="Search channels and people"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border p-1">
          {list.map((c) => {
            const Icon = isDirect(c) ? Users : c.kind === 'private' ? Lock : Hash
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setTarget(c.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-bg-muted',
                    target === c.id && 'bg-accent-subtle text-accent-text',
                  )}
                >
                  <Icon className="size-3.5 opacity-70" />
                  {channelTitle(c, me.id)}
                </button>
              </li>
            )
          })}
        </ul>
        <Input
          className="mt-3"
          placeholder="Add a message (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        {message && (
          <blockquote className="mt-3 border-l-2 border-border-strong pl-3 text-[13px] text-fg-muted">
            <span className="font-medium text-fg">
              {message.author.displayName || message.author.name}
            </span>
            <p className="line-clamp-3">{message.text || 'Attachment'}</p>
          </blockquote>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!target}
            loading={busy}
            onClick={async () => {
              if (!message || !target) return
              setBusy(true)
              try {
                await actions.forward(
                  message,
                  target,
                  comment.trim() ? textToDoc(comment.trim()) : undefined,
                )
                toast.success('Message forwarded')
                onClose()
              } catch (e) {
                toast.error(errorMessage(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
