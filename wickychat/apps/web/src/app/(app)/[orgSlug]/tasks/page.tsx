'use client'
import type { Task } from '@quid/shared'
import { cn, EmptyState, Skeleton } from '@quid/ui'
import { ListTodo } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { TaskCard, TaskDialog } from '@/components/productivity/tasks'
import { useTasks } from '@/lib/productivity'

function groups(tasks: Task[]) {
  const now = new Date()
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const open = tasks.filter((t) => t.status !== 'done')
  return [
    { name: 'Overdue', items: open.filter((t) => t.dueAt && new Date(t.dueAt) < now) },
    {
      name: 'Today',
      items: open.filter(
        (t) => t.dueAt && new Date(t.dueAt) >= now && new Date(t.dueAt) <= endOfToday,
      ),
    },
    { name: 'Upcoming', items: open.filter((t) => t.dueAt && new Date(t.dueAt) > endOfToday) },
    { name: 'No due date', items: open.filter((t) => !t.dueAt) },
    { name: 'Done', items: tasks.filter((t) => t.status === 'done').slice(0, 30) },
  ].filter((g) => g.items.length)
}

/** Everything assigned to you (or that you created), across channels. */
export default function MyTasksPage() {
  const [mine, setMine] = useState<'assigned' | 'created'>('assigned')
  const q = useTasks({ mine })
  const [editing, setEditing] = useState<Task | null>(null)
  const list = groups(q.data ?? [])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="My tasks" icon={<ListTodo />}>
        <nav className="flex gap-4 px-3 md:px-6" aria-label="Which tasks">
          {(
            [
              ['assigned', 'Assigned to me'],
              ['created', 'Created by me'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-current={mine === k ? 'page' : undefined}
              onClick={() => setMine(k)}
              className={cn(
                '-mb-px h-9 border-b-2 border-transparent text-[13px] font-medium text-fg-muted hover:text-fg',
                mine === k && 'border-fg text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-6">
          {q.isLoading ? (
            <Skeleton className="h-48" />
          ) : !list.length ? (
            <EmptyState
              emoji="✅"
              title={
                mine === 'assigned' ? 'Nothing on your plate' : 'You haven’t created any tasks yet'
              }
              description="Turn a message into a task from its menu, use a channel's Tasks tab, or type /todo."
            />
          ) : (
            <div className="flex flex-col gap-7">
              {list.map((g) => (
                <section key={g.name}>
                  <h2
                    className={cn(
                      'mb-2 text-xs font-semibold uppercase',
                      g.name === 'Overdue' ? 'text-danger' : 'text-fg-subtle',
                    )}
                  >
                    {g.name} <span className="font-normal">{g.items.length}</span>
                  </h2>
                  <div className="flex flex-col gap-1.5">
                    {g.items.map((t) => (
                      <TaskCard key={t.id} task={t} showChannel onOpen={() => setEditing(t)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      {editing && (
        <TaskDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          channel={{ id: editing.channelId, name: editing.channelName }}
          task={editing}
        />
      )}
    </div>
  )
}
