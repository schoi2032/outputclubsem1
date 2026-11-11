'use client'
import type { Channel, Task, TaskStatus, UserSummary } from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleDot,
  MessageSquareText,
  Plus,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { del, errorMessage, get, patch, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { useTasks } from '@/lib/productivity'
import { keys } from '@/lib/queries'
import { useOrgContext } from '../org-context'

export const STATUS: Record<TaskStatus, { label: string; icon: typeof Circle; tone: string }> = {
  todo: { label: 'To do', icon: Circle, tone: 'text-fg-subtle' },
  doing: { label: 'In progress', icon: CircleDot, tone: 'text-accent-text' },
  done: { label: 'Done', icon: CheckCircle2, tone: 'text-success' },
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dueLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const days = Math.round(
    (new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86_400_000,
  )
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Tomorrow ${time}`
  if (days === -1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function DueChip({ task }: { task: Task }) {
  if (!task.dueAt) return null
  const overdue = task.status !== 'done' && new Date(task.dueAt) < new Date()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium',
        overdue ? 'bg-danger/10 text-danger' : 'bg-bg-muted text-fg-muted',
      )}
    >
      <CalendarClock className="size-3" />
      {dueLabel(task.dueAt)}
    </span>
  )
}

function useChannelPeople(channelId: string, enabled: boolean) {
  const { api } = useOrgContext()
  return useQuery({
    queryKey: keys.channelMembers(channelId),
    queryFn: ({ signal }) => get<UserSummary[]>(`${api}/channels/${channelId}/members`, signal),
    enabled,
  })
}

/** Create or edit a task. */
export function TaskDialog({
  open,
  onOpenChange,
  channel,
  task,
  initial,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  channel: Pick<Channel, 'id' | 'name'>
  task?: Task | null
  initial?: { title?: string; messageId?: string | null }
}) {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const people = useChannelPeople(channel.id, open)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? initial?.title?.slice(0, 300) ?? '')
    setNotes(task?.notes ?? '')
    setAssignee(task?.assignee?.id ?? '')
    setDue(toLocalInput(task?.dueAt ?? null))
    setStatus(task?.status ?? 'todo')
  }, [open, task, initial?.title])

  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks', org.id] })
  const submit = async () => {
    setBusy(true)
    const body = {
      title: title.trim(),
      notes,
      assigneeId: assignee || null,
      dueAt: due ? new Date(due).toISOString() : null,
    }
    try {
      if (task) await patch(`${api}/tasks/${task.id}`, { ...body, status })
      else
        await post(`${api}/tasks`, {
          ...body,
          channelId: channel.id,
          messageId: initial?.messageId ?? null,
        })
      toast.success(task ? 'Task updated' : 'Task created')
      void refresh()
      onOpenChange(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const humans = (people.data ?? []).filter((p) => !p.isBot)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={task ? 'Edit task' : 'New task'}
        description={channel.name ? `In #${channel.name}` : undefined}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim()) void submit()
          }}
        >
          <Field label="Task">
            {(p) => (
              <Input
                {...p}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs doing?"
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assignee">
              {(p) => (
                <Select {...p} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Nobody yet</option>
                  {humans.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id === me.id ? `${displayName(u)} (you)` : displayName(u)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Due">
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              )}
            </Field>
          </div>
          {task && (
            <Field label="Status">
              {(p) => (
                <Select
                  {...p}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                >
                  {(Object.keys(STATUS) as TaskStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS[s].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Notes">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Details, links, acceptance criteria…"
              />
            )}
          </Field>
          <DialogFooter>
            {task && (
              <Button
                type="button"
                variant="danger-ghost"
                className="mr-auto"
                onClick={async () => {
                  try {
                    await del(`${api}/tasks/${task.id}`)
                    void refresh()
                    onOpenChange(false)
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              >
                Delete
              </Button>
            )}
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
              {task ? 'Save' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A task row/card with a one-click done toggle. */
export function TaskCard({
  task,
  onOpen,
  showChannel,
}: {
  task: Task
  onOpen: () => void
  showChannel?: boolean
}) {
  const { api, org, base } = useOrgContext()
  const qc = useQueryClient()
  const S = STATUS[task.status]
  const toggle = async () => {
    try {
      await patch(`${api}/tasks/${task.id}`, { status: task.status === 'done' ? 'todo' : 'done' })
      void qc.invalidateQueries({ queryKey: ['tasks', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <div className="group flex items-start gap-2.5 rounded-lg border border-border bg-bg p-2.5 shadow-[0_1px_1px_rgb(0_0_0/0.02)] hover:border-border-strong">
      <button
        type="button"
        onClick={toggle}
        aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Mark ${task.title} done`}
        className={cn('mt-0.5 shrink-0 rounded-full', S.tone, 'hover:text-success')}
      >
        <S.icon className="size-[18px]" />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            'block text-[13.5px] leading-snug',
            task.status === 'done' && 'text-fg-subtle line-through',
          )}
        >
          {task.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
          <DueChip task={task} />
          {showChannel && task.channelName && (
            <span className="text-[11.5px] text-fg-subtle">#{task.channelName}</span>
          )}
          {task.notes && <span className="text-[11.5px] text-fg-subtle">Notes</span>}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
        {task.messageId && (
          <Link
            href={`${base}/c/${task.channelId}?m=${task.messageId}`}
            aria-label="Open the message"
            title="Open the message"
            className="rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100"
          >
            <MessageSquareText className="size-3.5" />
          </Link>
        )}
        {task.assignee && (
          <Avatar
            name={task.assignee.name}
            id={task.assignee.id}
            src={task.assignee.avatarUrl}
            decoration={task.assignee.decoration}
            size="xs"
          />
        )}
      </span>
    </div>
  )
}

/** A channel's tasks as a board: To do, In progress, Done. */
export function TasksTab({
  channel,
  canEdit,
  openTaskId,
}: {
  channel: Channel
  canEdit: boolean
  openTaskId?: string | null
}) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const q = useTasks({ channelId: channel.id })
  const [quick, setQuick] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (openTaskId && q.data) setEditing(q.data.find((t) => t.id === openTaskId) ?? null)
  }, [openTaskId, q.data])

  const add = async () => {
    const title = quick.trim()
    if (!title) return
    setQuick('')
    try {
      await post(`${api}/tasks`, { channelId: channel.id, title })
      void qc.invalidateQueries({ queryKey: ['tasks', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
      setQuick(title)
    }
  }

  const tasks = q.data ?? []
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Tasks</h2>
            <p className="text-[13px] text-fg-muted">
              To-dos for this channel. Turn any message into a task from its menu, or type{' '}
              <code className="font-mono">/todo</code>.
            </p>
          </div>
          {canEdit && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> New task
            </Button>
          )}
        </div>
        {canEdit && (
          <form
            className="mb-5 flex max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void add()
            }}
          >
            <Input
              aria-label="Quick add a task"
              placeholder="Add a task and press Enter"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
            />
          </form>
        )}
        {q.isLoading ? (
          <Skeleton className="h-48" />
        ) : !tasks.length ? (
          <EmptyState
            emoji="✅"
            title="No tasks yet"
            description="Track who's doing what, by when, right where you talk about it."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {(Object.keys(STATUS) as TaskStatus[]).map((s) => {
              const col = tasks.filter((t) => t.status === s)
              const S = STATUS[s]
              return (
                <section
                  key={s}
                  aria-label={S.label}
                  className="flex min-w-0 flex-col rounded-xl bg-bg-subtle p-2"
                >
                  <h3 className="flex items-center gap-1.5 px-1.5 pt-1 pb-2 text-[12.5px] font-semibold text-fg-muted">
                    <S.icon className={cn('size-3.5', S.tone)} />
                    {S.label}
                    <span className="font-normal text-fg-subtle">{col.length}</span>
                  </h3>
                  <div className="flex flex-col gap-1.5">
                    {col.map((t) => (
                      <TaskCard key={t.id} task={t} onOpen={() => setEditing(t)} />
                    ))}
                    {!col.length && (
                      <p className="px-1.5 py-3 text-xs text-fg-subtle">Nothing here.</p>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
      <TaskDialog open={creating} onOpenChange={setCreating} channel={channel} />
      <TaskDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        channel={channel}
        task={editing}
      />
    </div>
  )
}
