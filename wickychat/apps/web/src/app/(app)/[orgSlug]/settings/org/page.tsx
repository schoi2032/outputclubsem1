'use client'
import type { Attachment, Org } from '@quid/shared'
import { Avatar, Button, Field, Input, Skeleton, Textarea, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { errorMessage, patch, post, upload } from '@/lib/api'
import { keys, useOrg } from '@/lib/queries'

export default function OrgSettings() {
  const { org, api } = useOrgContext()
  const qc = useQueryClient()
  const full = useOrg(org.id)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [domains, setDomains] = useState('')
  const [saving, setSaving] = useState(false)
  const [annTitle, setAnnTitle] = useState('')
  const [annBody, setAnnBody] = useState('')
  const [annBusy, setAnnBusy] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!full.data) return
    setName(full.data.name)
    setDescription(full.data.description)
    setDomains(full.data.allowedEmailDomains.join(', '))
  }, [full.data])

  const save = async (body: Record<string, unknown>) => {
    setSaving(true)
    try {
      const o = await patch<Org>(api, body)
      qc.setQueryData(keys.org(org.id), o)
      await qc.invalidateQueries({ queryKey: keys.me })
      toast.success('Organization updated')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (!full.data) return <Skeleton className="h-80" />
  return (
    <>
      <SettingsTitle
        title="General"
        description="Your organization's identity and sign-up rules."
      />
      <SettingsCard title="Organization">
        <div className="mb-5 flex items-center gap-4">
          <Avatar
            name={full.data.name}
            id={org.id}
            src={full.data.logoUrl}
            shape="square"
            size="xl"
          />
          <Button size="sm" onClick={() => logoRef.current?.click()}>
            Upload logo
          </Button>
          <input
            ref={logoRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                const f = await upload<Attachment>(`${api}/files?purpose=logo`, file).promise
                await save({ logoFileId: f.id })
              } catch (err) {
                toast.error(errorMessage(err))
              }
            }}
          />
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save({
              name,
              description,
              allowedEmailDomains: domains
                .split(/[\s,]+/)
                .map((d) => d.trim().replace(/^@/, ''))
                .filter(Boolean),
            })
          }}
        >
          <Field label="Name">
            {(p) => (
              <Input
                {...p}
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="URL">
            {(p) => <Input {...p} value={`/${full.data!.slug}`} disabled />}
          </Field>
          <Field label="Description">
            {(p) => (
              <Textarea
                {...p}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Allowed email domains"
            hint="When set, only these domains can be invited as members. Anyone can still be invited as a guest."
          >
            {(p) => (
              <Input
                {...p}
                placeholder="company.com, company.co.uk"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      </SettingsCard>

      <SettingsCard
        title="Send an announcement"
        description="Delivered to everyone in the organization as an Activity notification."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setAnnBusy(true)
            try {
              const r = await post<{ sent: number }>(`${api}/announcements`, {
                title: annTitle,
                body: annBody,
              })
              toast.success(`Announcement sent to ${r.sent} people`)
              setAnnTitle('')
              setAnnBody('')
            } catch (err) {
              toast.error(errorMessage(err))
            } finally {
              setAnnBusy(false)
            }
          }}
        >
          <Input
            placeholder="Title"
            required
            maxLength={120}
            value={annTitle}
            onChange={(e) => setAnnTitle(e.target.value)}
            aria-label="Announcement title"
          />
          <Textarea
            placeholder="Message"
            required
            maxLength={4000}
            value={annBody}
            onChange={(e) => setAnnBody(e.target.value)}
            aria-label="Announcement message"
          />
          <div className="flex justify-end">
            <Button type="submit" loading={annBusy}>
              <Megaphone /> Send announcement
            </Button>
          </div>
        </form>
      </SettingsCard>
    </>
  )
}
