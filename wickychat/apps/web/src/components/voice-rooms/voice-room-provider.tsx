'use client'
/**
 * Persistent channel voice rooms in the browser. Audio only, one room at a time,
 * and only one live session overall (see lib/session.ts).
 */
import type { VoiceRoom, VoiceRoomJoinInfo } from '@quid/shared'
import { toast } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { type RemoteParticipant, type RemoteTrack, Room, RoomEvent, Track } from 'livekit-client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { patch as apiPatch, errorMessage, get, post } from '@/lib/api'
import { useSounds } from '@/lib/expressions'
import { getPreferences } from '@/lib/preferences'
import { onVoiceRoomEvent } from '@/lib/realtime'
import { claimSession, releaseSession } from '@/lib/session'
import { type BoardSound, BUILTIN_SOUNDS, playSound, toBoardSound } from '@/lib/soundboard'
import { useOrgContext } from '../org-context'
import { VoiceRoomBar } from './voice-room-bar'

export interface RoomSession {
  room: VoiceRoom
  connecting: boolean
  micOn: boolean
  canSpeak: boolean
  speaking: string[]
  mutedUsers: string[]
  /** The most recent soundboard sound, shown briefly in the bar. */
  lastSound: { userId: string; sound: BoardSound; key: number } | null
}

const SOUNDBOARD_TOPIC = 'quid.soundboard'
/** Per person, so nobody can spam a room. */
const SOUND_COOLDOWN_MS = 1500

interface Ctx {
  activeRooms: VoiceRoom[]
  session: RoomSession | null
  join: (channelId: string) => Promise<void>
  leave: () => Promise<void>
  toggleMic: () => Promise<void>
  setHand: (raised: boolean) => Promise<void>
  moderate: (action: 'mute' | 'remove' | 'speaker' | 'listener', userId: string) => Promise<void>
  setMode: (mode: 'open' | 'stage') => Promise<void>
  /** Built-in sounds plus the org's own. */
  sounds: BoardSound[]
  playBoardSound: (sound: BoardSound) => void
  soundCooldownUntil: number
}

const VoiceRoomCtx = createContext<Ctx | null>(null)

export function useVoiceRooms() {
  const v = useContext(VoiceRoomCtx)
  if (!v) throw new Error('useVoiceRooms must be used inside VoiceRoomProvider')
  return v
}

export function VoiceRoomProvider({ children }: { children: React.ReactNode }) {
  const { org, api, me } = useOrgContext()
  const active = useQuery({
    queryKey: ['voice-rooms', org.id],
    queryFn: ({ signal }) => get<VoiceRoom[]>(`${api}/voice-rooms`, signal),
  })
  const [session, setSession] = useState<RoomSession | null>(null)
  const orgSounds = useSounds()
  const sounds = useMemo(
    () => [...BUILTIN_SOUNDS, ...(orgSounds.data ?? []).map(toBoardSound)],
    [orgSounds.data],
  )
  const soundsRef = useRef(sounds)
  soundsRef.current = sounds
  const lastHeard = useRef(new Map<string, number>())
  const [soundCooldownUntil, setSoundCooldownUntil] = useState(0)
  const lkRef = useRef<Room | null>(null)
  const audioBox = useRef<HTMLDivElement>(null)
  const roomIdRef = useRef<string | null>(null)
  const patch = useCallback(
    (p: Partial<RoomSession>) => setSession((s) => (s ? { ...s, ...p } : s)),
    [],
  )

  const teardown = useCallback(async () => {
    releaseSession('voice-room')
    const lk = lkRef.current
    lkRef.current = null
    roomIdRef.current = null
    if (lk) await lk.disconnect()
    if (audioBox.current) audioBox.current.innerHTML = ''
    setSession(null)
  }, [])

  const leave = useCallback(async () => {
    const id = roomIdRef.current
    await teardown()
    if (id) await post(`${api}/voice-rooms/${id}/leave`).catch(() => {})
  }, [api, teardown])

  const join = useCallback(
    async (channelId: string) => {
      if (session?.room.channelId === channelId) return
      if (session) await leave()
      let info: VoiceRoomJoinInfo
      try {
        info = await post<VoiceRoomJoinInfo>(`${api}/channels/${channelId}/voice-room/join`)
      } catch (e) {
        toast.error("Couldn't join the voice room", { description: errorMessage(e) })
        return
      }
      await claimSession('voice-room', leave)
      roomIdRef.current = info.room.id
      const canSpeak = info.room.participants.find((p) => p.user.id === me.id)?.role !== 'listener'
      setSession({
        room: info.room,
        connecting: true,
        micOn: false,
        canSpeak,
        speaking: [],
        mutedUsers: [],
        lastSound: null,
      })

      const lk = new Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      lkRef.current = lk
      const sync = () => {
        const remotes = [...lk.remoteParticipants.values()]
        patch({
          micOn: lk.localParticipant.isMicrophoneEnabled,
          canSpeak: !!lk.localParticipant.permissions?.canPublish,
          mutedUsers: [
            ...(lk.localParticipant.isMicrophoneEnabled ? [] : [me.id]),
            ...remotes.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity),
          ],
        })
      }
      lk.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return
        const el = track.attach()
        audioBox.current?.appendChild(el)
      })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          for (const el of track.detach()) el.remove()
        })
        .on(RoomEvent.ActiveSpeakersChanged, (s) => patch({ speaking: s.map((p) => p.identity) }))
        .on(
          RoomEvent.DataReceived,
          (payload: Uint8Array, from?: RemoteParticipant, _kind?: unknown, topic?: string) => {
            if (topic !== SOUNDBOARD_TOPIC || !from) return
            const now = Date.now()
            if (now - (lastHeard.current.get(from.identity) ?? 0) < SOUND_COOLDOWN_MS) return
            let id: unknown
            try {
              id = JSON.parse(new TextDecoder().decode(payload)).id
            } catch {
              return
            }
            const sound = soundsRef.current.find((s) => s.id === id)
            if (!sound) return
            lastHeard.current.set(from.identity, now)
            const prefs = getPreferences()
            if (prefs.soundboard) playSound(sound, prefs.soundboardVolume)
            patch({ lastSound: { userId: from.identity, sound, key: now } })
          },
        )
        .on(RoomEvent.ParticipantPermissionsChanged, sync)
        .on(RoomEvent.TrackMuted, sync)
        .on(RoomEvent.TrackUnmuted, sync)
        .on(RoomEvent.LocalTrackPublished, sync)
        .on(RoomEvent.LocalTrackUnpublished, sync)
        .on(RoomEvent.ParticipantConnected, sync)
        .on(RoomEvent.ParticipantDisconnected, sync)
        .on(RoomEvent.Disconnected, () => {
          if (lkRef.current === lk) void leave()
        })
      try {
        await lk.connect(info.url, info.token)
      } catch (e) {
        await leave()
        toast.error("Couldn't connect to the voice room", { description: errorMessage(e) })
        return
      }
      // Speakers join muted; they unmute when they want to talk.
      patch({ connecting: false })
      sync()
    },
    [api, me.id, patch, session, leave],
  )

  const toggleMic = useCallback(async () => {
    const lk = lkRef.current
    if (!lk) return
    try {
      await lk.localParticipant.setMicrophoneEnabled(!lk.localParticipant.isMicrophoneEnabled)
      patch({ micOn: lk.localParticipant.isMicrophoneEnabled })
    } catch (e) {
      toast.error('Microphone unavailable', { description: errorMessage(e) })
    }
  }, [patch])

  const setHand = useCallback(
    async (raised: boolean) => {
      if (!roomIdRef.current) return
      await post(`${api}/voice-rooms/${roomIdRef.current}/hand`, { raised }).catch((e) =>
        toast.error(errorMessage(e)),
      )
    },
    [api],
  )

  const moderate = useCallback(
    async (action: 'mute' | 'remove' | 'speaker' | 'listener', userId: string) => {
      const id = roomIdRef.current
      if (!id) return
      try {
        if (action === 'speaker' || action === 'listener')
          await post(`${api}/voice-rooms/${id}/role`, { userId, role: action })
        else await post(`${api}/voice-rooms/${id}/${action}`, { userId })
      } catch (e) {
        toast.error(errorMessage(e))
      }
    },
    [api],
  )

  const setMode = useCallback(
    async (mode: 'open' | 'stage') => {
      const id = roomIdRef.current
      if (!id) return
      await apiPatch(`${api}/voice-rooms/${id}`, { mode }).catch((e) =>
        toast.error(errorMessage(e)),
      )
    },
    [api],
  )

  const playBoardSound = useCallback(
    (sound: BoardSound) => {
      const lk = lkRef.current
      if (!lk || Date.now() < soundCooldownUntil) return
      const now = Date.now()
      setSoundCooldownUntil(now + SOUND_COOLDOWN_MS)
      playSound(sound, getPreferences().soundboardVolume)
      patch({ lastSound: { userId: me.id, sound, key: now } })
      void lk.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify({ id: sound.id })), {
          reliable: true,
          topic: SOUNDBOARD_TOPIC,
        })
        .catch(() => toast.error("Couldn't play that sound for the room"))
    },
    [me.id, patch, soundCooldownUntil],
  )

  // Keep the joined room's state live; moderator rights stay as computed by the server at join.
  useEffect(
    () =>
      onVoiceRoomEvent((e) => {
        if (e.orgId !== org.id) return
        setSession((s) => {
          if (!s || s.room.id !== e.room.id) return s
          if (!e.room.participants.some((p) => p.user.id === me.id)) {
            void teardown()
            return s
          }
          return { ...s, room: { ...e.room, canModerate: s.room.canModerate } }
        })
      }),
    [org.id, me.id, teardown],
  )

  useEffect(() => {
    const id = session?.room.id
    if (!id) return
    const onHide = () => navigator.sendBeacon?.(`${api}/voice-rooms/${id}/leave`)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [api, session?.room.id])

  useEffect(() => () => void lkRef.current?.disconnect(), [])

  const value = useMemo<Ctx>(
    () => ({
      activeRooms: active.data ?? [],
      session,
      join,
      leave,
      toggleMic,
      setHand,
      moderate,
      setMode,
      sounds,
      playBoardSound,
      soundCooldownUntil,
    }),
    [
      active.data,
      session,
      join,
      leave,
      toggleMic,
      setHand,
      moderate,
      setMode,
      sounds,
      playBoardSound,
      soundCooldownUntil,
    ],
  )

  return (
    <VoiceRoomCtx.Provider value={value}>
      {children}
      <div ref={audioBox} hidden aria-hidden="true" />
      {session && <VoiceRoomBar />}
    </VoiceRoomCtx.Provider>
  )
}
