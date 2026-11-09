'use client'
import { Button, Select, Skeleton, Switch, toast } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { Download, ShieldCheck } from 'lucide-react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { errorMessage, get, patch } from '@/lib/api'

type Compliance = {
  enterprise: boolean
  googleAvailable: boolean
  retentionDays: number | null
  requireGoogle: boolean
}

const RETENTION = [
  { value: '', label: 'Keep everything (no automatic deletion)' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
  { value: '1825', label: '5 years' },
]

export default function ComplianceSettings() {
  const { org, api, me } = useOrgContext()
  const canChange = org.role === 'owner' || org.role === 'admin'
  const q = useQuery({
    queryKey: ['compliance', org.id],
    queryFn: ({ signal }) => get<Compliance>(`${api}/admin/compliance`, signal),
  })
  const c = q.data

  const save = async (body: Partial<Compliance>, done: string) => {
    try {
      await patch(`${api}/admin/compliance`, body)
      toast.success(done)
      void q.refetch()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <SettingsTitle
        title="Compliance"
        description={`Retention and audit controls for ${org.name}.`}
      />
      {!c ? (
        <Skeleton className="h-60" />
      ) : (
        <>
          <SettingsCard
            title="Message retention"
            description="Automatically delete messages and their files once they're older than this. Deleted content can't be recovered."
          >
            <Select
              aria-label="Keep messages for"
              disabled={!canChange}
              value={c.retentionDays ? String(c.retentionDays) : ''}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null
                if (
                  v &&
                  !window.confirm(
                    `Messages older than ${e.target.selectedOptions[0]?.text} will be permanently deleted, starting within the hour. Continue?`,
                  )
                )
                  return
                void save(
                  { retentionDays: v },
                  v ? 'Retention rule saved' : 'Retention rule removed',
                )
              }}
              className="max-w-sm"
            >
              {RETENTION.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </SettingsCard>

          <SettingsCard
            title="Audit log export"
            description="Every admin action, sign-in of connected apps and permission change, as a spreadsheet (CSV)."
          >
            <Button asChild>
              <a href={`${api}/admin/audit.csv`} download>
                <Download /> Download CSV
              </a>
            </Button>
          </SettingsCard>

          {c.googleAvailable && (
            <SettingsCard
              title="Sign-in"
              description="Everyone must sign in with Google to open this workspace."
            >
              <div className="flex items-center justify-between gap-4 text-[13px]">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-fg-subtle" />
                  Require Google sign-in
                  {me.authMethod !== 'google' && (
                    <span className="text-xs text-fg-subtle">(sign in with Google first)</span>
                  )}
                </span>
                <Switch
                  checked={c.requireGoogle}
                  disabled={!canChange || (me.authMethod !== 'google' && !c.requireGoogle)}
                  onCheckedChange={(v) =>
                    save(
                      { requireGoogle: v },
                      v ? 'Google sign-in is now required' : 'Requirement removed',
                    )
                  }
                  label="Require Google sign-in"
                />
              </div>
            </SettingsCard>
          )}
        </>
      )}
    </>
  )
}
