'use client'
import type { Invitation, Member, OrgRole } from '@quid/shared'
import { assignableRoles, can, canActOnMember, ROLE_LABEL } from '@quid/shared'
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Input,
  Select,
  Skeleton,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { del, errorMessage, get, patch } from '@/lib/api'
import { displayName, relative } from '@/lib/format'
import { useDepartments } from '@/lib/queries'

export default function MembersSettings() {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const isAdmin = org.role === 'owner' || org.role === 'admin'
  const members = useQuery({
    queryKey: ['members-admin', org.id],
    queryFn: ({ signal }) => get<Member[]>(`${api}/members?includeDeactivated=${isAdmin}`, signal),
  })
  const invites = useQuery({
    queryKey: ['invitations', org.id],
    queryFn: ({ signal }) => get<Invitation[]>(`${api}/invitations`, signal),
  })
  const departments = useDepartments(org.id)
  const [q, setQ] = useState('')
  const [removing, setRemoving] = useState<Member | null>(null)

  const list = useMemo(() => {
    const n = q.toLowerCase()
    return (members.data ?? []).filter(
      (m) => !n || m.name.toLowerCase().includes(n) || m.email.toLowerCase().includes(n),
    )
  }, [members.data, q])

  const refresh = () => {
    void members.refetch()
    void qc.invalidateQueries({ queryKey: ['members', org.id] })
  }

  const update = async (m: Member, body: Record<string, unknown>) => {
    try {
      await patch(`${api}/members/${m.id}`, body)
      refresh()
      toast.success('Member updated')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <SettingsTitle
        title="Members"
        description="Everyone with a school email joins automatically. Roles control what people can do, and changes are recorded in the audit log."
      />
      {!!invites.data?.length && (
        <SettingsCard title={`Pending invitations · ${invites.data.length}`}>
          <ul className="divide-y divide-border">
            {invites.data.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{i.email}</p>
                  <p className="text-xs text-fg-subtle">
                    {ROLE_LABEL[i.role]} · invited by{' '}
                    {i.invitedBy ? displayName(i.invitedBy) : 'someone'} {relative(i.createdAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await del(`${api}/invitations/${i.id}`)
                      void invites.refetch()
                    } catch (e) {
                      toast.error(errorMessage(e))
                    }
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}
      <SettingsCard
        title={`Members · ${members.data?.filter((m) => !m.deactivated).length ?? '…'}`}
      >
        <Input
          className="mb-3"
          placeholder="Filter members"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {members.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((m) => {
              const manageable =
                m.id !== me.id &&
                canActOnMember(org.role, m.role) &&
                can(org.role, 'members.change_role')
              const roles = assignableRoles(org.role)
              return (
                <li
                  key={m.id}
                  className={`flex flex-wrap items-center gap-3 py-2.5 ${m.deactivated ? 'opacity-50' : ''}`}
                >
                  <Avatar
                    name={m.name}
                    id={m.id}
                    src={m.avatarUrl}
                    decoration={m.decoration}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {displayName(m)}{' '}
                      {m.id === me.id && <span className="font-normal text-fg-subtle">(you)</span>}
                      {m.deactivated && <Badge className="ml-1.5">Deactivated</Badge>}
                    </p>
                    <p className="truncate text-xs text-fg-subtle">{m.email}</p>
                  </div>
                  {isAdmin && !!departments.data?.length && !m.deactivated && (
                    <Select
                      className="h-8 w-36 text-xs"
                      aria-label={`Department for ${m.name}`}
                      value={m.departmentId ?? ''}
                      onChange={(e) => update(m, { departmentId: e.target.value || null })}
                    >
                      <option value="">No department</option>
                      {departments.data.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  {manageable && !m.deactivated ? (
                    <Select
                      className="h-8 w-40 text-xs"
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      onChange={(e) => update(m, { role: e.target.value as OrgRole })}
                    >
                      {[...new Set([m.role, ...roles])].map((r) => (
                        <option key={r} value={r} disabled={!roles.includes(r)}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="w-40 text-right text-xs text-fg-muted">
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                  {manageable && !m.deactivated && can(org.role, 'members.remove') && (
                    <Button size="sm" variant="danger-ghost" onClick={() => setRemoving(m)}>
                      Remove
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </SettingsCard>
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent
          title={`Remove ${removing?.name}?`}
          description="They lose access to this organization immediately. Their messages stay, so conversations keep their history."
        >
          <DialogFooter>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const m = removing!
                setRemoving(null)
                try {
                  await del(`${api}/members/${m.id}`)
                  refresh()
                  toast.success(`${m.name} was removed`)
                } catch (e) {
                  toast.error(errorMessage(e))
                }
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
