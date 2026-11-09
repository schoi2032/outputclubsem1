'use client'
import type { Meeting, MeetingJoinResult } from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Select,
  Spinner,
  Tooltip,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createLocalVideoTrack, type LocalVideoTrack, Room } from 'livekit-client'
import {
  Captions,
  ChevronUp,
  Circle,
  Copy,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Presentation,
  Users,
  Video,
  VideoOff,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage, get, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { onMeetingEvent } from '@/lib/realtime'
import { claimSession, releaseSession } from '@/lib/session'
import { useOrgContext } from '../org-context'
import { CaptionConsent, CaptionOverlay, hasCaptionConsent } from './captions'
import { ChatPanel, PeoplePanel } from './side-panel'
import { Stage } from './stage'
import { useCaptions } from './use-captions'
import { useMeetingRoom } from './use-meeting-room'
import { useRecording } from './use-recording'

type Phase = 'lobby' | 'joining' | 'waiting' | 'denied' | 'in' | 'gone'

export function CircleButton({
  label,
  active = true,
  danger,
  onClick,
  children,
  badge,
}: {
  label: string
  active?: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
  badge?: number
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={!active}
        onClick={onClick}
        className={cn(
          'relative flex size-11 items-center justify-center rounded-full transition-colors [&_svg]:size-5',
          danger
            ? 'bg-danger text-white hover:opacity-90'
            : active
              ? 'bg-white/10 text-white hover:bg-white/20'
              : 'bg-danger/90 text-white hover:bg-danger',
        )}
      >
        {children}
        {!!badge && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-2xs font-semibold">
            {badge}
          </span>
        )}
      </button>
    </Tooltip>
  )
}

function useDevices(kind: MediaDeviceKind, enabled: boolean) {
  const [list, setList] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    if (!enabled) return
    const load = () =>
      Room.getLocalDevices(kind, false)
        .then(setList)
        .catch(() => setList([]))
    void load()
    navigator.mediaDevices?.addEventListener('devicechange', load)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load)
  }, [kind, enabled])
  return list
}

export type MediaPrefs = { mic: boolean; camera: boolean; micId?: string; cameraId?: string }

/** Camera preview, mic/camera toggles and device pickers before joining. Used by members and guests. */
export function PreJoin({
  title,
  subtitle,
  description,
  person,
  joinLabel,
  busy,
  canJoin = true,
  onJoin,
  children,
  footer,
}: {
  title: string
  subtitle: React.ReactNode
  description?: string
  person: { name: string; id: string; avatarUrl?: string | null }
  joinLabel: string
  busy: boolean
  canJoin?: boolean
  onJoin: (o: MediaPrefs) => void
  children?: React.ReactNode
  footer?: React.ReactNode
}) {
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(true)
  const [micId, setMicId] = useState<string>()
  const [cameraId, setCameraId] = useState<string>()
  const [preview, setPreview] = useState<LocalVideoTrack | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [permitted, setPermitted] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const mics = useDevices('audioinput', permitted)
  const cams = useDevices('videoinput', permitted)

  // Ask for permission once so device names are available.
  useEffect(() => {
    navigator.mediaDevices
      ?.getUserMedia({ audio: true, video: true })
      .then((s) => {
        for (const t of s.getTracks()) t.stop()
        setPermitted(true)
      })
      .catch(() => setPermitted(true))
  }, [])

  useEffect(() => {
    if (!camera) {
      setPreview(null)
      return
    }
    let track: LocalVideoTrack | null = null
    let cancelled = false
    createLocalVideoTrack(cameraId ? { deviceId: cameraId } : {})
      .then((t) => {
        if (cancelled) return t.stop()
        track = t
        setCamError(null)
        setPreview(t)
      })
      .catch(() => {
        setCamError("Camera isn't available. Check your browser's permissions.")
        setCamera(false)
      })
    return () => {
      cancelled = true
      track?.stop()
    }
  }, [camera, cameraId])

  useEffect(() => {
    if (preview && video.current) preview.attach(video.current)
    return () => {
      if (preview && video.current) preview.detach(video.current)
    }
  }, [preview])

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 md:p-8">
      <div className="grid w-full max-w-5xl items-center gap-8 md:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#1f1f23]">
            {preview ? (
              <video
                ref={video}
                autoPlay
                playsInline
                muted
                className="size-full -scale-x-100 object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 text-white/70">
                <Avatar
                  name={person.name || '?'}
                  id={person.id}
                  src={person.avatarUrl}
                  size="xl"
                  className="[&>span]:size-20 [&>span]:text-2xl"
                />
                <span className="text-sm">{camError ?? 'Camera is off'}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
              <CircleButton
                label={mic ? 'Turn off microphone' : 'Turn on microphone'}
                active={mic}
                onClick={() => setMic((v) => !v)}
              >
                {mic ? <Mic /> : <MicOff />}
              </CircleButton>
              <CircleButton
                label={camera ? 'Turn off camera' : 'Turn on camera'}
                active={camera}
                onClick={() => setCamera((v) => !v)}
              >
                {camera ? <Video /> : <VideoOff />}
              </CircleButton>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Select
              aria-label="Microphone"
              value={micId ?? ''}
              onChange={(e) => setMicId(e.target.value || undefined)}
            >
              <option value="">Default microphone</option>
              {mics
                .filter((d) => d.deviceId && d.deviceId !== 'default')
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Microphone'}
                  </option>
                ))}
            </Select>
            <Select
              aria-label="Camera"
              value={cameraId ?? ''}
              onChange={(e) => setCameraId(e.target.value || undefined)}
            >
              <option value="">Default camera</option>
              {cams
                .filter((d) => d.deviceId)
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Camera'}
                  </option>
                ))}
            </Select>
          </div>
        </div>
        <div className="text-center md:text-left">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-2 text-[13px] text-fg-muted">{subtitle}</p>
          {description && <p className="mt-3 text-[13px] whitespace-pre-wrap">{description}</p>}
          {children}
          <Button
            variant="primary"
            size="lg"
            className="mt-6 w-full md:w-auto md:px-8"
            loading={busy}
            disabled={!canJoin}
            onClick={() => {
              preview?.stop()
              onJoin({ mic, camera, micId, cameraId })
            }}
          >
            {joinLabel}
          </Button>
          {footer}
        </div>
      </div>
    </div>
  )
}

function Lobby({
  meeting,
  onJoin,
  busy,
}: {
  meeting: Meeting
  onJoin: (o: MediaPrefs) => void
  busy: boolean
}) {
  const { me } = useOrgContext()
  const inside = meeting.participants.filter((p) => p.status === 'joined')
  const names = inside
    .map((p) => displayName(p.user).split(' ')[0])
    .slice(0, 3)
    .join(', ')
  return (
    <PreJoin
      title={meeting.title}
      subtitle={
        inside.length === 0
          ? 'No one else is here yet.'
          : `${names}${inside.length > 3 ? ` and ${inside.length - 3} more` : ''} ${inside.length === 1 ? 'is' : 'are'} in the meeting.`
      }
      description={meeting.description}
      person={me}
      joinLabel={
        meeting.waitingRoom && meeting.myRole !== 'host' && meeting.myRole !== 'co_host'
          ? 'Ask to join'
          : 'Join now'
      }
      busy={busy}
      onJoin={onJoin}
      footer={<p className="mt-3 text-xs text-fg-subtle">Meeting code: {meeting.code}</p>}
    />
  )
}

export function MeetingRoom({ code }: { code: string }) {
  const { org, api, base, me } = useOrgContext()
  const qc = useQueryClient()
  const meetingQ = useQuery({
    queryKey: ['meeting', org.id, code],
    queryFn: ({ signal }) => get<Meeting>(`${api}/meetings/${code}`, signal),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  })
  const meeting = meetingQ.data
  const room = useMeetingRoom()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [panel, setPanel] = useState<'chat' | 'people' | null>(null)
  const [layout, setLayout] = useState<'gallery' | 'speaker'>('gallery')
  const [pinned, setPinned] = useState<string | null>(null)
  const [captionsOn, setCaptionsOn] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [recordConfirm, setRecordConfirm] = useState(false)
  const recorder = useRecording({
    room: room.room,
    fileName: `quid-${code}-${new Date().toISOString().slice(0, 10)}`,
    announce: room.announceRecording,
  })
  const captionState = useCaptions({
    enabled: captionsOn && phase === 'in',
    micOn: room.micOn,
    transcriptUrl: `${api}/meetings/${code}/transcript`,
    publish: room.publishCaption,
  })
  useEffect(() => {
    if (captionState.error) {
      toast.error(captionState.error)
      setCaptionsOn(false)
    }
  }, [captionState.error])
  const mediaPrefs = useRef<{ mic: boolean; camera: boolean; micId?: string; cameraId?: string }>({
    mic: true,
    camera: true,
  })

  useEffect(() => {
    room.setChatOpen(panel === 'chat')
  }, [panel, room.setChatOpen])

  const enter = useCallback(async () => {
    setPhase('joining')
    try {
      const r = await post<MeetingJoinResult>(`${api}/meetings/${code}/join`)
      qc.setQueryData(['meeting', org.id, code], r.meeting)
      if (r.status === 'waiting') {
        setPhase('waiting')
        return
      }
      await room.connect(r.url, r.token, mediaPrefs.current)
      setPhase('in')
    } catch (e) {
      toast.error("Couldn't join the meeting", { description: errorMessage(e) })
      setPhase('lobby')
    }
  }, [api, code, org.id, qc, room.connect])

  // Waiting room: react to being admitted or denied.
  useEffect(
    () =>
      onMeetingEvent((e) => {
        if (e.meeting.code !== code || phase !== 'waiting') return
        const mine = e.meeting.participants.find((p) => p.user.id === me.id)?.status
        if (mine === 'invited') void enter()
        if (mine === 'denied') setPhase('denied')
      }),
    [code, phase, enter, me.id],
  )

  useEffect(() => {
    if (room.endReason && phase === 'in') setPhase('gone')
  }, [room.endReason, phase])

  // Tell the server we left when the tab closes.
  useEffect(() => {
    if (phase !== 'in' && phase !== 'waiting') return
    const onHide = () => navigator.sendBeacon?.(`${api}/meetings/${code}/leave`)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [phase, api, code])

  useEffect(() => {
    document.title = meeting ? `${meeting.title} · WickyChat Meet` : 'WickyChat Meet'
  }, [meeting])

  const leave = async (endForAll = false) => {
    try {
      if (endForAll) await post(`${api}/meetings/${code}/end`)
      else await post(`${api}/meetings/${code}/leave`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
    await room.disconnect()
    releaseSession('meeting')
    setPhase('gone')
    void qc.invalidateQueries({ queryKey: ['meetings', org.id] })
  }

  if (meetingQ.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-subtle">
        <Spinner className="size-5" />
      </div>
    )
  }
  if (!meeting) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Meeting not found</h1>
        <p className="max-w-sm text-[13px] text-fg-muted">
          Check the code, or ask the host for a new link. Guests can only join meetings they were
          invited to.
        </p>
        <Button asChild>
          <Link href={`${base}/meet`}>Back to Meet</Link>
        </Button>
      </div>
    )
  }

  if (phase === 'lobby' || phase === 'joining') {
    return (
      <Lobby
        meeting={meeting}
        busy={phase === 'joining'}
        onJoin={async (prefs) => {
          mediaPrefs.current = prefs
          await claimSession('meeting', async () => {
            await post(`${api}/meetings/${code}/leave`).catch(() => {})
            await room.disconnect()
            setPhase('gone')
          })
          await enter()
        }}
      />
    )
  }

  if (phase === 'waiting' || phase === 'denied') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        {phase === 'waiting' ? <Spinner className="size-6 text-fg-subtle" /> : null}
        <h1 className="text-xl font-semibold">
          {phase === 'waiting' ? 'Waiting for the host to let you in' : "You weren't let in"}
        </h1>
        <p className="max-w-sm text-[13px] text-fg-muted">
          {phase === 'waiting'
            ? `${meeting.host ? displayName(meeting.host) : 'The host'} has been told you're here. This page updates by itself.`
            : 'Someone in the meeting declined your request to join.'}
        </p>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              await post(`${api}/meetings/${code}/leave`).catch(() => {})
              setPhase('lobby')
            }}
          >
            {phase === 'waiting' ? 'Cancel' : 'Back'}
          </Button>
          {phase === 'denied' && (
            <Button variant="primary" onClick={() => void enter()}>
              Ask again
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (phase === 'gone') {
    const reason = room.endReason
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">
          {reason === 'removed'
            ? 'You were removed from the meeting'
            : reason === 'ended'
              ? 'The host ended the meeting'
              : reason === 'error'
                ? 'You lost connection'
                : 'You left the meeting'}
        </h1>
        <div className="flex gap-2">
          {reason !== 'removed' && (
            <Button variant="primary" onClick={() => setPhase('lobby')}>
              Rejoin
            </Button>
          )}
          <Button asChild>
            <Link href={`${base}/meet`}>Back to Meet</Link>
          </Button>
        </div>
      </div>
    )
  }

  const moderator = meeting.myRole === 'host' || meeting.myRole === 'co_host'
  const waitingCount =
    meeting.participants.filter((p) => p.status === 'waiting').length +
    meeting.guests.filter((g) => g.status === 'waiting').length
  const someoneSharing = room.tiles.some((t) => t.kind === 'screen' && !t.isLocal)

  return (
    <div className="flex min-h-0 flex-1 bg-[#111113] text-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 px-4">
          <h1 className="truncate text-[14px] font-semibold">{meeting.title}</h1>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            onClick={() => {
              void navigator.clipboard.writeText(`${location.origin}${base}/meet/${code}`)
              toast.success('Meeting link copied')
            }}
          >
            {code} <Copy className="size-3" />
          </button>
          {(recorder.recording || room.recordingBy) && (
            <span
              className="flex items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-0.5 text-xs font-semibold text-red-300"
              role="status"
            >
              <span className="size-2 animate-pulse rounded-full bg-danger" />
              {recorder.recording
                ? 'Recording · saved to your computer when you stop'
                : `Recording by ${room.recordingBy!.name}`}
            </span>
          )}
          {moderator && waitingCount > 0 && (
            <button
              type="button"
              onClick={() => setPanel('people')}
              className="ml-auto animate-pulse rounded-full bg-warning px-3 py-1 text-xs font-semibold text-black"
            >
              {waitingCount} waiting to join
            </button>
          )}
        </header>
        <div className="relative min-h-0 flex-1">
          <Stage tiles={room.tiles} layout={layout} pinned={pinned} onPin={setPinned} />
          {captionsOn && <CaptionOverlay captions={room.captions} />}
        </div>
        <footer className="flex shrink-0 items-center justify-center gap-2 px-4 py-3 md:gap-3">
          <CircleButton
            label={room.micOn ? 'Mute microphone' : 'Unmute microphone'}
            active={room.micOn}
            onClick={() => void room.toggle('mic').catch((e) => toast.error(errorMessage(e)))}
          >
            {room.micOn ? <Mic /> : <MicOff />}
          </CircleButton>
          <CircleButton
            label={room.cameraOn ? 'Turn off camera' : 'Turn on camera'}
            active={room.cameraOn}
            onClick={() => void room.toggle('camera').catch((e) => toast.error(errorMessage(e)))}
          >
            {room.cameraOn ? <Video /> : <VideoOff />}
          </CircleButton>
          <DeviceMenu room={room} />
          <CircleButton
            label={
              room.sharing
                ? 'Stop sharing'
                : someoneSharing
                  ? 'Someone is already presenting'
                  : 'Share screen'
            }
            active
            onClick={() => {
              if (someoneSharing && !room.sharing)
                return toast.info('Someone is already presenting.')
              void room.toggle('screen').catch((e) => {
                if (!/permission|denied|abort/i.test(String(e)))
                  toast.error("Couldn't share your screen", { description: errorMessage(e) })
              })
            }}
          >
            {room.sharing ? <MonitorX className="text-warning" /> : <MonitorUp />}
          </CircleButton>
          {moderator && recorder.supported && (
            <CircleButton
              label={recorder.recording ? 'Stop recording' : 'Record'}
              onClick={() => (recorder.recording ? recorder.stop() : setRecordConfirm(true))}
            >
              <Circle className={recorder.recording ? 'fill-danger text-danger' : undefined} />
            </CircleButton>
          )}
          <CircleButton
            label={
              !captionState.supported
                ? "Captions aren't supported in this browser"
                : captionsOn
                  ? 'Turn off captions'
                  : 'Turn on captions'
            }
            onClick={() => {
              if (!captionState.supported)
                return toast.info('Live captions need Chrome, Edge or Safari.')
              if (captionsOn) return setCaptionsOn(false)
              if (hasCaptionConsent()) setCaptionsOn(true)
              else setConsentOpen(true)
            }}
          >
            <Captions className={captionsOn ? 'text-accent-text' : undefined} />
          </CircleButton>
          <CircleButton
            label={layout === 'gallery' ? 'Speaker view' : 'Gallery view'}
            onClick={() => setLayout((l) => (l === 'gallery' ? 'speaker' : 'gallery'))}
          >
            {layout === 'gallery' ? <Presentation /> : <LayoutGrid />}
          </CircleButton>
          <CircleButton
            label="Chat"
            onClick={() => setPanel((p) => (p === 'chat' ? null : 'chat'))}
            badge={panel === 'chat' ? 0 : room.unread}
          >
            <MessageSquare />
          </CircleButton>
          <CircleButton
            label="People"
            onClick={() => setPanel((p) => (p === 'people' ? null : 'people'))}
            badge={moderator ? waitingCount : 0}
          >
            <Users />
          </CircleButton>
          {moderator ? (
            <Menu>
              <MenuTrigger asChild>
                <button
                  type="button"
                  className="ml-2 flex h-11 items-center gap-1.5 rounded-full bg-danger px-5 text-[13px] font-semibold hover:opacity-90"
                  aria-label="Leave options"
                >
                  <PhoneOff className="size-5" /> Leave <ChevronUp className="size-4" />
                </button>
              </MenuTrigger>
              <MenuContent side="top" align="end">
                <MenuItem onSelect={() => void leave(false)}>Leave meeting</MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => void leave(true)}>
                  End meeting for everyone
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : (
            <button
              type="button"
              onClick={() => void leave(false)}
              className="ml-2 flex h-11 items-center gap-1.5 rounded-full bg-danger px-5 text-[13px] font-semibold hover:opacity-90"
            >
              <PhoneOff className="size-5" /> Leave
            </button>
          )}
        </footer>
      </div>
      {panel && (
        <div className="fixed inset-0 z-40 flex w-full flex-col bg-bg text-fg md:static md:w-80 md:border-l md:border-border">
          {panel === 'chat' ? (
            <ChatPanel room={room} onClose={() => setPanel(null)} />
          ) : (
            <PeoplePanel meeting={meeting} room={room} onClose={() => setPanel(null)} />
          )}
        </div>
      )}
      <Dialog open={recordConfirm} onOpenChange={setRecordConfirm}>
        <DialogContent
          title="Record this meeting?"
          description="Everyone in the meeting sees that it's being recorded."
        >
          <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] text-fg-muted">
            <li>
              Your browser asks which tab to share: choose this tab. The recording shows the meeting
              view with everyone's audio.
            </li>
            <li>
              When you stop, the video is saved to your computer. Nothing is uploaded to WickyChat.
            </li>
            <li>Make sure everyone agrees to being recorded.</li>
          </ul>
          <DialogFooter>
            <Button onClick={() => setRecordConfirm(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                setRecordConfirm(false)
                try {
                  await recorder.start()
                } catch (e) {
                  if (!/permission|denied|abort|cancel/i.test(String(e)))
                    toast.error("Couldn't start recording", { description: errorMessage(e) })
                }
              }}
            >
              Start recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CaptionConsent
        open={consentOpen}
        onOpenChange={setConsentOpen}
        onAccept={() => setCaptionsOn(true)}
      />
      <div ref={room.audioBox} hidden aria-hidden="true" />
    </div>
  )
}

export function DeviceMenu({ room }: { room: ReturnType<typeof useMeetingRoom> }) {
  const [devices, setDevices] = useState<Record<string, MediaDeviceInfo[]>>({})
  const load = async () => {
    const [mic, cam, out] = await Promise.all(
      (['audioinput', 'videoinput', 'audiooutput'] as const).map((k) =>
        Room.getLocalDevices(k, false).catch(() => []),
      ),
    )
    setDevices({ audioinput: mic!, videoinput: cam!, audiooutput: out! })
  }
  const section = (kind: MediaDeviceKind, label: string) => (
    <>
      <MenuLabel>{label}</MenuLabel>
      {(devices[kind] ?? []).length ? (
        devices[kind]!.map((d) => (
          <MenuItem
            key={`${kind}:${d.deviceId}`}
            onSelect={() =>
              void room.switchDevice(kind, d.deviceId).catch((e) => toast.error(errorMessage(e)))
            }
          >
            {d.label || label}
          </MenuItem>
        ))
      ) : (
        <MenuItem disabled>None found</MenuItem>
      )}
    </>
  )
  return (
    <Menu onOpenChange={(o) => o && void load()}>
      <Tooltip content="Devices">
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="Devices"
            className="flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <ChevronUp className="size-5" />
          </button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent side="top" align="center" className="w-72">
        {section('audioinput', 'Microphone')}
        <MenuSeparator />
        {section('videoinput', 'Camera')}
        <MenuSeparator />
        {section('audiooutput', 'Speaker')}
      </MenuContent>
    </Menu>
  )
}
