'use client'
import type { Meeting } from '@quid/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { errorMessage, post } from '@/lib/api'
import { PeoplePicker } from '../dialogs/people-picker'
import { useOrgContext } from '../org-context'

function defaultStart() {
  const d = new Date(Date.now() + 60 * 60_000)
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ScheduleDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [when, setWhen] = useState(defaultStart)
  const [duration, setDuration] = useState(30)
  const [waitingRoom, setWaitingRoom] = useState(true)
  const [guestAccess, setGuestAccess] = useState(false)
  const [invitees, setInvitees] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Schedule a meeting"
        description="Invitees get an Activity notification and an email with the link."
        wide
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              const m = await post<Meeting>(`${api}/meetings`, {
                title,
                description,
                scheduledFor: new Date(when).toISOString(),
                durationMinutes: duration,
                waitingRoom,
                guestAccess,
                inviteeIds: invitees,
              })
              void qc.invalidateQueries({ queryKey: ['meetings', org.id] })
              toast.success('Meeting scheduled', { description: `Code ${m.code}` })
              onOpenChange(false)
              setTitle('')
              setDescription('')
              setInvitees([])
            } catch (err) {
              toast.error(errorMessage(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label="Title">
            {(p) => (
              <Input
                {...p}
                required
                maxLength={120}
                autoFocus
                placeholder="Weekly planning"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Starts">
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  required
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              )}
            </Field>
            <Field label="Duration">
              {(p) => (
                <Select
                  {...p}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {[15, 30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${m / 60} h`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Description" hint="Optional agenda or notes.">
            {(p) => (
              <Textarea
                {...p}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Invite people</p>
            <PeoplePicker value={invitees} onChange={setInvitees} exclude={[me.id]} />
          </div>
          <div className="flex items-center justify-between gap-4 text-[13px]">
            <span>
              Waiting room
              <span className="block text-xs text-fg-subtle">
                People you didn't invite wait until a host lets them in.
              </span>
            </span>
            <Switch checked={waitingRoom} onCheckedChange={setWaitingRoom} label="Waiting room" />
          </div>
          <div className="flex items-center justify-between gap-4 text-[13px]">
            <span>
              Allow guests
              <span className="block text-xs text-fg-subtle">
                People without a WickyChat account can ask to join with the guest link.
              </span>
            </span>
            <Switch checked={guestAccess} onCheckedChange={setGuestAccess} label="Allow guests" />
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
