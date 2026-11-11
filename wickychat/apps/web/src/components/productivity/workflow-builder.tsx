'use client'
import type { Channel } from '@quid/shared'
import {
  Button,
  cn,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  Switch,
  Textarea,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Hash,
  ListTodo,
  MessageSquare,
  MousePointerClick,
  Plus,
  Send,
  Trash2,
  UserPlus,
  UserRoundPlus,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { errorMessage, post, put } from '@/lib/api'
import { channelRef } from '@/lib/channels'
import { displayName } from '@/lib/format'
import {
  type FormField,
  pkeys,
  type Workflow,
  type WorkflowInput,
  type WorkflowStep,
  type WorkflowTrigger,
} from '@/lib/productivity'
import { useChannels, useMembers } from '@/lib/queries'
import { useOrgContext } from '../org-context'

const uid = () => Math.random().toString(36).slice(2, 10)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const TRIGGERS: {
  type: WorkflowTrigger['type']
  label: string
  detail: string
  icon: typeof Zap
}[] = [
  {
    type: 'shortcut',
    label: 'From a shortcut',
    detail: 'Someone runs it from ⚡ in a channel, optionally filling in a form',
    icon: MousePointerClick,
  },
  {
    type: 'channel_join',
    label: 'When someone joins a channel',
    detail: 'Welcome people, share the rules',
    icon: UserPlus,
  },
  {
    type: 'workspace_join',
    label: 'When someone joins the workspace',
    detail: 'Onboarding for every new member',
    icon: UserRoundPlus,
  },
  {
    type: 'schedule',
    label: 'On a schedule',
    detail: 'Standups, weekly check-ins, reminders',
    icon: CalendarClock,
  },
  {
    type: 'keyword',
    label: 'When a message contains a word',
    detail: 'Route requests, react to incidents',
    icon: Hash,
  },
]

const STEP_TYPES = [
  { type: 'message' as const, label: 'Send a message to a channel', icon: MessageSquare },
  { type: 'dm' as const, label: 'Send a direct message', icon: Send },
  { type: 'task' as const, label: 'Create a task', icon: ListTodo },
]

export function triggerSummary(t: WorkflowTrigger, chanName: (id: string) => string) {
  switch (t.type) {
    case 'shortcut':
      return `Shortcut in ${chanName(t.channelId)}`
    case 'channel_join':
      return `When someone joins ${chanName(t.channelId)}`
    case 'workspace_join':
      return 'When someone joins the workspace'
    case 'schedule':
      return `${t.days.length === 7 ? 'Every day' : t.days.map((d) => DAYS[d]).join(', ')} at ${t.time}`
    case 'keyword':
      return `When “${t.keyword}” is said in ${chanName(t.channelId)}`
  }
}

/** Starting points for the builder. */
export function templates(
  channelId: string,
  me: string,
): { key: string; title: string; detail: string; value: WorkflowInput }[] {
  const base = { description: '', enabled: true, form: [] as FormField[] }
  return [
    {
      key: 'welcome',
      title: 'Welcome new members',
      detail: 'DM everyone who joins a channel with the basics.',
      value: {
        ...base,
        name: 'Welcome',
        emoji: '👋',
        trigger: { type: 'channel_join', channelId },
        steps: [
          {
            id: uid(),
            type: 'dm',
            to: 'trigger_user',
            text: 'Welcome to {{channel}}, {{user}}! 👋\n- Say hi and tell us what you work on\n- Check the **Canvases** tab for our docs',
          },
        ],
      },
    },
    {
      key: 'request',
      title: 'Request form',
      detail: 'Collect requests with a form, post them and create a task.',
      value: {
        ...base,
        name: 'Request help',
        emoji: '🙋',
        trigger: { type: 'shortcut', channelId },
        form: [
          { id: 'what', label: 'What do you need', kind: 'long', required: true },
          {
            id: 'urgency',
            label: 'Urgency',
            kind: 'select',
            options: ['Low', 'Medium', 'High'],
            required: true,
          },
        ],
        steps: [
          {
            id: uid(),
            type: 'message',
            channelId,
            text: '**New request from {{user}}** ({{Urgency}})\n{{What do you need}}',
          },
          {
            id: uid(),
            type: 'task',
            channelId,
            title: 'Request from {{user}}: {{What do you need}}',
            assignee: me,
            dueInDays: 2,
          },
          {
            id: uid(),
            type: 'dm',
            to: 'trigger_user',
            text: 'Thanks! Your request was posted in {{channel}}. We’ll follow up there.',
          },
        ],
      },
    },
    {
      key: 'standup',
      title: 'Daily standup',
      detail: 'Prompt the team every weekday morning.',
      value: {
        ...base,
        name: 'Standup',
        emoji: '☀️',
        trigger: {
          type: 'schedule',
          channelId,
          time: '09:30',
          days: [1, 2, 3, 4, 5],
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        steps: [
          {
            id: uid(),
            type: 'message',
            channelId,
            text: '☀️ **Standup time!** Reply in a thread:\n- What did you do yesterday?\n- What are you doing today?\n- Anything blocking you?',
          },
        ],
      },
    },
    {
      key: 'incident',
      title: 'Incident alert',
      detail: 'When someone says “outage”, post a checklist and track it.',
      value: {
        ...base,
        name: 'Incident',
        emoji: '🚨',
        trigger: { type: 'keyword', channelId, keyword: 'outage' },
        steps: [
          {
            id: uid(),
            type: 'message',
            channelId,
            text: '🚨 **Possible incident reported by {{user}}**\n- Acknowledge in a thread\n- Post updates every 30 minutes\n- Write a short summary when it’s fixed',
          },
          {
            id: uid(),
            type: 'task',
            channelId,
            title: 'Incident follow-up ({{date}})',
            assignee: 'trigger_user',
            dueInDays: 1,
          },
        ],
      },
    },
  ]
}

function Card({
  label,
  icon,
  children,
  actions,
}: {
  label: string
  icon: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-bg shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent-subtle text-accent-text [&>svg]:size-4">
          {icon}
        </span>
        <span className="flex-1 text-[13.5px] font-semibold">{label}</span>
        {actions}
      </header>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  )
}

const Connector = () => (
  <div className="flex justify-center py-1.5" aria-hidden>
    <span className="h-6 w-px bg-border-strong" />
  </div>
)

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-fg-muted">{children}</span>
}

function ChannelSelect({
  value,
  onChange,
  channels,
}: {
  value: string
  onChange: (v: string) => void
  channels: Channel[]
}) {
  return (
    <Select aria-label="Channel" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Pick a channel…
      </option>
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          #{c.name}
        </option>
      ))}
    </Select>
  )
}

/** Text with clickable {{variable}} chips. */
function TemplateText({
  value,
  onChange,
  vars,
  rows = 3,
  label,
}: {
  value: string
  onChange: (v: string) => void
  vars: string[]
  rows?: number
  label: string
}) {
  return (
    <div>
      <Textarea
        aria-label={label}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[11.5px] text-fg-subtle">Insert:</span>
        {vars.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(`${value}{{${v}}}`)}
            className="rounded-md bg-bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-fg-muted hover:bg-bg-emphasis hover:text-fg"
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>
    </div>
  )
}

export function WorkflowBuilder({
  initial,
  existing,
}: {
  initial: WorkflowInput
  existing?: Workflow
}) {
  const { api, base, org, me } = useOrgContext()
  const router = useRouter()
  const qc = useQueryClient()
  const channelsQ = useChannels(org.id)
  const members = useMembers(org.id)
  const [w, setW] = useState<WorkflowInput>(initial)
  const [busy, setBusy] = useState(false)

  const channels = (channelsQ.data ?? []).filter(
    (c) => (c.kind === 'public' || c.kind === 'private') && c.membership && !c.archivedAt,
  )
  const people = (members.data ?? []).filter((m) => !m.isBot && !m.deactivated)
  const t = w.trigger
  const vars = [
    ...(t.type !== 'schedule' ? ['user'] : []),
    ...('channelId' in t ? ['channel'] : []),
    'date',
    ...(t.type === 'keyword' ? ['message'] : []),
    ...w.form.map((f) => f.label),
  ]
  const set = (patch: Partial<WorkflowInput>) => setW((x) => ({ ...x, ...patch }))
  const setStep = (id: string, patch: Partial<WorkflowStep>) =>
    set({ steps: w.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as WorkflowStep) : s)) })
  const firstChannel = channels[0]?.id ?? ''

  const setTriggerType = (type: WorkflowTrigger['type']) => {
    const channelId = 'channelId' in t ? t.channelId : firstChannel
    const next: WorkflowTrigger =
      type === 'workspace_join'
        ? { type }
        : type === 'schedule'
          ? {
              type,
              channelId,
              time: '09:00',
              days: [1, 2, 3, 4, 5],
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }
          : type === 'keyword'
            ? { type, channelId, keyword: '' }
            : { type, channelId }
    set({ trigger: next, form: type === 'shortcut' ? w.form : [] })
  }

  const addStep = (type: WorkflowStep['type']) => {
    const id = uid()
    const step: WorkflowStep =
      type === 'message'
        ? { id, type, channelId: 'channelId' in t ? t.channelId : firstChannel, text: '' }
        : type === 'dm'
          ? { id, type, to: t.type === 'schedule' ? me.id : 'trigger_user', text: '' }
          : {
              id,
              type,
              channelId: 'channelId' in t ? t.channelId : firstChannel,
              title: '',
              assignee: null,
              dueInDays: null,
            }
    set({ steps: [...w.steps, step] })
  }
  const move = (i: number, d: -1 | 1) => {
    const steps = [...w.steps]
    const [x] = steps.splice(i, 1)
    steps.splice(i + d, 0, x!)
    set({ steps })
  }

  const save = async () => {
    setBusy(true)
    try {
      if (existing) await put(`${api}/workflows/${existing.id}`, w)
      else await post(`${api}/workflows`, w)
      void qc.invalidateQueries({ queryKey: pkeys.workflows(org.id) })
      void qc.invalidateQueries({ queryKey: ['workflow-shortcuts'] })
      toast.success(existing ? 'Workflow saved' : 'Workflow published')
      router.push(`${base}/workflows`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const personOptions = (allowTrigger: boolean) => (
    <>
      {allowTrigger && <option value="trigger_user">The person who triggered it</option>}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {displayName(p)}
          {p.id === me.id ? ' (you)' : ''}
        </option>
      ))}
    </>
  )

  return (
    <div className="mx-auto max-w-2xl p-4 pb-24 md:p-8">
      <div className="mb-6 flex items-start gap-3">
        <Input
          aria-label="Emoji"
          value={w.emoji}
          onChange={(e) => set({ emoji: e.target.value.slice(0, 8) })}
          className="h-12 w-14 text-center text-2xl"
        />
        <div className="min-w-0 flex-1">
          <input
            aria-label="Workflow name"
            value={w.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Name your workflow"
            className="w-full bg-transparent text-2xl font-semibold tracking-[-0.02em] outline-none placeholder:text-fg-subtle"
          />
          <input
            aria-label="Description"
            value={w.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Add a short description (optional)"
            className="mt-1 w-full bg-transparent text-[13.5px] text-fg-muted outline-none placeholder:text-fg-subtle"
          />
        </div>
        <span className="mt-2 flex items-center gap-2 text-[13px] text-fg-muted">
          <Switch
            checked={w.enabled}
            onCheckedChange={(v) => set({ enabled: v })}
            label="Enabled"
          />
          {w.enabled ? 'On' : 'Off'}
        </span>
      </div>

      <Card label="When this happens" icon={<Zap />}>
        <div className="grid gap-2 sm:grid-cols-2">
          {TRIGGERS.map((tr) => (
            <button
              key={tr.type}
              type="button"
              aria-pressed={t.type === tr.type}
              onClick={() => setTriggerType(tr.type)}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
                t.type === tr.type
                  ? 'border-accent bg-accent-subtle/50 ring-1 ring-accent'
                  : 'border-border hover:bg-bg-subtle',
              )}
            >
              <tr.icon className="mt-0.5 size-4 shrink-0 text-accent-text" />
              <span>
                <span className="block text-[13px] font-medium">{tr.label}</span>
                <span className="block text-xs text-fg-subtle">{tr.detail}</span>
              </span>
            </button>
          ))}
        </div>
        {'channelId' in t && (
          <div>
            <Label>{t.type === 'schedule' ? 'Post-time channel' : 'Channel'}</Label>
            <ChannelSelect
              value={t.channelId}
              channels={channels}
              onChange={(v) => set({ trigger: { ...t, channelId: v } })}
            />
          </div>
        )}
        {t.type === 'keyword' && (
          <div>
            <Label>Word or phrase</Label>
            <Input
              value={t.keyword}
              onChange={(e) => set({ trigger: { ...t, keyword: e.target.value } })}
              placeholder="e.g. outage, help, invoice"
            />
          </div>
        )}
        {t.type === 'schedule' && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Time</Label>
              <Input
                type="time"
                value={t.time}
                onChange={(e) => set({ trigger: { ...t, time: e.target.value } })}
                className="w-32"
              />
            </div>
            <div>
              <Label>Days</Label>
              <div className="flex gap-1">
                {DAYS.map((d, i) => {
                  const on = t.days.includes(i)
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        set({
                          trigger: {
                            ...t,
                            days: on ? t.days.filter((x) => x !== i) : [...t.days, i].sort(),
                          },
                        })
                      }
                      className={cn(
                        'h-9 w-10 rounded-lg border text-xs font-medium',
                        on
                          ? 'border-accent bg-accent text-white'
                          : 'border-border text-fg-muted hover:bg-bg-subtle',
                      )}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
            <p className="pb-2 text-xs text-fg-subtle">{t.timezone}</p>
          </div>
        )}
      </Card>

      {t.type === 'shortcut' && (
        <>
          <Connector />
          <Card
            label="Collect info with a form (optional)"
            icon={<ListTodo />}
            actions={
              w.form.length < 10 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    set({
                      form: [...w.form, { id: uid(), label: '', kind: 'text', required: true }],
                    })
                  }
                >
                  <Plus /> Question
                </Button>
              )
            }
          >
            {!w.form.length && (
              <p className="text-[13px] text-fg-subtle">No form: the workflow runs right away.</p>
            )}
            {w.form.map((f, i) => (
              <div key={f.id} className="flex flex-col gap-2 rounded-xl bg-bg-subtle p-3">
                <div className="flex gap-2">
                  <Input
                    aria-label={`Question ${i + 1}`}
                    value={f.label}
                    placeholder={`Question ${i + 1}`}
                    onChange={(e) =>
                      set({
                        form: w.form.map((x) =>
                          x.id === f.id ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Select
                    aria-label="Answer type"
                    value={f.kind}
                    className="w-40"
                    onChange={(e) =>
                      set({
                        form: w.form.map((x) =>
                          x.id === f.id ? { ...x, kind: e.target.value as FormField['kind'] } : x,
                        ),
                      })
                    }
                  >
                    <option value="text">Short answer</option>
                    <option value="long">Paragraph</option>
                    <option value="select">Dropdown</option>
                  </Select>
                  <IconButton
                    label="Remove question"
                    onClick={() => set({ form: w.form.filter((x) => x.id !== f.id) })}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
                {f.kind === 'select' && (
                  <Input
                    aria-label="Options"
                    placeholder="Options, separated by commas"
                    defaultValue={f.options?.join(', ') ?? ''}
                    onBlur={(e) =>
                      set({
                        form: w.form.map((x) =>
                          x.id === f.id
                            ? {
                                ...x,
                                options: e.target.value
                                  .split(',')
                                  .map((o) => o.trim())
                                  .filter(Boolean),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                )}
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) =>
                      set({
                        form: w.form.map((x) =>
                          x.id === f.id ? { ...x, required: e.target.checked } : x,
                        ),
                      })
                    }
                    className="accent-[var(--q-accent)]"
                  />
                  Required
                </label>
              </div>
            ))}
          </Card>
        </>
      )}

      {w.steps.map((s, i) => {
        const meta = STEP_TYPES.find((x) => x.type === s.type)!
        return (
          <div key={s.id}>
            <Connector />
            <Card
              label={`${i + 1}. ${meta.label}`}
              icon={<meta.icon />}
              actions={
                <span className="flex">
                  <IconButton
                    label="Move up"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label="Move down"
                    size="sm"
                    disabled={i === w.steps.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </IconButton>
                  <IconButton
                    label="Remove step"
                    size="sm"
                    onClick={() => set({ steps: w.steps.filter((x) => x.id !== s.id) })}
                  >
                    <Trash2 />
                  </IconButton>
                </span>
              }
            >
              {s.type === 'message' && (
                <>
                  <div>
                    <Label>Channel</Label>
                    <ChannelSelect
                      value={s.channelId}
                      channels={channels}
                      onChange={(v) => setStep(s.id, { channelId: v })}
                    />
                  </div>
                  <div>
                    <Label>Message</Label>
                    <TemplateText
                      label="Message"
                      value={s.text}
                      vars={vars}
                      onChange={(v) => setStep(s.id, { text: v })}
                    />
                  </div>
                </>
              )}
              {s.type === 'dm' && (
                <>
                  <div>
                    <Label>Send to</Label>
                    <Select
                      aria-label="Send to"
                      value={s.to}
                      onChange={(e) => setStep(s.id, { to: e.target.value })}
                    >
                      {personOptions(t.type !== 'schedule')}
                    </Select>
                  </div>
                  <div>
                    <Label>Message</Label>
                    <TemplateText
                      label="Message"
                      value={s.text}
                      vars={vars}
                      onChange={(v) => setStep(s.id, { text: v })}
                    />
                  </div>
                </>
              )}
              {s.type === 'task' && (
                <>
                  <div>
                    <Label>Task</Label>
                    <TemplateText
                      label="Task title"
                      rows={1}
                      value={s.title}
                      vars={vars}
                      onChange={(v) => setStep(s.id, { title: v })}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label>In channel</Label>
                      <ChannelSelect
                        value={s.channelId}
                        channels={channels}
                        onChange={(v) => setStep(s.id, { channelId: v })}
                      />
                    </div>
                    <div>
                      <Label>Assign to</Label>
                      <Select
                        aria-label="Assign to"
                        value={s.assignee ?? ''}
                        onChange={(e) => setStep(s.id, { assignee: e.target.value || null })}
                      >
                        <option value="">Nobody</option>
                        {personOptions(t.type !== 'schedule')}
                      </Select>
                    </div>
                    <div>
                      <Label>Due</Label>
                      <Select
                        aria-label="Due"
                        value={s.dueInDays === null ? '' : String(s.dueInDays)}
                        onChange={(e) =>
                          setStep(s.id, {
                            dueInDays: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      >
                        <option value="">No due date</option>
                        <option value="0">Today</option>
                        <option value="1">In 1 day</option>
                        <option value="2">In 2 days</option>
                        <option value="7">In a week</option>
                      </Select>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>
        )
      })}

      <Connector />
      <div className="flex justify-center">
        <Menu>
          <MenuTrigger asChild>
            <Button disabled={w.steps.length >= 10}>
              <Plus /> Add a step
            </Button>
          </MenuTrigger>
          <MenuContent align="center">
            {STEP_TYPES.map((st) => (
              <MenuItem key={st.type} icon={<st.icon />} onSelect={() => addStep(st.type)}>
                {st.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg/90 backdrop-blur md:left-auto md:w-[calc(100%-68px)] lg:w-[calc(100%-68px-264px)]">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 md:px-8">
          <p className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
            {triggerSummary(t, (id) => {
              const c = channels.find((x) => x.id === id)
              return c ? channelRef(c, me.id) : 'a channel'
            })}{' '}
            · {w.steps.length} step{w.steps.length === 1 ? '' : 's'}
          </p>
          <Button onClick={() => router.push(`${base}/workflows`)}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!w.name.trim() || !w.steps.length}
            onClick={save}
          >
            {existing ? 'Save changes' : 'Publish'}
          </Button>
        </div>
      </div>
    </div>
  )
}
