'use client'
import type { Channel } from '@quid/shared'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Hash, Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { errorMessage, post } from '@/lib/api'
import { keys, useDepartments, useTeams } from '@/lib/queries'
import { FormError } from '../auth-card'
import { useOrgContext } from '../org-context'
import { PeoplePicker } from './people-picker'

export function CreateChannelDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { api, org, base, me } = useOrgContext()
  const router = useRouter()
  const qc = useQueryClient()
  const departments = useDepartments(org.id)
  const teams = useTeams(org.id)
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'public' | 'private'>('public')
  const [scope, setScope] = useState('')
  const [announce, setAnnounce] = useState(false)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setStep(1)
    setName('')
    setDescription('')
    setKind('public')
    setScope('')
    setAnnounce(false)
    setMemberIds([])
    setError(null)
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const [type, id] = scope.split(':')
      const c = await post<Channel>(`${api}/channels`, {
        name,
        description,
        kind,
        departmentId: type === 'dept' ? id : null,
        teamId: type === 'team' ? id : null,
        postingPolicy: announce ? 'admins' : 'everyone',
        memberIds,
      })
      qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
        l ? [...l.filter((x) => x.id !== c.id), c] : l,
      )
      onOpenChange(false)
      reset()
      router.push(`${base}/c/${c.id}`)
    } catch (e) {
      setError(errorMessage(e))
      setStep(1)
    } finally {
      setBusy(false)
    }
  }

  const slugged = name.toLowerCase().replace(/\s+/g, '-')
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent
        title={step === 1 ? 'Create a channel' : `Add people to #${slugged}`}
        description={
          step === 1
            ? 'Channels are where your team talks about a topic, project or team.'
            : kind === 'private'
              ? 'Only people you add can see this channel.'
              : 'You can skip this; anyone can join a public channel.'
        }
      >
        {step === 1 ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setStep(2)
            }}
          >
            <FormError message={error} />
            <Field label="Name">
              {(p) => (
                <div className="relative">
                  <Hash className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
                  <Input
                    {...p}
                    className="pl-7"
                    required
                    maxLength={80}
                    autoFocus
                    placeholder="e.g. q4-launch"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              )}
            </Field>
            <Field label="Description" hint="Optional. What is this channel about?">
              {(p) => (
                <Textarea
                  {...p}
                  className="min-h-16"
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-1.5 text-[13px] font-medium">Visibility</legend>
              {(
                [
                  ['public', Hash, 'Public', 'Anyone in the organization can find and join'],
                  ['private', Lock, 'Private', 'Only invited members'],
                ] as const
              ).map(([k, Icon, label, desc]) => (
                <label
                  key={k}
                  className={cn(
                    'flex cursor-pointer flex-col gap-0.5 rounded-lg border border-border p-3 text-[13px] hover:bg-bg-subtle',
                    kind === k && 'border-accent bg-accent-subtle/50 ring-1 ring-accent',
                  )}
                >
                  <input
                    type="radio"
                    name="kind"
                    className="sr-only"
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  <span className="flex items-center gap-1.5 font-medium">
                    <Icon className="size-3.5" />
                    {label}
                  </span>
                  <span className="text-xs text-fg-muted">{desc}</span>
                </label>
              ))}
            </fieldset>
            {departments.data?.length || teams.data?.length ? (
              <Field
                label="Belongs to"
                hint="Groups the channel under a department or team in the sidebar."
              >
                {(p) => (
                  <Select {...p} value={scope} onChange={(e) => setScope(e.target.value)}>
                    <option value="">Whole organization</option>
                    {departments.data?.map((d) => (
                      <option key={d.id} value={`dept:${d.id}`}>
                        Department · {d.name}
                      </option>
                    ))}
                    {teams.data?.map((t) => (
                      <option key={t.id} value={`team:${t.id}`}>
                        Team · {t.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <div className="flex items-center justify-between gap-4 text-[13px]">
              <span>
                <span className="font-medium">Announcement channel</span>
                <span className="block text-xs text-fg-muted">
                  Only channel admins can post. Everyone can reply in threads.
                </span>
              </span>
              <Switch
                checked={announce}
                onCheckedChange={setAnnounce}
                label="Announcement channel"
              />
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                Next
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <PeoplePicker value={memberIds} onChange={setMemberIds} exclude={[me.id]} autoFocus />
            <DialogFooter>
              <Button onClick={() => setStep(1)}>Back</Button>
              <Button variant="primary" loading={busy} onClick={create}>
                {memberIds.length
                  ? `Create with ${memberIds.length} ${memberIds.length === 1 ? 'person' : 'people'}`
                  : 'Create channel'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
