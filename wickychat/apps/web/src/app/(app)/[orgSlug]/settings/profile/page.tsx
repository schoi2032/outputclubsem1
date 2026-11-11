'use client'
import type { Attachment } from '@quid/shared'
import { Avatar, Button, Field, Input, Select, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Monitor } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { OrgProfileCard } from '@/components/org/profile-fields'
import { useOrgContext } from '@/components/org-context'
import { ProfileCardEditor } from '@/components/profile/profile-editor'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { del, errorMessage, get, patch, post, upload } from '@/lib/api'
import { relative } from '@/lib/format'
import { keys } from '@/lib/queries'

type Session = {
  id: string
  createdAt: string
  lastSeenAt: string
  ip: string | null
  userAgent: string | null
  current: boolean
}

function device(ua: string | null) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return `${browser}${os ? ` on ${os}` : ''}`
}

export default function ProfileSettings() {
  const { me, api } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState(me.name)
  const [displayName, setDisplayName] = useState(me.displayName ?? '')
  const [timezone, setTimezone] = useState(
    me.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => get<Session[]>('/api/me/sessions', signal),
  })
  useEffect(() => setName(me.name), [me.name])

  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [timezone]

  const save = async (body: Record<string, unknown>) => {
    setSaving(true)
    try {
      await patch('/api/me', body)
      await qc.invalidateQueries({ queryKey: keys.me })
      toast.success('Profile updated')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SettingsTitle
        title="Profile & security"
        description="Your profile is shared across every organization you belong to."
      />
      <SettingsCard title="Profile">
        <div className="mb-5 flex items-center gap-4">
          <Avatar
            name={me.name}
            id={me.id}
            src={me.avatarUrl}
            decoration={me.decoration}
            size="xl"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              Upload photo
            </Button>
            {me.avatarUrl && (
              <Button size="sm" variant="ghost" onClick={() => save({ avatarFileId: null })}>
                Remove
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  const f = await upload<Attachment>(`${api}/files?purpose=avatar`, file).promise
                  await save({ avatarFileId: f.id })
                } catch (err) {
                  toast.error(errorMessage(err))
                }
              }}
            />
            <p className="w-full text-xs text-fg-subtle">
              PNG, JPEG, GIF or WebP up to 5 MB. Animated GIFs and WebPs play when people hover.
            </p>
          </div>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save({ name, displayName, timezone })
          }}
        >
          <Field label="Full name">
            {(p) => (
              <Input
                {...p}
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Display name"
            hint="Shown in conversations instead of your full name. Optional."
          >
            {(p) => (
              <Input
                {...p}
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Time zone">
            {(p) => (
              <Select {...p} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Email">{(p) => <Input {...p} value={me.email} disabled />}</Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={saving}>
              Save profile
            </Button>
          </div>
        </form>
      </SettingsCard>

      <ProfileCardEditor />

      <OrgProfileCard />

      <SettingsCard
        title="Password"
        description={
          me.hasPassword
            ? 'Changing your password signs you out on every other device.'
            : 'You sign in with Google. Add a password to also sign in with your email.'
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setPwBusy(true)
            try {
              await post('/api/me/password', {
                ...(me.hasPassword && { currentPassword: current }),
                newPassword: next,
              })
              void qc.invalidateQueries({ queryKey: keys.me })
              setCurrent('')
              setNext('')
              void sessions.refetch()
              toast.success(me.hasPassword ? 'Password changed' : 'Password added')
            } catch (err) {
              toast.error(errorMessage(err))
            } finally {
              setPwBusy(false)
            }
          }}
        >
          {me.hasPassword && (
            <Field label="Current password">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label="New password" hint="At least 10 characters.">
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={pwBusy}>
              {me.hasPassword ? 'Change password' : 'Add password'}
            </Button>
          </div>
        </form>
      </SettingsCard>

      {me.linkedProviders.includes('google') && (
        <SettingsCard title="Sign-in methods">
          <p className="text-[13px] text-fg-muted">
            Google is connected: you can use “Continue with Google” with {me.email}.
          </p>
        </SettingsCard>
      )}

      <SettingsCard
        title="Active sessions"
        description="Devices currently signed in to your account."
      >
        {sessions.isLoading ? (
          <Skeleton className="h-12" />
        ) : (
          <ul className="divide-y divide-border">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <Monitor className="size-4 text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">
                    {device(s.userAgent)}{' '}
                    {s.current && <span className="font-normal text-success">· This device</span>}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {s.ip ?? 'Unknown IP'} · active {relative(s.lastSeenAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await del(`/api/me/sessions/${s.id}`).catch((e) =>
                        toast.error(errorMessage(e)),
                      )
                      void sessions.refetch()
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </>
  )
}
