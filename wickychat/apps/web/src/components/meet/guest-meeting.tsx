'use client'
/**
 * The meeting experience for people without a WickyChat account (guest link).
 * No session cookie: requests carry a per-guest token instead, and the waiting
 * room is polled because guests have no realtime connection.
 */
import type { GuestJoinResult, PublicMeetingPreview } from '@quid/shared'
import { Button, Input, QuidWordmark, Spinner, toast } from '@quid/ui'
import {
  Captions,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Presentation,
  Video,
  VideoOff,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage } from '@/lib/api'
import { CaptionOverlay } from './captions'
import { CircleButton, DeviceMenu, type MediaPrefs, PreJoin } from './meeting-room'
import { ChatPanel } from './side-panel'
import { Stage } from './stage'
import { useMeetingRoom } from './use-meeting-room'

type Phase = 'loading' | 'missing' | 'lobby' | 'requesting' | 'waiting' | 'denied' | 'in' | 'gone'
type Guest = { guestId: string; guestToken: string }

async function call<T>(path: string, init: { body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.body !== undefined || init.token ? 'POST' : 'GET',
    headers: {
      ...(init.body !== undefined && { 'content-type': 'application/json' }),
      ...(init.token && { 'x-guest-token': init.token }),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok)
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'error',
      json?.error?.message ?? 'Request failed',
    )
  return json as T
}

const storeKey = (code: string) => `quid-guest:${code}`

export function GuestMeeting({ code }: { code: string }) {
  const room = useMeetingRoom()
  const [phase, setPhase] = useState<Phase>('loading')
  const [preview, setPreview] = useState<PublicMeetingPreview | null>(null)
  const [name, setName] = useState('')
  const [panel, setPanel] = useState(false)
  const [layout, setLayout] = useState<'gallery' | 'speaker'>('gallery')
  const [pinned, setPinned] = useState<string | null>(null)
  const [showCaptions, setShowCaptions] = useState(true)
  const [gone, setGone] = useState<'left' | 'removed' | 'ended'>('left')
  const guest = useRef<Guest | null>(null)
  const prefs = useRef<MediaPrefs>({ mic: true, camera: true })
  const base = `/api/public/meetings/${code}`

  useEffect(() => {
    call<PublicMeetingPreview>(base)
      .then((p) => {
        setPreview(p)
        setPhase('lobby')
        document.title = `${p.title} · WickyChat Meet`
      })
      .catch(() => setPhase('missing'))
    try {
      const saved = sessionStorage.getItem(storeKey(code))
      if (saved) guest.current = JSON.parse(saved) as Guest
    } catch {}
  }, [base, code])

  useEffect(() => {
    room.setChatOpen(panel)
  }, [panel, room.setChatOpen])

  const tryJoin = useCallback(async () => {
    const g = guest.current
    if (!g) return
    const r = await call<GuestJoinResult>(`${base}/guests/${g.guestId}/join`, {
      token: g.guestToken,
    })
    if (r.status !== 'joined') {
      if (r.status === 'waiting') setPhase('waiting')
      else if (r.status === 'denied') setPhase('denied')
      else {
        setGone(r.status === 'removed' ? 'removed' : 'ended')
        setPhase('gone')
      }
      return
    }
    await room.connect(r.url, r.token, prefs.current)
    setPhase('in')
  }, [base, room.connect])

  // While waiting, ask every two seconds whether we've been let in.
  useEffect(() => {
    if (phase !== 'waiting') return
    const t = setInterval(() => void tryJoin().catch(() => {}), 2000)
    return () => clearInterval(t)
  }, [phase, tryJoin])

  useEffect(() => {
    if (phase === 'in' && room.endReason) {
      setGone(
        room.endReason === 'removed' ? 'removed' : room.endReason === 'ended' ? 'ended' : 'left',
      )
      setPhase('gone')
    }
  }, [phase, room.endReason])

  const leave = useCallback(async () => {
    const g = guest.current
    await room.disconnect()
    if (g) await call(`${base}/guests/${g.guestId}/leave`, { token: g.guestToken }).catch(() => {})
    try {
      sessionStorage.removeItem(storeKey(code))
    } catch {}
    guest.current = null
    setGone('left')
    setPhase('gone')
  }, [base, code, room.disconnect])

  useEffect(() => {
    if (phase !== 'in' && phase !== 'waiting') return
    const onHide = () => {
      const g = guest.current
      if (!g) return
      void fetch(`${base}/guests/${g.guestId}/leave`, {
        method: 'POST',
        keepalive: true,
        headers: { 'x-guest-token': g.guestToken },
      })
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [phase, base])

  const shell = (children: React.ReactNode) => (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-5">
        <QuidWordmark />
        {preview && <span className="text-xs text-fg-subtle">{preview.orgName}</span>}
      </header>
      {children}
    </div>
  )
  const center = (title: string, body?: string, action?: React.ReactNode) =>
    shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        {body && <p className="max-w-sm text-[13px] text-fg-muted">{body}</p>}
        {action}
      </div>,
    )

  if (phase === 'loading')
    return shell(
      <div className="flex flex-1 items-center justify-center text-fg-subtle">
        <Spinner className="size-5" />
      </div>,
    )
  if (phase === 'missing')
    return center(
      'This meeting link isn’t available',
      'The link may be wrong, or the host may not allow guests. Ask the person who invited you for a new link.',
    )
  if (phase === 'denied')
    return center(
      "You weren't let in",
      'Someone in the meeting declined your request to join.',
      <Button
        onClick={() => {
          guest.current = null
          setPhase('lobby')
        }}
      >
        Back
      </Button>,
    )
  if (phase === 'gone') {
    return center(
      gone === 'removed'
        ? 'You were removed from the meeting'
        : gone === 'ended'
          ? 'The meeting has ended'
          : 'You left the meeting',
      'You can close this tab.',
      gone === 'left' ? (
        <Button variant="primary" onClick={() => setPhase('lobby')}>
          Rejoin
        </Button>
      ) : undefined,
    )
  }
  if (phase === 'waiting') {
    return center(
      'Waiting for the host to let you in',
      `${preview?.hostName ?? 'The host'} has been told you're here. This page updates by itself.`,
      <div className="flex flex-col items-center gap-3">
        <Spinner className="size-5 text-fg-subtle" />
        <Button onClick={() => void leave()}>Cancel</Button>
      </div>,
    )
  }

  if (phase === 'lobby' || phase === 'requesting') {
    const trimmed = name.trim()
    return shell(
      <PreJoin
        title={preview?.title ?? 'Meeting'}
        subtitle={`${preview?.orgName}${preview?.hostName ? ` · hosted by ${preview.hostName}` : ''}`}
        person={{ name: trimmed || 'Guest', id: 'guest' }}
        joinLabel="Ask to join"
        busy={phase === 'requesting'}
        canJoin={trimmed.length > 0}
        onJoin={async (p) => {
          prefs.current = p
          setPhase('requesting')
          try {
            if (!guest.current) {
              guest.current = await call<Guest>(`${base}/guests`, { body: { name: trimmed } })
              try {
                sessionStorage.setItem(storeKey(code), JSON.stringify(guest.current))
              } catch {}
            }
            await tryJoin()
          } catch (e) {
            toast.error("Couldn't join", { description: errorMessage(e) })
            setPhase('lobby')
          }
        }}
        footer={
          <p className="mt-3 text-xs text-fg-subtle">
            You'll join as a guest. The host sees your name and lets you in.
          </p>
        }
      >
        <div className="mt-5 text-left">
          <label htmlFor="guest-name" className="mb-1.5 block text-[13px] font-medium">
            Your name
          </label>
          <Input
            id="guest-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Jane Doe"
            autoFocus
          />
        </div>
      </PreJoin>,
    )
  }

  // In the meeting
  const someoneSharing = room.tiles.some((t) => t.kind === 'screen' && !t.isLocal)
  return (
    <div className="flex h-dvh bg-[#111113] text-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 px-4">
          <h1 className="truncate text-[14px] font-semibold">{preview?.title}</h1>
          <span className="text-xs text-white/50">{preview?.orgName} · joined as a guest</span>
          {room.recordingBy && (
            <span
              className="flex items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-0.5 text-xs font-semibold text-red-300"
              role="status"
            >
              <span className="size-2 animate-pulse rounded-full bg-danger" /> Recording by{' '}
              {room.recordingBy.name}
            </span>
          )}
        </header>
        <div className="relative min-h-0 flex-1">
          <Stage tiles={room.tiles} layout={layout} pinned={pinned} onPin={setPinned} />
          {showCaptions && <CaptionOverlay captions={room.captions} />}
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
            label={room.sharing ? 'Stop sharing' : 'Share screen'}
            onClick={() => {
              if (someoneSharing && !room.sharing)
                return toast.info('Someone is already presenting.')
              void room.toggle('screen').catch(() => {})
            }}
          >
            {room.sharing ? <MonitorX className="text-warning" /> : <MonitorUp />}
          </CircleButton>
          <CircleButton
            label={showCaptions ? 'Hide captions' : 'Show captions'}
            onClick={() => setShowCaptions((v) => !v)}
          >
            <Captions className={showCaptions ? 'text-accent-text' : undefined} />
          </CircleButton>
          <CircleButton
            label={layout === 'gallery' ? 'Speaker view' : 'Gallery view'}
            onClick={() => setLayout((l) => (l === 'gallery' ? 'speaker' : 'gallery'))}
          >
            {layout === 'gallery' ? <Presentation /> : <LayoutGrid />}
          </CircleButton>
          <CircleButton
            label="Chat"
            onClick={() => setPanel((p) => !p)}
            badge={panel ? 0 : room.unread}
          >
            <MessageSquare />
          </CircleButton>
          <button
            type="button"
            onClick={() => void leave()}
            className="ml-2 flex h-11 items-center gap-1.5 rounded-full bg-danger px-5 text-[13px] font-semibold hover:opacity-90"
          >
            <PhoneOff className="size-5" /> Leave
          </button>
        </footer>
      </div>
      {panel && (
        <div className="fixed inset-0 z-40 flex w-full flex-col bg-bg text-fg md:static md:w-80 md:border-l md:border-border">
          <ChatPanel room={room} onClose={() => setPanel(false)} />
        </div>
      )}
      <div ref={room.audioBox} hidden aria-hidden="true" />
    </div>
  )
}
