'use client'
import type { Channel } from '@quid/shared'
import { Button, Dialog, DialogContent, DialogFooter, Input, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { errorMessage, post } from '@/lib/api'
import { keys, useAiStatus } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { PeoplePicker } from './people-picker'

export function NewMessageDialog({
  open,
  onOpenChange,
  initial = [],
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial?: string[]
}) {
  const { api, org, base, me } = useOrgContext()
  const router = useRouter()
  const qc = useQueryClient()
  const [ids, setIds] = useState<string[]>(initial)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const { assistant } = useAiStatus(org.id)

  const start = async (userIds = ids) => {
    setBusy(true)
    try {
      const c = await post<Channel>(`${api}/conversations`, {
        userIds,
        ...(userIds.length > 1 && name.trim() && { name: name.trim() }),
      })
      qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
        l ? [...l.filter((x) => x.id !== c.id), c] : l,
      )
      onOpenChange(false)
      setIds([])
      setName('')
      router.push(`${base}/c/${c.id}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New message"
        description="Message one person, or several to start a group conversation."
      >
        <PeoplePicker value={ids} onChange={setIds} exclude={[me.id]} autoFocus />
        {assistant && ids.length === 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void start([assistant.id])}
            className="mt-3 flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-bg-muted"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Sparkles className="size-4" />
            </span>
            <span>
              <span className="block text-[13px] font-medium">Chat with Claude</span>
              <span className="block text-xs text-fg-subtle">
                Ask questions, draft messages, brainstorm. Private to you.
              </span>
            </span>
          </button>
        )}
        {ids.length > 1 && (
          <Input
            className="mt-3"
            placeholder="Group name (optional)"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={ids.length === 0}
            loading={busy}
            onClick={() => void start()}
          >
            {ids.length > 1 ? 'Start group' : 'Open conversation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
