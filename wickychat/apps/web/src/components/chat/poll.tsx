'use client'
/**
 * WickyChat: polls and quizzes in chat. PollCard shows under the message; PollButton opens
 * the dialog to make one.
 */
import { type Channel, POLL_REWARD_MAX, type Poll } from '@quid/shared'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  Tooltip,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Check, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { errorMessage, get, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { useOrgContext } from '../org-context'

export function PollCard({ pollId }: { pollId: string }) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const key = ['poll', org.id, pollId]
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<Poll>(`${api}/polls/${pollId}`, signal),
    // Live-ish results while it's open.
    refetchInterval: (query) => (query.state.data?.closed ? false : 5000),
  })
  const [picked, setPicked] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const p = q.data
  if (!p) return <div className="mt-2 h-24 max-w-md animate-pulse rounded-lg bg-bg-muted" />

  const answered = p.myVotes.length > 0
  const isQuiz = p.kind === 'quiz'
  const showResults = answered || p.closed
  const selection = picked ?? p.myVotes
  const max = Math.max(1, ...p.options.map((o) => o.votes))

  const vote = async (ids: string[]) => {
    setBusy(true)
    try {
      const next = await post<Poll>(`${api}/polls/${pollId}/vote`, { optionIds: ids })
      qc.setQueryData(key, next)
      setPicked(null)
      if (!answered && next.reward > 0) {
        if (!isQuiz) toast.success(`+${next.reward} Wicky Coins for voting 🪙`)
        else if (next.correctOptionId === ids[0])
          toast.success(`Correct! +${next.reward} Wicky Coins 🧠`)
        else toast.info('Not quite. The right answer is highlighted.')
      }
      void qc.invalidateQueries({ queryKey: ['wallet'] })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const close = async () => {
    try {
      qc.setQueryData(key, await post<Poll>(`${api}/polls/${pollId}/close`, {}))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const click = (id: string) => {
    if (p.closed || busy || (isQuiz && answered)) return
    if (p.multiple) {
      const cur = picked ?? p.myVotes
      setPicked(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
    } else void vote([id])
  }

  return (
    <div className="mt-2 max-w-md rounded-lg border border-border bg-bg-subtle p-3">
      <p className="mb-0.5 text-2xs font-semibold text-fg-subtle uppercase">
        {isQuiz ? '🧠 Quiz' : '📊 Poll'}
        {p.multiple && ' · pick any'}
        {p.anonymous && ' · anonymous'}
        {p.reward > 0 && ` · 🪙 ${p.reward} ${isQuiz ? 'for the right answer' : 'for voting'}`}
      </p>
      <p className="mb-2 text-[14px] font-semibold">{p.question}</p>
      <ul className="flex flex-col gap-1.5">
        {p.options.map((o) => {
          const mine = selection.includes(o.id)
          const correct = isQuiz && p.correctOptionId === o.id
          const wrong = isQuiz && showResults && mine && !correct
          const who = p.voters[o.id] ?? []
          const row = (
            <button
              type="button"
              disabled={p.closed || (isQuiz && answered)}
              onClick={() => click(o.id)}
              className={cn(
                'relative isolate flex w-full items-center gap-2 overflow-hidden rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors',
                mine ? 'border-accent' : 'border-border',
                correct && showResults && 'border-success',
                wrong && 'border-danger',
                !p.closed && !(isQuiz && answered) && 'hover:bg-bg-muted',
              )}
            >
              {showResults && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-0 left-0 -z-10',
                    correct ? 'bg-success/20' : wrong ? 'bg-danger/15' : 'bg-accent/15',
                  )}
                  style={{ width: `${(o.votes / max) * 100}%` }}
                />
              )}
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center border',
                  p.multiple ? 'rounded' : 'rounded-full',
                  mine ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong',
                )}
              >
                {mine && <Check className="size-3" />}
              </span>
              <span className="min-w-0 flex-1">{o.text}</span>
              {correct && showResults && <span className="text-xs text-success">✓ answer</span>}
              {showResults && <span className="text-xs text-fg-muted tabular-nums">{o.votes}</span>}
            </button>
          )
          return (
            <li key={o.id}>
              {who.length && showResults ? (
                <Tooltip content={who.map(displayName).slice(0, 15).join(', ')}>{row}</Tooltip>
              ) : (
                row
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span>
          {p.totalVoters} {p.totalVoters === 1 ? 'vote' : 'votes'}
          {p.closed
            ? ' · closed'
            : p.closesAt
              ? ` · closes ${new Date(p.closesAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
              : ''}
        </span>
        <span className="flex-1" />
        {p.multiple && picked && !p.closed && (
          <Button size="sm" variant="primary" loading={busy} onClick={() => vote(picked)}>
            {answered ? 'Update vote' : 'Vote'}
          </Button>
        )}
        {p.canClose && (
          <Button size="sm" variant="ghost" onClick={close}>
            Close {isQuiz ? 'quiz' : 'poll'}
          </Button>
        )}
      </div>
    </div>
  )
}

function Toggle({
  text,
  checked,
  onChange,
}: {
  text: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span aria-hidden="true">{text}</span>
      <Switch label={text} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

const DURATIONS = [
  { value: '', label: 'Never' },
  { value: '10', label: '10 minutes' },
  { value: '60', label: '1 hour' },
  { value: '1440', label: '1 day' },
  { value: '10080', label: '1 week' },
]

export function PollButton({ channel }: { channel: Channel }) {
  const { api, org } = useOrgContext()
  const teacher = org.role === 'owner' || org.role === 'admin'
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'poll' | 'quiz'>('poll')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [correct, setCorrect] = useState(0)
  const [multiple, setMultiple] = useState(false)
  const [anonymous, setAnonymous] = useState(false)
  const [reward, setReward] = useState(0)
  const [closes, setCloses] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setQuestion('')
    setOptions(['', ''])
    setCorrect(0)
    setMultiple(false)
    setAnonymous(false)
    setReward(0)
    setCloses('')
  }
  const filled = options.map((o) => o.trim()).filter(Boolean)
  const submit = async () => {
    setBusy(true)
    try {
      await post(`${api}/channels/${channel.id}/polls`, {
        kind,
        question,
        options: filled,
        ...(kind === 'quiz' && {
          correctIndex: filled.indexOf(options[correct]?.trim() ?? ''),
        }),
        multiple,
        anonymous,
        reward,
        ...(closes && { closesInMinutes: Number(closes) }),
      })
      setOpen(false)
      reset()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Tooltip content={teacher ? 'Poll or quiz' : 'Poll'}>
        <IconButton label="Create a poll" size="sm" onClick={() => setOpen(true)}>
          <BarChart3 />
        </IconButton>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={kind === 'quiz' ? 'New quiz' : 'New poll'}
          description={
            kind === 'quiz'
              ? 'Students pick one answer. They see if they got it right straight away.'
              : 'Everyone in the channel can vote.'
          }
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            {teacher && (
              <div className="inline-flex self-start rounded-lg border border-border p-0.5 text-[13px]">
                {(['poll', 'quiz'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      'rounded-md px-3 py-1',
                      kind === k ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-muted',
                    )}
                  >
                    {k === 'poll' ? '📊 Poll' : '🧠 Quiz'}
                  </button>
                ))}
              </div>
            )}
            <Field label="Question">
              {(p) => (
                <Input
                  {...p}
                  required
                  maxLength={200}
                  autoFocus
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] font-medium">
                Options{kind === 'quiz' && ' (tick the right answer)'}
              </p>
              {options.map((o, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: options are edited in place
                <div key={i} className="flex items-center gap-1.5">
                  {kind === 'quiz' && (
                    <input
                      type="radio"
                      name="correct"
                      aria-label={`Option ${i + 1} is the right answer`}
                      checked={correct === i}
                      onChange={() => setCorrect(i)}
                      className="accent-[var(--q-success)]"
                    />
                  )}
                  <Input
                    aria-label={`Option ${i + 1}`}
                    maxLength={80}
                    value={o}
                    placeholder={`Option ${i + 1}`}
                    onChange={(e) =>
                      setOptions(options.map((x, j) => (j === i ? e.target.value : x)))
                    }
                  />
                  {options.length > 2 && (
                    <IconButton
                      label="Remove option"
                      size="sm"
                      onClick={() => {
                        setOptions(options.filter((_, j) => j !== i))
                        if (correct >= i && correct > 0) setCorrect(correct - 1)
                      }}
                    >
                      <X />
                    </IconButton>
                  )}
                </div>
              ))}
              {options.length < 10 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => setOptions([...options, ''])}
                >
                  <Plus /> Add option
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Closes after">
                {(p) => (
                  <Select {...p} value={closes} onChange={(e) => setCloses(e.target.value)}>
                    {DURATIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {teacher && (
                <Field
                  label="Coin reward"
                  hint={kind === 'quiz' ? 'For the right answer' : 'For voting'}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={0}
                      max={POLL_REWARD_MAX}
                      value={reward}
                      onChange={(e) => setReward(Number(e.target.value))}
                    />
                  )}
                </Field>
              )}
            </div>
            {kind === 'poll' && (
              <Toggle
                text="Let people pick more than one"
                checked={multiple}
                onChange={setMultiple}
              />
            )}
            <Toggle
              text={teacher ? "Anonymous (students can't see who voted)" : 'Anonymous'}
              checked={anonymous}
              onChange={setAnonymous}
            />
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={
                  !question.trim() ||
                  filled.length < 2 ||
                  (kind === 'quiz' && !options[correct]?.trim())
                }
              >
                Post {kind}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
