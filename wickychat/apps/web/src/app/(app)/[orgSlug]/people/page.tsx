'use client'
import type { Channel, Member } from '@quid/shared'
import { ROLE_LABEL } from '@quid/shared'
import {
  Avatar,
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  EmptyState,
  Input,
  Select,
  Skeleton,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Phone, Search, Users } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { useCalls } from '@/components/calls/call-provider'
import { ProfileFieldRows } from '@/components/org/profile-fields'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { errorMessage, post } from '@/lib/api'
import { displayName, relative } from '@/lib/format'
import { keys, useDepartments, useMembers, usePresence, useTeams } from '@/lib/queries'

const PRESENCE_LABEL = {
  active: 'Active',
  away: 'Away',
  dnd: 'Do not disturb',
  offline: 'Offline',
} as const

function Profile({ m, onClose }: { m: Member | null; onClose: () => void }) {
  const { org, api, base, me } = useOrgContext()
  const departments = useDepartments(org.id)
  const teams = useTeams(org.id)
  const presence = usePresence(org.id)
  const qc = useQueryClient()
  const router = useRouter()
  const calls = useCalls()
  if (!m) return null
  const p = presence.data?.[m.id]
  const dept = departments.data?.find((d) => d.id === m.departmentId)
  const memberTeams = teams.data?.filter((t) => t.members.some((x) => x.userId === m.id)) ?? []
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={displayName(m)}>
        <div className="flex items-start gap-4">
          <Avatar
            name={m.name}
            id={m.id}
            src={m.avatarUrl}
            decoration={m.decoration}
            size="xl"
            presence={p?.status ?? m.presence}
          />
          <div className="min-w-0">
            {m.title && <p className="text-[14px]">{m.title}</p>}
            <p className="text-[13px] text-fg-muted">{m.email}</p>
            <p className="mt-1 text-xs text-fg-subtle">
              {PRESENCE_LABEL[p?.status ?? m.presence]}
              {p?.status === 'offline' && p.lastActiveAt
                ? ` · last active ${relative(p.lastActiveAt)}`
                : ''}
            </p>
            {p?.statusText && (
              <p className="mt-2 text-[13px]">
                {p.statusEmoji} {p.statusText}
              </p>
            )}
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
          <dt className="text-fg-subtle">Role</dt>
          <dd>{ROLE_LABEL[m.role]}</dd>
          <dt className="text-fg-subtle">Department</dt>
          <dd>{dept?.name ?? '—'}</dd>
          <dt className="text-fg-subtle">Teams</dt>
          <dd>{memberTeams.length ? memberTeams.map((t) => t.name).join(', ') : '—'}</dd>
          <dt className="text-fg-subtle">Joined</dt>
          <dd>{new Date(m.joinedAt).toLocaleDateString(undefined, { dateStyle: 'long' })}</dd>
          <ProfileFieldRows fields={org.customization.profileFields} values={m.profile ?? {}} />
        </dl>
        <div className="mt-5 flex gap-2">
          <Button
            variant="primary"
            onClick={async () => {
              try {
                const c = await post<Channel>(`${api}/conversations`, { userIds: [m.id] })
                qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
                  l ? [...l.filter((x) => x.id !== c.id), c] : l,
                )
                router.push(`${base}/c/${c.id}`)
              } catch (e) {
                toast.error(errorMessage(e))
              }
            }}
          >
            <MessageSquare /> {m.id === me.id ? 'Open notes' : 'Message'}
          </Button>
          {m.id !== me.id && (
            <Button
              disabled={!calls.available}
              title={calls.available ? undefined : 'Voice calls are not configured on this server'}
              onClick={async () => {
                try {
                  const c = await post<Channel>(`${api}/conversations`, { userIds: [m.id] })
                  qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
                    l ? [...l.filter((x) => x.id !== c.id), c] : l,
                  )
                  onClose()
                  router.push(`${base}/c/${c.id}`)
                  await calls.start(c.id)
                } catch (e) {
                  toast.error(errorMessage(e))
                }
              }}
            >
              <Phone /> Call
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function People() {
  const { org } = useOrgContext()
  const members = useMembers(org.id)
  const departments = useDepartments(org.id)
  const presence = usePresence(org.id)
  const params = useSearchParams()
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [selected, setSelected] = useState<string | null>(params.get('user'))

  const list = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (members.data ?? []).filter(
      (m) =>
        (!dept || m.departmentId === dept) &&
        (!n || [m.name, m.displayName, m.email, m.title].some((v) => v?.toLowerCase().includes(n))),
    )
  }, [members.data, q, dept])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="People"
        icon={<Users />}
        actions={
          <span className="text-xs text-fg-subtle">{members.data?.length ?? 0} members</span>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                className="pl-8"
                placeholder="Search by name, title or email"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {!!departments.data?.length && (
              <Select
                className="w-48"
                aria-label="Department"
                value={dept}
                onChange={(e) => setDept(e.target.value)}
              >
                <option value="">All departments</option>
                {departments.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {members.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : !list.length ? (
            <EmptyState
              emoji="🔍"
              title="No one matches that"
              description="Try a different name or department."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((m) => {
                const p = presence.data?.[m.id]
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(m.id)}
                      className="q-lift flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:border-border-strong hover:bg-bg-subtle"
                    >
                      <Avatar
                        name={m.name}
                        id={m.id}
                        src={m.avatarUrl}
                        decoration={m.decoration}
                        size="lg"
                        presence={p?.status ?? m.presence}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13.5px] font-medium">
                            {displayName(m)}
                          </span>
                          {(m.role === 'owner' || m.role === 'admin' || m.role === 'guest') && (
                            <Badge tone={m.role === 'guest' ? 'warning' : 'neutral'}>
                              {ROLE_LABEL[m.role]}
                            </Badge>
                          )}
                        </span>
                        <span className={cn('block truncate text-xs text-fg-subtle')}>
                          {p?.statusText
                            ? `${p.statusEmoji ?? ''} ${p.statusText}`
                            : m.title || m.email}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
      <Profile
        m={members.data?.find((m) => m.id === selected) ?? null}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

export default function PeoplePage() {
  return (
    <Suspense>
      <People />
    </Suspense>
  )
}
