'use client'
import { Badge, Button, Skeleton, Switch, Tooltip, toast } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { del, errorMessage, get, patch } from '@/lib/api'
import { fileSize, relative } from '@/lib/format'

type Overview = {
  members: {
    total: number
    active7d: number
    admins: number
    guests: number
    pendingInvites: number
  }
  messages: { last7d: number; last30d: number; daily: { day: string; messages: number }[] }
  channels: { public: number; private: number; archived: number }
  files: { count: number; bytes: number }
  meetings: { last30d: number; minutes30d: number }
  calls: { last30d: number }
  connectedApps: { enabled: boolean; active: number }
}
type OrgApp = {
  id: string
  name: string
  kind: 'oauth' | 'personal'
  scopes: string[]
  user: { id: string; name: string; email: string }
  createdAt: string
  lastUsedAt: string | null
}

const n = (v: number) => v.toLocaleString()

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  )
}

function ActivityChart({ daily }: { daily: Overview['messages']['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.messages))
  return (
    <div>
      <div
        className="flex h-32 items-end gap-[3px]"
        role="img"
        aria-label="Messages per day over the last 30 days"
      >
        {daily.map((d) => (
          <Tooltip
            key={d.day}
            content={`${new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${n(d.messages)} messages`}
          >
            <div className="flex h-full flex-1 items-end">
              <div
                className="w-full rounded-t-sm bg-accent/80 transition-colors hover:bg-accent"
                style={{
                  height: `${Math.max(d.messages ? 4 : 1, (d.messages / max) * 100)}%`,
                  opacity: d.messages ? 1 : 0.25,
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-2xs text-fg-subtle">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const { org, api } = useOrgContext()
  const canChange = org.role === 'owner' || org.role === 'admin'
  const overview = useQuery({
    queryKey: ['admin-overview', org.id],
    queryFn: ({ signal }) => get<Overview>(`${api}/admin/overview`, signal),
  })
  const apps = useQuery({
    queryKey: ['admin-apps', org.id],
    queryFn: ({ signal }) => get<OrgApp[]>(`${api}/admin/connected-apps`, signal),
  })
  const [saving, setSaving] = useState(false)
  const o = overview.data

  return (
    <>
      <SettingsTitle
        title="Dashboard"
        description={`How ${org.name} uses WickyChat. Counts only; no message content is shown here.`}
      />
      {!o ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Members"
              value={n(o.members.total)}
              hint={`${n(o.members.guests)} guests · ${n(o.members.pendingInvites)} invited`}
            />
            <Stat
              label="Active in the last 7 days"
              value={n(o.members.active7d)}
              hint={
                o.members.total
                  ? `${Math.round((o.members.active7d / o.members.total) * 100)}% of members`
                  : undefined
              }
            />
            <Stat
              label="Messages, last 7 days"
              value={n(o.messages.last7d)}
              hint={`${n(o.messages.last30d)} in 30 days`}
            />
            <Stat
              label="Files"
              value={fileSize(o.files.bytes)}
              hint={`${n(o.files.count)} files`}
            />
            <Stat
              label="Channels"
              value={n(o.channels.public + o.channels.private)}
              hint={`${n(o.channels.private)} private · ${n(o.channels.archived)} archived`}
            />
            <Stat
              label="Meetings, last 30 days"
              value={n(o.meetings.last30d)}
              hint={`${n(o.meetings.minutes30d)} minutes`}
            />
            <Stat label="Calls, last 30 days" value={n(o.calls.last30d)} />
            <Stat
              label="Connected apps"
              value={n(o.connectedApps.active)}
              hint={o.connectedApps.enabled ? 'Allowed' : 'Turned off'}
            />
          </div>

          <SettingsCard title="Messages per day">
            <ActivityChart daily={o.messages.daily} />
          </SettingsCard>

          <SettingsCard
            title="Connected apps"
            description="Members can connect Claude and other AI apps through WickyChat's MCP server. Apps act as the member and only see what they can see."
          >
            <div className="flex items-center justify-between gap-4 text-[13px]">
              <span>
                Allow connected apps
                <span className="block text-xs text-fg-subtle">
                  Turning this off immediately cuts off every connection in {org.name}.
                </span>
              </span>
              <Switch
                checked={o.connectedApps.enabled}
                disabled={!canChange || saving}
                label="Allow connected apps"
                onCheckedChange={async (v) => {
                  setSaving(true)
                  try {
                    await patch(`${api}/admin/security`, { connectedApps: v })
                    toast.success(v ? 'Connected apps allowed' : 'Connected apps turned off')
                    void overview.refetch()
                  } catch (e) {
                    toast.error(errorMessage(e))
                  } finally {
                    setSaving(false)
                  }
                }}
              />
            </div>
            {!!apps.data?.length && (
              <ul className="mt-4 divide-y divide-border border-t border-border">
                {apps.data.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-3 text-[13px]">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        {a.name}
                        <Badge>{a.scopes.includes('write') ? 'Read & send' : 'Read only'}</Badge>
                      </span>
                      <span className="block truncate text-xs text-fg-subtle">
                        {a.user.name} ({a.user.email}) ·{' '}
                        {a.kind === 'oauth' ? 'App' : 'Personal token'} ·{' '}
                        {a.lastUsedAt ? `last used ${relative(a.lastUsedAt)}` : 'never used'}
                      </span>
                    </span>
                    {canChange && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          try {
                            await del(`${api}/admin/connected-apps/${a.id}`)
                            toast.success(`Revoked ${a.name} for ${a.user.name}`)
                            void apps.refetch()
                            void overview.refetch()
                          } catch (e) {
                            toast.error(errorMessage(e))
                          }
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>
        </>
      )}
    </>
  )
}
