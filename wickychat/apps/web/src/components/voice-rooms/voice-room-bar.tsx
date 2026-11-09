'use client'
import type { VoiceRoomParticipant } from '@quid/shared'
import {
  Avatar,
  Badge,
  cn,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@quid/ui'
import {
  AudioLines,
  Hand,
  Headphones,
  Mic,
  MicOff,
  MoreHorizontal,
  PhoneOff,
  Plus,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { displayName } from '@/lib/format'
import { useOrgContext } from '../org-context'
import { useVoiceRooms } from './voice-room-provider'

function Soundboard() {
  const { base, org } = useOrgContext()
  const { sounds, playBoardSound, soundCooldownUntil } = useVoiceRooms()
  const [, tick] = useState(0)
  const cooling = Date.now() < soundCooldownUntil
  useEffect(() => {
    if (!cooling) return
    const t = setTimeout(() => tick((n) => n + 1), soundCooldownUntil - Date.now() + 20)
    return () => clearTimeout(t)
  }, [cooling, soundCooldownUntil])
  return (
    <Popover>
      <Tooltip content="Soundboard">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Soundboard"
            className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-bg-muted"
          >
            <AudioLines className="size-4" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" align="start" className="w-72 p-2">
        <p className="px-1 pb-1.5 text-2xs font-medium text-fg-subtle uppercase">
          Soundboard · everyone hears it
        </p>
        <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto">
          {sounds.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={cooling}
              onClick={() => playBoardSound(s)}
              className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border px-2 text-left text-[13px] transition-[transform,background-color] hover:bg-bg-muted active:scale-95 disabled:opacity-50"
            >
              <span className="text-base leading-none">{s.emoji ?? '🔊'}</span>
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
        {org.role !== 'guest' && (
          <Link
            href={`${base}/settings/expressions`}
            className="mt-2 flex items-center gap-1.5 border-t border-border px-1 pt-2 text-xs text-fg-muted hover:text-fg"
          >
            <Plus className="size-3.5" /> Add your own sounds
          </Link>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** "Bea played 📯 Airhorn", for a few seconds. */
function LastSound() {
  const { session } = useVoiceRooms()
  const last = session?.lastSound
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!last) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 3000)
    return () => clearTimeout(t)
  }, [last])
  if (!last || !visible || !session) return null
  const who = session.room.participants.find((p) => p.user.id === last.userId)?.user
  return (
    <p
      key={last.key}
      role="status"
      className="mt-2 animate-in truncate rounded-md bg-bg-muted px-2 py-1 text-xs text-fg-muted"
    >
      {who ? displayName(who) : 'Someone'} played {last.sound.emoji ?? '🔊'} {last.sound.name}
    </p>
  )
}

function Person({
  p,
  speaking,
  muted,
}: {
  p: VoiceRoomParticipant
  speaking: boolean
  muted: boolean
}) {
  const { me } = useOrgContext()
  const { session, moderate } = useVoiceRooms()
  const mod = session?.room.canModerate && p.user.id !== me.id
  const stage = session?.room.mode === 'stage'
  const label = `${displayName(p.user)}${p.user.id === me.id ? ' (you)' : ''}${p.handRaised ? ' · hand raised' : ''}${speaking ? ' · speaking' : ''}`
  const avatar = (
    <span
      className={cn(
        'relative block rounded-lg ring-2 ring-transparent transition-shadow',
        speaking && 'ring-success',
      )}
    >
      <Avatar name={p.user.name} id={p.user.id} src={p.user.avatarUrl} size="md" />
      {p.handRaised && (
        <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-warning text-black ring-2 ring-bg-overlay">
          <Hand className="size-2.5" />
        </span>
      )}
      {muted && p.role === 'speaker' && (
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-bg-emphasis text-fg-muted ring-2 ring-bg-overlay">
          <MicOff className="size-2.5" />
        </span>
      )}
    </span>
  )
  if (!mod) {
    return (
      <Tooltip content={label}>
        <li>{avatar}</li>
      </Tooltip>
    )
  }
  return (
    <li>
      <Menu>
        <Tooltip content={label}>
          <MenuTrigger aria-label={`Manage ${p.user.name}`} className="rounded-lg outline-none">
            {avatar}
          </MenuTrigger>
        </Tooltip>
        <MenuContent side="top">
          <MenuLabel>{displayName(p.user)}</MenuLabel>
          {stage &&
            (p.role === 'listener' ? (
              <MenuItem onSelect={() => void moderate('speaker', p.user.id)}>
                Invite to speak
              </MenuItem>
            ) : (
              <MenuItem onSelect={() => void moderate('listener', p.user.id)}>
                Move to listeners
              </MenuItem>
            ))}
          {p.role === 'speaker' && (
            <MenuItem onSelect={() => void moderate('mute', p.user.id)}>Mute</MenuItem>
          )}
          <MenuSeparator />
          <MenuItem danger onSelect={() => void moderate('remove', p.user.id)}>
            Remove from room
          </MenuItem>
        </MenuContent>
      </Menu>
    </li>
  )
}

export function VoiceRoomBar() {
  const { base, me } = useOrgContext()
  const { session, leave, toggleMic, setHand, setMode } = useVoiceRooms()
  if (!session) return null
  const { room } = session
  const mine = room.participants.find((p) => p.user.id === me.id)
  const speakers = room.participants.filter((p) => p.role === 'speaker')
  const listeners = room.participants.filter((p) => p.role === 'listener')
  const hands = listeners.filter((p) => p.handRaised).length

  return (
    <section
      aria-label="Voice room"
      className="fixed inset-x-2 bottom-16 z-[55] animate-in rounded-xl border border-border bg-bg-overlay p-3 shadow-dialog md:right-auto md:bottom-4 md:left-[80px] md:w-[320px]"
    >
      <div className="flex items-center gap-2">
        <Headphones className="size-4 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <Link
            href={`${base}/c/${room.channelId}`}
            className="block truncate text-[13px] font-semibold hover:underline"
          >
            {room.name}
          </Link>
          <p className="text-xs text-fg-muted">
            {session.connecting ? 'Connecting…' : `${room.participants.length} in the room`}
            {room.mode === 'stage' && ' · Stage'}
          </p>
        </div>
        {room.canModerate && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="Room settings" size="sm">
                <MoreHorizontal />
              </IconButton>
            </MenuTrigger>
            <MenuContent side="top" align="end" className="w-64">
              <MenuLabel>Who can talk</MenuLabel>
              <MenuItem
                onSelect={() => void setMode('open')}
                shortcut={room.mode === 'open' ? '✓' : undefined}
              >
                Everyone
              </MenuItem>
              <MenuItem
                onSelect={() => void setMode('stage')}
                shortcut={room.mode === 'stage' ? '✓' : undefined}
              >
                Only speakers (stage)
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>

      <p className="mt-3 mb-1.5 text-2xs font-medium text-fg-subtle uppercase">
        {room.mode === 'stage' ? 'Speakers' : 'In the room'}
      </p>
      <ul className="flex flex-wrap gap-2">
        {speakers.map((p) => (
          <Person
            key={p.user.id}
            p={p}
            speaking={session.speaking.includes(p.user.id)}
            muted={session.mutedUsers.includes(p.user.id)}
          />
        ))}
      </ul>
      {room.mode === 'stage' && listeners.length > 0 && (
        <>
          <p className="mt-3 mb-1.5 flex items-center gap-1.5 text-2xs font-medium text-fg-subtle uppercase">
            Listeners {hands > 0 && <Badge tone="warning">{hands} ✋</Badge>}
          </p>
          <ul className="flex flex-wrap gap-2">
            {listeners.map((p) => (
              <Person key={p.user.id} p={p} speaking={false} muted />
            ))}
          </ul>
        </>
      )}

      <LastSound />

      <div className="mt-3 flex items-center gap-1.5">
        {session.canSpeak ? (
          <Tooltip content={session.micOn ? 'Mute' : 'Unmute to talk'}>
            <button
              type="button"
              aria-label={session.micOn ? 'Mute microphone' : 'Unmute microphone'}
              aria-pressed={!session.micOn}
              disabled={session.connecting}
              onClick={() => void toggleMic()}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors disabled:opacity-50',
                session.micOn
                  ? 'border-border hover:bg-bg-muted'
                  : 'border-danger/40 bg-danger-subtle text-danger',
              )}
            >
              {session.micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
              {session.micOn ? 'Live' : 'Muted'}
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            aria-pressed={!!mine?.handRaised}
            onClick={() => void setHand(!mine?.handRaised)}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-bg-muted',
              mine?.handRaised && 'border-warning/50 bg-warning/15 text-warning',
            )}
          >
            <Hand className="size-4" /> {mine?.handRaised ? 'Lower hand' : 'Raise hand'}
          </button>
        )}
        {!session.connecting && <Soundboard />}
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
