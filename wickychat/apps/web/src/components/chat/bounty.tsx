'use client'
/**
 * WickyChat Q&A bounties in chat. BountyCard sits under the question; BountyButton asks one.
 * People answer in the thread and the asker picks the best answer.
 */
import { BOUNTY, type Bounty, type Channel, type UserSummary, type Wallet } from '@quid/shared'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  IconButton,
  Input,
  Textarea,
  Tooltip,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import { errorMessage, get, post } from '@/lib/api'
import { displayName, relative } from '@/lib/format'
import { useOrgContext } from '../org-context'

type Answer = { messageId: string; author: UserSummary; text: string; createdAt: string }

export function BountyCard({
  bountyId,
  onOpenThread,
}: {
  bountyId: string
  onOpenThread?: () => void
}) {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const key = ['bounty', org.id, bountyId]
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<Bounty>(`${api}/bounties/${bountyId}`, signal),
  })
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const b = q.data
  if (!b) return <div className="mt-2 h-16 max-w-sm animate-pulse rounded-lg bg-bg-muted" />
  const mine = b.asker.id === me.id
  const teacher = org.role === 'owner' || org.role === 'admin'

  const cancel = async () => {
    setBusy(true)
    try {
      const r = await post<{ bounty: Bounty; wallet: Wallet }>(`${api}/bounties/${b.id}/cancel`, {})
      qc.setQueryData(key, r.bounty)
      if (mine) qc.setQueryData(['wallet'], r.wallet)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'mt-2 flex max-w-md flex-wrap items-center gap-3 rounded-xl border p-3',
        b.status === 'open' ? 'border-[#ffb829]/60 bg-[#ffb829]/10' : 'border-border bg-bg-subtle',
      )}
    >
      <span className="text-[24px]" aria-hidden="true">
        {b.status === 'awarded' ? '🏅' : '❓'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">🪙 {b.amount} bounty</p>
        <p className="text-xs text-fg-muted">
          {b.status === 'open'
            ? 'Answer in the thread. The best answer wins the coins.'
            : b.status === 'awarded'
              ? `${b.winner ? displayName(b.winner) : 'Someone'} won it with the best answer!`
              : 'Called off. Coins went back.'}
        </p>
      </div>
      {b.status === 'open' && (
        <div className="flex gap-1.5">
          {onOpenThread && !mine && (
            <Button size="sm" variant="primary" onClick={onOpenThread}>
              Answer
            </Button>
          )}
          {mine && (
            <Button size="sm" variant="primary" onClick={() => setPicking(true)}>
              Pick best answer
            </Button>
          )}
          {(mine || teacher) && (
            <Button size="sm" loading={busy} onClick={cancel}>
              Call off
            </Button>
          )}
        </div>
      )}
      {picking && (
        <PickAnswer
          b={b}
          onClose={() => setPicking(false)}
          onDone={(n) => qc.setQueryData(key, n)}
        />
      )}
    </div>
  )
}

function PickAnswer({
  b,
  onClose,
  onDone,
}: {
  b: Bounty
  onClose: () => void
  onDone: (b: Bounty) => void
}) {
  const { api, org } = useOrgContext()
  const answers = useQuery({
    queryKey: ['bounty-answers', org.id, b.id],
    queryFn: ({ signal }) => get<Answer[]>(`${api}/bounties/${b.id}/answers`, signal),
  })
  const [busy, setBusy] = useState<string | null>(null)
  const award = async (a: Answer) => {
    setBusy(a.messageId)
    try {
      const r = await post<{ bounty: Bounty }>(`${api}/bounties/${b.id}/award`, {
        messageId: a.messageId,
      })
      onDone(r.bounty)
      toast.success(`${displayName(a.author)} wins 🪙 ${b.amount}! 🏅`)
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Pick the best answer" description={`They get your 🪙 ${b.amount}.`}>
        {!answers.data ? (
          <div className="h-24 animate-pulse rounded-lg bg-bg-muted" />
        ) : !answers.data.length ? (
          <p className="text-[13px] text-fg-subtle">No answers in the thread yet.</p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {answers.data.map((a) => (
              <li
                key={a.messageId}
                className="flex items-start gap-2 rounded-lg border border-border p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">
                    {displayName(a.author)}{' '}
                    <span className="font-normal text-fg-subtle">{relative(a.createdAt)}</span>
                  </p>
                  <p className="text-[13px] whitespace-pre-wrap">{a.text}</p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === a.messageId}
                  onClick={() => award(a)}
                >
                  🏅 Best
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BountyButton({ channel }: { channel: Channel }) {
  const { api } = useOrgContext()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [amount, setAmount] = useState(20)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await post(`${api}/channels/${channel.id}/bounties`, { question, amount })
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      setOpen(false)
      setQuestion('')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Tooltip content="Ask with a coin bounty">
        <IconButton label="Ask with a coin bounty" size="sm" onClick={() => setOpen(true)}>
          <MessageCircleQuestion />
        </IconButton>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="❓ Ask with a bounty"
          description="Put coins on your question. People answer in the thread, and you give the coins to the best answer. Once someone answers, you can't take them back."
        >
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label="Your question"
              placeholder="How do I solve question 4 on the worksheet?"
              rows={3}
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              {[10, 20, 50, 100].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={amount === n ? 'primary' : 'secondary'}
                  onClick={() => setAmount(n)}
                >
                  {n}
                </Button>
              ))}
              <Input
                type="number"
                aria-label="Bounty"
                min={BOUNTY.min}
                max={BOUNTY.max}
                value={amount}
                onChange={(e) =>
                  setAmount(
                    Math.max(
                      BOUNTY.min,
                      Math.min(BOUNTY.max, Number(e.target.value) || BOUNTY.min),
                    ),
                  )
                }
                className="w-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={question.trim().length < 5}
              onClick={submit}
            >
              Ask · 🪙 {amount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
