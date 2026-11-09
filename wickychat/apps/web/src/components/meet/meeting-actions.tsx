'use client'
import type { Meeting, TranscriptSegment } from '@quid/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CalendarPlus,
  Copy,
  Download,
  FileText,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { del, errorMessage, get, patch } from '@/lib/api'
import { googleCalendarUrl, outlookCalendarUrl } from '@/lib/calendar'
import { formatTime } from '@/lib/format'
import { useAiAvailable } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { MeetingNotesDialog } from './meeting-notes'

const localInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Calendar and management actions for one meeting. */
export function MeetingActions({ m }: { m: Meeting }) {
  const { api, base, org, me } = useOrgContext()
  const qc = useQueryClient()
  const [reschedule, setReschedule] = useState(false)
  const [cancel, setCancel] = useState(false)
  const [when, setWhen] = useState(m.scheduledFor ? localInput(m.scheduledFor) : '')
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const aiAvailable = useAiAvailable(org.id)
  const link = typeof window !== 'undefined' ? `${location.origin}${base}/meet/${m.code}` : ''
  const isHost = m.host?.id === me.id
  const attended = isHost || m.participants.some((p) => p.user.id === me.id && p.joinedAt)
  const upcoming = m.status === 'scheduled' && !!m.scheduledFor
  const refresh = () => qc.invalidateQueries({ queryKey: ['meetings', org.id] })

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={`More actions for ${m.title}`} size="sm">
            <MoreHorizontal />
          </IconButton>
        </MenuTrigger>
        <MenuContent align="end" className="w-60">
          <MenuItem
            icon={<Copy />}
            onSelect={() => {
              void navigator.clipboard.writeText(link)
              toast.success('Link copied')
            }}
          >
            Copy link
          </MenuItem>
          {upcoming && (
            <>
              <MenuItem
                icon={<CalendarPlus />}
                onSelect={() => window.open(googleCalendarUrl(m, link), '_blank', 'noopener')}
              >
                Add to Google Calendar
              </MenuItem>
              <MenuItem
                icon={<CalendarPlus />}
                onSelect={() => window.open(outlookCalendarUrl(m, link), '_blank', 'noopener')}
              >
                Add to Outlook
              </MenuItem>
              <MenuItem icon={<Download />} asChild>
                <a href={`${api}/meetings/${m.code}/ics`} download={`${m.code}.ics`}>
                  Download .ics
                </a>
              </MenuItem>
            </>
          )}
          {m.transcriptLines > 0 && (
            <MenuItem
              icon={<FileText />}
              onSelect={async () => {
                try {
                  setTranscript(
                    await get<TranscriptSegment[]>(`${api}/meetings/${m.code}/transcript`),
                  )
                } catch (e) {
                  toast.error(errorMessage(e))
                }
              }}
            >
              View transcript
            </MenuItem>
          )}
          {m.transcriptLines > 0 && aiAvailable && attended && (
            <MenuItem icon={<Sparkles />} onSelect={() => setNotesOpen(true)}>
              Meeting notes
            </MenuItem>
          )}
          {isHost && upcoming && (
            <>
              <MenuSeparator />
              <MenuItem icon={<CalendarClock />} onSelect={() => setReschedule(true)}>
                Change time
              </MenuItem>
              <MenuItem danger icon={<Trash2 />} onSelect={() => setCancel(true)}>
                Cancel meeting
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>

      <Dialog open={reschedule} onOpenChange={setReschedule}>
        <DialogContent
          title="Change time"
          description="Invitees get an updated calendar invitation by email."
        >
          <Field label="Starts">
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <Button onClick={() => setReschedule(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!when}
              onClick={async () => {
                setBusy(true)
                try {
                  await patch(`${api}/meetings/${m.code}`, {
                    scheduledFor: new Date(when).toISOString(),
                  })
                  toast.success('Meeting moved')
                  setReschedule(false)
                  void refresh()
                } catch (e) {
                  toast.error(errorMessage(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancel} onOpenChange={setCancel}>
        <DialogContent
          title={`Cancel "${m.title}"?`}
          description="Invitees get a cancellation by email, and it's removed from their calendars."
        >
          <DialogFooter>
            <Button onClick={() => setCancel(false)}>Keep it</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await del(`${api}/meetings/${m.code}`)
                  toast.success('Meeting canceled')
                  setCancel(false)
                  void refresh()
                } catch (e) {
                  toast.error(errorMessage(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Cancel meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MeetingNotesDialog m={m} open={notesOpen} onOpenChange={setNotesOpen} />
      <Dialog open={!!transcript} onOpenChange={(o) => !o && setTranscript(null)}>
        <DialogContent
          title={`Transcript: ${m.title}`}
          description="From live captions. Only people who turned captions on are included."
          wide
        >
          <ol className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {transcript?.map((seg) => (
              <li key={seg.id} className="text-[13.5px]">
                <span className="mr-2 text-xs text-fg-subtle tabular-nums">
                  {formatTime(seg.spokenAt)}
                </span>
                <span className="font-semibold">{seg.speakerName}:</span> {seg.text}
              </li>
            ))}
          </ol>
          <DialogFooter>
            <Button
              onClick={() => {
                const text = (transcript ?? [])
                  .map((seg) => `[${formatTime(seg.spokenAt)}] ${seg.speakerName}: ${seg.text}`)
                  .join('\n')
                const url = URL.createObjectURL(
                  new Blob([`${m.title}\n\n${text}\n`], { type: 'text/plain' }),
                )
                const a = document.createElement('a')
                a.href = url
                a.download = `${m.code}-transcript.txt`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download /> Download .txt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
