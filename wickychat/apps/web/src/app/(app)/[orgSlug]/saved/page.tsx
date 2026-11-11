'use client'
import type { Message, Reminder } from '@quid/shared'
import {
  Button,
  cn,
  EmptyState,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, Bookmark, CheckCircle2, Circle, Clock, Trash2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { MessageCard } from '@/components/message-card'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { useMessageActions } from '@/lib/actions'
import { del, errorMessage, get, patch, post } from '@/lib/api'
import { parseRemind, pkeys, reminderChoices, useReminders, whenLabel } from '@/lib/productivity'
import { keys } from '@/lib/queries'

function SavedList() {
  const { org, api } = useOrgContext()
  const actions = useMessageActions()
  const q = useQuery({
    queryKey: keys.bookmarks(org.id),
    queryFn: ({ signal }) => get<Message[]>(`${api}/bookmarks`, signal),
  })
  if (q.isLoading)
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  if (!q.data?.length)
    return (
      <EmptyState
        emoji="🔖"
        title="Your stash is empty"
        description="Tap the bookmark on any message to save it for later. Only you can see what’s here."
      />
    )
  return (
    <div className="flex flex-col gap-3">
      {q.data.map((m) => (
        <MessageCard
          key={m.id}
          m={m}
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await actions.toggleBookmark({ ...m, bookmarked: true })
                void q.refetch()
              }}
            >
              Remove
            </Button>
          }
        />
      ))}
    </div>
  )
}

function ReminderRow({ r }: { r: Reminder }) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: pkeys.reminders(org.id) })
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      void refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const done = !!r.doneAt
  const overdue = !done && !!r.sentAt
  const controls = (
    <span className="flex items-center gap-1">
      {!done && (
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <Clock /> Snooze
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            {reminderChoices().map((c) => (
              <MenuItem
                key={c.label}
                onSelect={() =>
                  act(() => patch(`${api}/reminders/${r.id}`, { dueAt: c.at.toISOString() }))
                }
              >
                {c.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
      <IconButton
        label="Delete reminder"
        size="sm"
        onClick={() => act(() => del(`${api}/reminders/${r.id}`))}
      >
        <Trash2 />
      </IconButton>
    </span>
  )
  const check = (
    <button
      type="button"
      aria-label={done ? 'Mark not done' : 'Mark done'}
      onClick={() => act(() => patch(`${api}/reminders/${r.id}`, { done: !done }))}
      className={cn('shrink-0', done ? 'text-success' : 'text-fg-subtle hover:text-success')}
    >
      {done ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
    </button>
  )
  const when = (
    <span
      className={cn(
        'flex items-center gap-1 text-xs',
        overdue ? 'font-medium text-danger' : 'text-fg-subtle',
      )}
    >
      <AlarmClock className="size-3.5" />
      {overdue ? `Was due ${whenLabel(r.dueAt)}` : whenLabel(r.dueAt)}
    </span>
  )
  if (r.message)
    return (
      <li className={cn('flex gap-3', done && 'opacity-60')}>
        <span className="pt-3">{check}</span>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            {when}
            {controls}
          </div>
          <MessageCard m={r.message} />
        </div>
      </li>
    )
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-bg px-3 py-2.5',
        done && 'opacity-60',
      )}
    >
      {check}
      <div className="min-w-0 flex-1">
        <p className={cn('text-[14px]', done && 'line-through')}>
          {r.text || 'A message that was deleted'}
        </p>
        {when}
      </div>
      {controls}
    </li>
  )
}

function Reminders() {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const q = useReminders()
  const [text, setText] = useState('')
  const parsed = text.trim() ? parseRemind(text) : null
  const add = async () => {
    if (!parsed) return
    try {
      await post(`${api}/reminders`, { text: parsed.what, dueAt: parsed.due.toISOString() })
      setText('')
      toast.success(`Reminder set for ${whenLabel(parsed.due.toISOString()).toLowerCase()}`)
      void qc.invalidateQueries({ queryKey: pkeys.reminders(org.id) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const open = (q.data ?? []).filter((r) => !r.doneAt)
  const done = (q.data ?? []).filter((r) => r.doneAt)
  return (
    <>
      <form
        className="mb-6"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <div className="flex gap-2">
          <Input
            aria-label="New reminder"
            placeholder="Remind me… e.g. “in 2 hours call the bank” or “tomorrow 9am review the deck”"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={!parsed}>
            Add
          </Button>
        </div>
        <p className="mt-1.5 min-h-4 text-xs text-fg-subtle">
          {text.trim()
            ? parsed
              ? `“${parsed.what}” · ${whenLabel(parsed.due.toISOString())}`
              : 'Start with a time: “in 20m …”, “at 5pm …”, “tomorrow …”'
            : 'You can also type /remind in any message box, or use “Remind me about this” on a message.'}
        </p>
      </form>
      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : !q.data?.length ? (
        <EmptyState
          emoji="⏰"
          title="Nothing to nag you about"
          description="Set one above, or from any message’s menu. Future you says thanks."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {open.map((r) => (
              <ReminderRow key={r.id} r={r} />
            ))}
          </ul>
          {done.length > 0 && (
            <>
              <h3 className="mt-8 mb-3 text-xs font-semibold text-fg-subtle uppercase">
                Completed
              </h3>
              <ul className="flex flex-col gap-3">
                {done.map((r) => (
                  <ReminderRow key={r.id} r={r} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  )
}

function LaterInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { base } = useOrgContext()
  const tab = params.get('tab') === 'reminders' ? 'reminders' : 'saved'
  const reminders = useReminders()
  const pending = (reminders.data ?? []).filter((r) => !r.doneAt).length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Later" icon={<Bookmark />}>
        <nav className="flex gap-4 px-3 md:px-6" aria-label="Later">
          {(
            [
              ['saved', 'Saved'],
              ['reminders', `Reminders${pending ? ` (${pending})` : ''}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-current={tab === k ? 'page' : undefined}
              onClick={() =>
                router.replace(`${base}/saved${k === 'reminders' ? '?tab=reminders' : ''}`)
              }
              className={cn(
                '-mb-px h-9 border-b-2 border-transparent text-[13px] font-medium text-fg-muted hover:text-fg',
                tab === k && 'border-fg text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-6">
          {tab === 'saved' ? <SavedList /> : <Reminders />}
        </div>
      </div>
    </div>
  )
}

export default function LaterPage() {
  return (
    <Suspense>
      <LaterInner />
    </Suspense>
  )
}
