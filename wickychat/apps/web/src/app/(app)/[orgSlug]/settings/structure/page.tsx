'use client'
import type { Department, Team } from '@quid/shared'
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Crown, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { PeoplePicker } from '@/components/dialogs/people-picker'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { del, errorMessage, post, put } from '@/lib/api'
import { displayName } from '@/lib/format'
import { keys, useDepartments, useMembers, useTeams } from '@/lib/queries'

export default function StructureSettings() {
  const { org, api } = useOrgContext()
  const qc = useQueryClient()
  const departments = useDepartments(org.id)
  const teams = useTeams(org.id)
  const members = useMembers(org.id)
  const isAdmin = org.role === 'owner' || org.role === 'admin'
  const canTeams = isAdmin || org.role === 'dept_admin'
  const [dialog, setDialog] = useState<null | 'dept' | 'team'>(null)
  const [name, setName] = useState('')
  const [deptId, setDeptId] = useState('')
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [adding, setAdding] = useState<string[]>([])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.departments(org.id) })
    void qc.invalidateQueries({ queryKey: keys.teams(org.id) })
  }
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      refresh()
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const memberName = (id: string) => {
    const m = members.data?.find((x) => x.id === id)
    return m ? displayName(m) : 'Unknown'
  }
  const team = editingTeam ? teams.data?.find((t) => t.id === editingTeam.id) : null

  return (
    <>
      <SettingsTitle
        title="Departments & teams"
        description="Structure your organization. Channels can belong to a department or team, which groups them in the sidebar."
      />
      <SettingsCard title="Departments">
        {departments.isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <ul className="divide-y divide-border">
            {departments.data?.map((d: Department) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <Building2 className="size-4 text-fg-subtle" />
                <span className="flex-1 text-[13px] font-medium">{d.name}</span>
                <span className="text-xs text-fg-subtle">
                  {d.memberCount} {d.memberCount === 1 ? 'person' : 'people'}
                </span>
                {isAdmin && (
                  <IconButton
                    label={`Delete ${d.name}`}
                    size="sm"
                    onClick={() =>
                      run(() => del(`${api}/departments/${d.id}`), 'Department deleted')
                    }
                  >
                    <Trash2 />
                  </IconButton>
                )}
              </li>
            ))}
            {!departments.data?.length && (
              <li className="py-2 text-[13px] text-fg-subtle">No departments yet.</li>
            )}
          </ul>
        )}
        {isAdmin && (
          <Button
            size="sm"
            className="mt-3"
            onClick={() => {
              setName('')
              setDialog('dept')
            }}
          >
            <Plus /> Add department
          </Button>
        )}
      </SettingsCard>

      <SettingsCard title="Teams">
        <ul className="divide-y divide-border">
          {teams.data?.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <Users className="size-4 text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{t.name}</p>
                <p className="truncate text-xs text-fg-subtle">
                  {departments.data?.find((d) => d.id === t.departmentId)?.name ?? 'No department'}{' '}
                  · {t.members.length} member{t.members.length === 1 ? '' : 's'}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding([])
                  setEditingTeam(t)
                }}
              >
                Members
              </Button>
              {canTeams && (
                <IconButton
                  label={`Delete ${t.name}`}
                  size="sm"
                  onClick={() => run(() => del(`${api}/teams/${t.id}`), 'Team deleted')}
                >
                  <Trash2 />
                </IconButton>
              )}
            </li>
          ))}
          {!teams.data?.length && (
            <li className="py-2 text-[13px] text-fg-subtle">No teams yet.</li>
          )}
        </ul>
        {canTeams && (
          <Button
            size="sm"
            className="mt-3"
            onClick={() => {
              setName('')
              setDeptId('')
              setDialog('team')
            }}
          >
            <Plus /> Add team
          </Button>
        )}
      </SettingsCard>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title={dialog === 'dept' ? 'New department' : 'New team'}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const kind = dialog
              setDialog(null)
              void run(
                () =>
                  kind === 'dept'
                    ? post(`${api}/departments`, { name })
                    : post(`${api}/teams`, { name, departmentId: deptId || null }),
                kind === 'dept' ? 'Department created' : 'Team created',
              )
            }}
          >
            <Field label="Name">
              {(p) => (
                <Input
                  {...p}
                  required
                  autoFocus
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            {dialog === 'team' && (
              <Field label="Department">
                {(p) => (
                  <Select {...p} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                    <option value="">None</option>
                    {departments.data?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <DialogFooter>
              <Button type="button" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!team} onOpenChange={(o) => !o && setEditingTeam(null)}>
        {team && (
          <DialogContent
            title={`${team.name} members`}
            description="Team managers can add and remove members of their team."
          >
            <ul className="mb-4 divide-y divide-border">
              {team.members.map((tm) => {
                const m = members.data?.find((x) => x.id === tm.userId)
                return (
                  <li key={tm.userId} className="flex items-center gap-2 py-2">
                    {m && <Avatar name={m.name} id={m.id} src={m.avatarUrl} size="sm" />}
                    <span className="flex-1 text-[13px]">{memberName(tm.userId)}</span>
                    <Button
                      size="sm"
                      variant={tm.isManager ? 'primary' : 'ghost'}
                      onClick={() =>
                        run(() =>
                          put(`${api}/teams/${team.id}/members`, {
                            userId: tm.userId,
                            isManager: !tm.isManager,
                          }),
                        )
                      }
                    >
                      <Crown /> {tm.isManager ? 'Manager' : 'Make manager'}
                    </Button>
                    <IconButton
                      label="Remove from team"
                      size="sm"
                      onClick={() => run(() => del(`${api}/teams/${team.id}/members/${tm.userId}`))}
                    >
                      <Trash2 />
                    </IconButton>
                  </li>
                )
              })}
              {!team.members.length && (
                <li className="py-2 text-[13px] text-fg-subtle">No members yet.</li>
              )}
            </ul>
            <PeoplePicker
              value={adding}
              onChange={setAdding}
              exclude={team.members.map((m) => m.userId)}
            />
            <DialogFooter>
              <Button
                variant="primary"
                disabled={!adding.length}
                onClick={async () => {
                  for (const userId of adding)
                    await run(() =>
                      put(`${api}/teams/${team.id}/members`, { userId, isManager: false }),
                    )
                  setAdding([])
                }}
              >
                Add {adding.length || ''}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
