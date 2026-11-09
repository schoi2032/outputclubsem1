'use client'
import type { OrgRole } from '@quid/shared'
import { assignableRoles, ROLE_LABEL } from '@quid/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Select,
  Textarea,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { errorMessage, post } from '@/lib/api'
import { useDepartments } from '@/lib/queries'
import { FormError } from '../auth-card'
import { useOrgContext } from '../org-context'

export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const departments = useDepartments(org.id)
  const roles = assignableRoles(org.role)
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState<OrgRole>(
    roles.includes('member') ? 'member' : (roles[0] ?? 'guest'),
  )
  const [dept, setDept] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = emails
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Invite people to ${org.name}`}
        description="They'll get an email with a link to join. Invitations expire after 7 days."
      >
        <FormError message={error} />
        <div className="flex flex-col gap-4">
          <Field label="Email addresses" hint="Separate addresses with commas or new lines.">
            {(p) => (
              <Textarea
                {...p}
                autoFocus
                placeholder="name@company.com, another@company.com"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              {(p) => (
                <Select {...p} value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {departments.data && departments.data.length > 0 && role !== 'guest' && (
              <Field label="Department">
                {(p) => (
                  <Select {...p} value={dept} onChange={(e) => setDept(e.target.value)}>
                    <option value="">None</option>
                    {departments.data.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
          {role === 'guest' && (
            <p className="text-xs text-fg-muted">
              Guests only see channels and conversations they're explicitly added to.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={list.length === 0}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const r = await post<{ results: { email: string; status: string }[] }>(
                  `${api}/invitations`,
                  {
                    emails: list,
                    role,
                    departmentId: dept || null,
                  },
                )
                const invited = r.results.filter((x) => x.status === 'invited').length
                const already = r.results.length - invited
                toast.success(
                  `${invited} invitation${invited === 1 ? '' : 's'} sent`,
                  already
                    ? {
                        description: `${already} already ${already === 1 ? 'is a member' : 'are members'}.`,
                      }
                    : undefined,
                )
                void qc.invalidateQueries({ queryKey: ['invitations', org.id] })
                setEmails('')
                onOpenChange(false)
              } catch (e) {
                setError(errorMessage(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Send {list.length > 1 ? `${list.length} invitations` : 'invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
