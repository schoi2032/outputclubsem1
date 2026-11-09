'use client'
import type { Canvas, CanvasSummary, Reminder, Task } from '@quid/shared'
import { useQuery } from '@tanstack/react-query'
import { useOrgContext } from '@/components/org-context'
import { get } from './api'

export const pkeys = {
  canvases: (channelId: string) => ['canvases', channelId] as const,
  canvas: (id: string) => ['canvas', id] as const,
  tasks: (orgId: string, scope: string) => ['tasks', orgId, scope] as const,
  allTasks: (orgId: string) => ['tasks', orgId] as const,
  reminders: (orgId: string) => ['reminders', orgId] as const,
  workflows: (orgId: string) => ['workflows', orgId] as const,
  shortcuts: (channelId: string) => ['workflow-shortcuts', channelId] as const,
}

export function useCanvases(channelId: string) {
  const { api } = useOrgContext()
  return useQuery({
    queryKey: pkeys.canvases(channelId),
    queryFn: ({ signal }) => get<CanvasSummary[]>(`${api}/channels/${channelId}/canvases`, signal),
  })
}

export function useCanvas(id: string | null) {
  const { api } = useOrgContext()
  return useQuery({
    queryKey: pkeys.canvas(id ?? ''),
    queryFn: ({ signal }) => get<Canvas>(`${api}/canvases/${id}`, signal),
    enabled: !!id,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useTasks(q: { channelId: string } | { mine: 'assigned' | 'created' }) {
  const { api, org } = useOrgContext()
  const qs = 'channelId' in q ? `channelId=${q.channelId}` : `mine=${q.mine}`
  return useQuery({
    queryKey: pkeys.tasks(org.id, qs),
    queryFn: ({ signal }) => get<Task[]>(`${api}/tasks?${qs}`, signal),
  })
}

export function useReminders() {
  const { api, org } = useOrgContext()
  return useQuery({
    queryKey: pkeys.reminders(org.id),
    queryFn: ({ signal }) => get<Reminder[]>(`${api}/reminders`, signal),
  })
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export type WorkflowTrigger =
  | { type: 'shortcut'; channelId: string }
  | { type: 'channel_join'; channelId: string }
  | { type: 'workspace_join' }
  | { type: 'schedule'; channelId: string; time: string; days: number[]; timezone: string }
  | { type: 'keyword'; channelId: string; keyword: string }

export type FormField = {
  id: string
  label: string
  kind: 'text' | 'long' | 'select'
  options?: string[]
  required: boolean
}

export type WorkflowStep =
  | { id: string; type: 'message'; channelId: string; text: string }
  | { id: string; type: 'dm'; to: string; text: string }
  | {
      id: string
      type: 'task'
      channelId: string
      title: string
      assignee: string | null
      dueInDays: number | null
    }

export type WorkflowInput = {
  name: string
  description: string
  emoji: string
  enabled: boolean
  trigger: WorkflowTrigger
  form: FormField[]
  steps: WorkflowStep[]
}

export type Workflow = WorkflowInput & {
  id: string
  canEdit: boolean
  runCount: number
  lastRunAt: string | null
  lastError: string | null
  createdBy: { id: string; name: string; displayName: string | null } | null
  updatedAt: string
}

export function useWorkflows() {
  const { api, org } = useOrgContext()
  return useQuery({
    queryKey: pkeys.workflows(org.id),
    queryFn: ({ signal }) => get<Workflow[]>(`${api}/workflows`, signal),
  })
}

export function useShortcuts(channelId: string) {
  const { api } = useOrgContext()
  return useQuery({
    queryKey: pkeys.shortcuts(channelId),
    queryFn: ({ signal }) => get<Workflow[]>(`${api}/workflows?shortcutsIn=${channelId}`, signal),
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Natural-language times for /remind and quick picks
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
}

function clock(s: string): [number, number] | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim())
  if (!m || (!m[2] && !m[3])) return null
  let h = Number(m[1])
  const mi = m[2] ? Number(m[2]) : 0
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)
  }
  return h > 23 || mi > 59 ? null : [h, mi]
}

/**
 * Parses the start of "/remind" text in the browser's time zone:
 * "in 20m stretch", "in 2 hours call Ben", "at 5pm ship it", "tomorrow 9am standup notes",
 * "tomorrow standup notes" (9am). Returns null when it doesn't understand.
 */
export function parseRemind(text: string, now = new Date()): { due: Date; what: string } | null {
  const t = text.trim()
  const rel = /^(?:me\s+)?(?:in\s+)?(\d{1,4})\s*([a-z]+)\s+(?:to\s+)?(.+)$/is.exec(t)
  if (rel && UNITS[rel[2]!.toLowerCase()])
    return {
      due: new Date(now.getTime() + Number(rel[1]) * UNITS[rel[2]!.toLowerCase()]!),
      what: rel[3]!.trim(),
    }
  const abs =
    /^(?:me\s+)?(today|tonight|tomorrow)?\s*(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\s+(?:to\s+)?(.+)$/is.exec(
      t,
    )
  if (!abs || (!abs[1] && !abs[2])) return null
  const c: [number, number] | null = abs[2]
    ? clock(abs[2])
    : abs[1]?.toLowerCase() === 'tonight'
      ? [20, 0]
      : [9, 0]
  if (!c) return null
  const due = new Date(now)
  due.setHours(c[0], c[1], 0, 0)
  if (abs[1]?.toLowerCase() === 'tomorrow') due.setDate(due.getDate() + 1)
  else if (due <= now) due.setDate(due.getDate() + 1)
  return { due, what: abs[3]!.trim() }
}

/** Quick choices for "Remind me about this". */
export function reminderChoices(now = new Date()) {
  const at = (days: number, h: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(h, 0, 0, 0)
    return d
  }
  const nextMonday = (() => {
    const d = at(1, 9)
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
    return d
  })()
  return [
    { label: 'In 20 minutes', at: new Date(now.getTime() + 20 * 60_000) },
    { label: 'In 1 hour', at: new Date(now.getTime() + 3600_000) },
    { label: 'In 3 hours', at: new Date(now.getTime() + 3 * 3600_000) },
    { label: 'Tomorrow at 9:00', at: at(1, 9) },
    { label: 'Next Monday at 9:00', at: nextMonday },
  ]
}

export const whenLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Today ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`
}
