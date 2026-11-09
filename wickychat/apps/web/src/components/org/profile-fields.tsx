'use client'
import type { Member, ProfileField } from '@quid/shared'
import { Button, Field, Input, Select, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { errorMessage, put } from '@/lib/api'
import { keys, useMembers } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { SettingsCard } from '../settings-ui'

/** `dt`/`dd` rows for a member's answers, in the org's field order. */
export function ProfileFieldRows({
  fields,
  values,
}: {
  fields: ProfileField[]
  values: Record<string, string>
}) {
  return fields
    .filter((f) => values[f.id])
    .map((f) => [
      <dt key={`t-${f.id}`} className="text-fg-subtle">
        {f.label}
      </dt>,
      <dd key={`d-${f.id}`} className="min-w-0 truncate">
        {f.kind === 'link' ? (
          <a
            href={values[f.id]}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent-text underline underline-offset-2"
          >
            {values[f.id]!.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          values[f.id]
        )}
      </dd>,
    ])
}

/** Settings > Profile: the member's answers to this org's profile fields. */
export function OrgProfileCard() {
  const { org, api, me } = useOrgContext()
  const fields = org.customization.profileFields
  const members = useMembers(org.id)
  const qc = useQueryClient()
  const mine = members.data?.find((m) => m.id === me.id)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (mine) setValues(mine.profile ?? {})
  }, [mine])
  if (!fields.length || org.role === 'guest') return null

  return (
    <SettingsCard
      title={`Your profile in ${org.name}`}
      description="Fields your workspace asks for. Everyone in the workspace can see them."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const r = await put<{ profile: Record<string, string> }>(`${api}/profile`, values)
            qc.setQueryData<Member[]>(keys.members(org.id), (l) =>
              l?.map((m) => (m.id === me.id ? { ...m, profile: r.profile } : m)),
            )
            setValues(r.profile)
            toast.success('Profile updated')
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        {fields.map((f) => (
          <Field key={f.id} label={f.label} hint={f.hint || undefined}>
            {(p) =>
              f.kind === 'select' ? (
                <Select
                  {...p}
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                >
                  <option value="">Not set</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  {...p}
                  type={f.kind === 'link' ? 'url' : 'text'}
                  placeholder={f.kind === 'link' ? 'https://' : undefined}
                  maxLength={200}
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                />
              )
            }
          </Field>
        ))}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </SettingsCard>
  )
}
