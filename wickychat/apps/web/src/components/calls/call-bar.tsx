'use client'
import type { Meeting } from '@quid/shared'
import {
  Avatar,
  cn,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
  toast,
} from '@quid/ui'
import { Room } from 'livekit-client'
import { Mic, MicOff, PhoneOff, Settings2, Video, Volume2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { errorMessage, post } from '@/lib/api'
import { channelTitle } from '@/lib/channels'
import { displayName } from '@/lib/format'
import { useChannels } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { type CallState, useCalls } from './call-provider'

function useDuration(since: string | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!since) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [since])
  if (!since) return null
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function DeviceMenu() {
  const { switchDevice } = useCalls()
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const load = async () => {
    setInputs(await Room.getLocalDevices('audioinput', false).catch(() => []))
    setOutputs(await Room.getLocalDevices('audiooutput', false).catch(() => []))
  }
  return (
    <Menu onOpenChange={(o) => o && void load()}>
      <Tooltip content="Audio devices">
        <MenuTrigger asChild>
          <IconButton label="Audio devices" className="size-9 rounded-full">
            <Settings2 />
          </IconButton>
        </MenuTrigger>
      </Tooltip>
      <MenuContent side="top" align="start" className="w-72">
        <MenuLabel>Microphone</MenuLabel>
        {inputs.length ? (
          inputs.map((d) => (
            <MenuItem
              key={d.deviceId || 'default'}
              icon={<Mic />}
              onSelect={() => void switchDevice('audioinput', d.deviceId)}
            >
              {d.label || 'Microphone'}
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled>No microphones found</MenuItem>
        )}
        <MenuSeparator />
        <MenuLabel>Speaker</MenuLabel>
        {outputs.length ? (
          outputs.map((d) => (
            <MenuItem
              key={d.deviceId || 'default'}
              icon={<Volume2 />}
              onSelect={() => void switchDevice('audiooutput', d.deviceId)}
            >
              {d.label || 'Speaker'}
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled>Your browser picks the speaker</MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}

export function CallBar({ state }: { state: CallState }) {
  const { org, me, base, api } = useOrgContext()
  const { leave, toggleMute, unlockAudio } = useCalls()
  const router = useRouter()
  const channels = useChannels(org.id)
  const { call } = state
  const channel = channels.data?.find((c) => c.id === call.channelId)
  const title = channel
    ? channel.kind === 'public' || channel.kind === 'private'
      ? `#${channel.name}`
      : channelTitle(channel, me.id)
    : 'Call'
  const duration = useDuration(call.status === 'active' ? call.answeredAt : null)
  const others = call.participants.filter((p) => p.user.id !== me.id)
  const inCall = call.participants.filter((p) => p.status === 'joined' || p.user.id === me.id)
  const status = state.connecting
    ? 'Connecting…'
    : call.status === 'ringing'
      ? `Calling ${others.map((p) => displayName(p.user).split(' ')[0]).join(', ') || '…'}`
      : (duration ?? 'Connected')

  return (
    <section
      aria-label="Current call"
      className="fixed inset-x-2 bottom-16 z-[55] animate-in rounded-xl border border-border bg-bg-overlay p-3 shadow-dialog md:right-auto md:bottom-4 md:left-[80px] md:w-[300px]"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            call.status === 'active' ? 'bg-success' : 'animate-pulse bg-warning',
          )}
        />
        <div className="min-w-0 flex-1">
          {channel ? (
            <Link
              href={`${base}/c/${channel.id}`}
              className="block truncate text-[13px] font-semibold hover:underline"
            >
              {title}
            </Link>
          ) : (
            <p className="truncate text-[13px] font-semibold">{title}</p>
          )}
          <p className="text-xs text-fg-muted tabular-nums" aria-live="polite">
            {status}
          </p>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Participants">
        {inCall.map((p) => {
          const speaking = state.speaking.includes(p.user.id)
          const muted = state.mutedUsers.includes(p.user.id)
          const present = state.connected.includes(p.user.id)
          return (
            <li key={p.user.id}>
              <Tooltip
                content={`${displayName(p.user)}${p.user.id === me.id ? ' (you)' : ''}${muted ? ' · muted' : speaking ? ' · speaking' : !present ? ' · connecting' : ''}`}
              >
                <span
                  className={cn(
                    'relative block rounded-lg ring-2 ring-transparent transition-shadow',
                    speaking && 'ring-success',
                    !present && 'opacity-50',
                  )}
                >
                  <Avatar
                    name={p.user.name}
                    id={p.user.id}
                    src={p.user.avatarUrl}
                    decoration={p.user.decoration}
                    size="md"
                  />
                  {muted && (
                    <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-danger text-white ring-2 ring-bg-overlay">
                      <MicOff className="size-2.5" />
                    </span>
                  )}
                </span>
              </Tooltip>
            </li>
          )
        })}
      </ul>

      {state.needsAudioUnlock && (
        <button
          type="button"
          onClick={() => void unlockAudio()}
          className="mt-3 w-full rounded-md bg-warning/15 px-2 py-1.5 text-xs font-medium text-warning"
        >
          Click to enable call audio
        </button>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        <Tooltip content={state.muted ? 'Unmute' : 'Mute'}>
          <button
            type="button"
            aria-pressed={state.muted}
            aria-label={state.muted ? 'Unmute microphone' : 'Mute microphone'}
            onClick={() => void toggleMute()}
            disabled={state.connecting}
            className={cn(
              'flex size-9 items-center justify-center rounded-full border border-border transition-colors disabled:opacity-50',
              state.muted ? 'border-danger/40 bg-danger-subtle text-danger' : 'hover:bg-bg-muted',
            )}
          >
            {state.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
        </Tooltip>
        <DeviceMenu />
        <Tooltip content="Move to a video meeting">
          <button
            type="button"
            aria-label="Move to a video meeting"
            disabled={state.connecting}
            onClick={async () => {
              try {
                const m = await post<Meeting>(`${api}/calls/${call.id}/upgrade`)
                await leave()
                router.push(`${base}/meet/${m.code}`)
              } catch (e) {
                toast.error(errorMessage(e))
              }
            }}
            className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-bg-muted disabled:opacity-50"
          >
            <Video className="size-4" />
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={() => void leave()}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-full bg-danger px-4 text-[13px] font-medium text-white hover:opacity-90"
        >
          <PhoneOff className="size-4" /> Leave
        </button>
      </div>
    </section>
  )
}
