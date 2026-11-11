'use client'
/**
 * WickyChat Voice in the browser. One call at a time per tab.
 *
 * Call state (ringing, who joined, ended) comes from the WickyChat API and realtime
 * events; audio flows through LiveKit using a short-lived token the API issues
 * after checking access.
 */
import type { Call, CallJoinInfo, MediaStatus } from '@quid/shared'
import { toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type RemoteTrack, Room, RoomEvent, Track } from 'livekit-client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage, get, post } from '@/lib/api'
import { onCallEvent } from '@/lib/realtime'
import { claimSession, releaseSession } from '@/lib/session'
import { useOrgContext } from '../org-context'
import { CallBar } from './call-bar'
import { IncomingCall } from './incoming-call'
import { Ringer } from './ringer'

export interface CallState {
  call: Call
  room: Room | null
  connecting: boolean
  muted: boolean
  /** Participant identities (user ids) currently speaking. */
  speaking: string[]
  /** User ids whose microphone is muted. */
  mutedUsers: string[]
  /** User ids actually connected to the media room. */
  connected: string[]
  needsAudioUnlock: boolean
}

interface CallContextValue {
  available: boolean
  current: CallState | null
  incoming: Call | null
  activeCalls: Call[]
  start: (channelId: string) => Promise<void>
  join: (callId: string) => Promise<void>
  decline: (callId: string) => Promise<void>
  leave: () => Promise<void>
  toggleMute: () => Promise<void>
  switchDevice: (kind: 'audioinput' | 'audiooutput', deviceId: string) => Promise<void>
  unlockAudio: () => Promise<void>
}

const Ctx = createContext<CallContextValue | null>(null)

export function useCalls() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCalls must be used inside CallProvider')
  return v
}

const ongoing = (c: Call) => c.status === 'ringing' || c.status === 'active'

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const media = useQuery({
    queryKey: ['media-status'],
    queryFn: ({ signal }) => get<MediaStatus>('/api/media/status', signal),
    staleTime: 5 * 60_000,
  })
  const active = useQuery({
    queryKey: ['calls-active', org.id],
    queryFn: ({ signal }) => get<Call[]>(`${api}/calls/active`, signal),
  })
  const [current, setCurrent] = useState<CallState | null>(null)
  const [incoming, setIncoming] = useState<Call | null>(null)
  const roomRef = useRef<Room | null>(null)
  const audioBox = useRef<HTMLDivElement>(null)
  const patch = useCallback(
    (p: Partial<CallState>) => setCurrent((c) => (c ? { ...c, ...p } : c)),
    [],
  )

  const teardown = useCallback(async () => {
    releaseSession('call')
    const room = roomRef.current
    roomRef.current = null
    if (room) await room.disconnect()
    if (audioBox.current) audioBox.current.innerHTML = ''
    setCurrent(null)
  }, [])

  const connect = useCallback(
    async (info: CallJoinInfo) => {
      await teardown()
      await claimSession('call', async () => {
        await post(`${api}/calls/${info.call.id}/leave`).catch(() => {})
        await teardown()
      })
      setIncoming(null)
      setCurrent({
        call: info.call,
        room: null,
        connecting: true,
        muted: false,
        speaking: [],
        mutedUsers: [],
        connected: [me.id],
        needsAudioUnlock: false,
      })
      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      roomRef.current = room

      const syncParticipants = () => {
        const remotes = [...room.remoteParticipants.values()]
        patch({
          connected: [me.id, ...remotes.map((p) => p.identity)],
          mutedUsers: [
            ...(room.localParticipant.isMicrophoneEnabled ? [] : [me.id]),
            ...remotes.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity),
          ],
        })
      }

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind !== Track.Kind.Audio) return
          const el = track.attach()
          el.dataset.quid = 'call-audio'
          audioBox.current?.appendChild(el)
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          for (const el of track.detach()) el.remove()
        })
        .on(RoomEvent.ActiveSpeakersChanged, (speakers) =>
          patch({ speaking: speakers.map((s) => s.identity) }),
        )
        .on(RoomEvent.ParticipantConnected, syncParticipants)
        .on(RoomEvent.ParticipantDisconnected, syncParticipants)
        .on(RoomEvent.TrackMuted, syncParticipants)
        .on(RoomEvent.TrackUnmuted, syncParticipants)
        .on(RoomEvent.AudioPlaybackStatusChanged, () =>
          patch({ needsAudioUnlock: !room.canPlaybackAudio }),
        )
        .on(RoomEvent.Disconnected, () => {
          if (roomRef.current === room) {
            void post(`${api}/calls/${info.call.id}/leave`).catch(() => {})
            void teardown()
          }
        })

      try {
        await room.connect(info.url, info.token)
      } catch (e) {
        await post(`${api}/calls/${info.call.id}/leave`).catch(() => {})
        await teardown()
        toast.error("Couldn't connect the call", { description: errorMessage(e) })
        return
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(true)
      } catch {
        toast.error('Microphone unavailable', {
          description: 'Allow microphone access in your browser to talk. You can still listen.',
        })
      }
      patch({
        room,
        connecting: false,
        muted: !room.localParticipant.isMicrophoneEnabled,
        needsAudioUnlock: !room.canPlaybackAudio,
      })
      syncParticipants()
    },
    [api, me.id, patch, teardown],
  )

  const start = useCallback(
    async (channelId: string) => {
      if (current) {
        toast.info("You're already in a call. Leave it first.")
        return
      }
      try {
        await connect(await post<CallJoinInfo>(`${api}/channels/${channelId}/calls`))
      } catch (e) {
        toast.error("Couldn't start the call", { description: errorMessage(e) })
      }
    },
    [api, connect, current],
  )

  const join = useCallback(
    async (callId: string) => {
      if (current?.call.id === callId) return
      if (current) await post(`${api}/calls/${current.call.id}/leave`).catch(() => {})
      try {
        await connect(await post<CallJoinInfo>(`${api}/calls/${callId}/join`))
      } catch (e) {
        setIncoming(null)
        toast.error("Couldn't join the call", { description: errorMessage(e) })
      }
    },
    [api, connect, current],
  )

  const decline = useCallback(
    async (callId: string) => {
      setIncoming(null)
      await post(`${api}/calls/${callId}/decline`).catch(() => {})
    },
    [api],
  )

  const leave = useCallback(async () => {
    const id = current?.call.id
    await teardown()
    if (id) await post(`${api}/calls/${id}/leave`).catch(() => {})
    void qc.invalidateQueries({ queryKey: ['calls-history', org.id] })
  }, [api, current?.call.id, org.id, qc, teardown])

  const toggleMute = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const enabled = room.localParticipant.isMicrophoneEnabled
    try {
      await room.localParticipant.setMicrophoneEnabled(!enabled)
      patch({ muted: enabled })
      setCurrent((c) =>
        c
          ? {
              ...c,
              mutedUsers: enabled
                ? [...new Set([...c.mutedUsers, me.id])]
                : c.mutedUsers.filter((u) => u !== me.id),
            }
          : c,
      )
    } catch (e) {
      toast.error('Microphone unavailable', { description: errorMessage(e) })
    }
  }, [me.id, patch])

  const switchDevice = useCallback(async (kind: 'audioinput' | 'audiooutput', deviceId: string) => {
    try {
      await roomRef.current?.switchActiveDevice(kind, deviceId)
    } catch (e) {
      toast.error("Couldn't switch device", { description: errorMessage(e) })
    }
  }, [])

  const unlockAudio = useCallback(async () => {
    await roomRef.current?.startAudio()
    patch({ needsAudioUnlock: false })
  }, [patch])

  // Realtime: incoming calls and state changes for the current call.
  useEffect(
    () =>
      onCallEvent((e) => {
        if (e.orgId !== org.id) return
        const call = e.call
        if (e.type === 'call.ringing' && call.startedBy?.id !== me.id && ongoing(call)) {
          setIncoming((cur) => cur ?? call)
          return
        }
        setIncoming((cur) => {
          if (cur?.id !== call.id) return cur
          const mine = call.participants.find((p) => p.user.id === me.id)
          return call.status === 'ringing' && mine?.status === 'invited' ? call : null
        })
        setCurrent((cur) => (cur && cur.call.id === call.id ? { ...cur, call } : cur))
        if (!ongoing(call) && roomRef.current && current?.call.id === call.id) void teardown()
        if (!ongoing(call)) void qc.invalidateQueries({ queryKey: ['calls-history', org.id] })
      }),
    [org.id, me.id, teardown, current?.call.id, qc],
  )

  // Leave cleanly when the tab closes.
  useEffect(() => {
    const id = current?.call.id
    if (!id) return
    const onUnload = () => navigator.sendBeacon?.(`${api}/calls/${id}/leave`)
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [api, current?.call.id])

  // An incoming call that was already ringing before this page loaded.
  useEffect(() => {
    if (incoming || current || !active.data) return
    const ringing = active.data.find(
      (c) =>
        c.status === 'ringing' &&
        c.startedBy?.id !== me.id &&
        c.participants.some((p) => p.user.id === me.id && p.status === 'invited'),
    )
    if (ringing) setIncoming(ringing)
  }, [active.data, incoming, current, me.id])

  useEffect(() => () => void roomRef.current?.disconnect(), [])

  const value = useMemo<CallContextValue>(
    () => ({
      available: !!media.data?.voice.available,
      current,
      incoming,
      activeCalls: active.data ?? [],
      start,
      join,
      decline,
      leave,
      toggleMute,
      switchDevice,
      unlockAudio,
    }),
    [
      media.data,
      current,
      incoming,
      active.data,
      start,
      join,
      decline,
      leave,
      toggleMute,
      switchDevice,
      unlockAudio,
    ],
  )

  const outgoingRinging = current?.call.status === 'ringing' && !current.connecting
  return (
    <Ctx.Provider value={value}>
      {children}
      <div ref={audioBox} hidden aria-hidden="true" />
      {incoming && <IncomingCall call={incoming} />}
      {current && <CallBar state={current} />}
      <Ringer mode={incoming ? 'incoming' : outgoingRinging ? 'outgoing' : null} />
    </Ctx.Provider>
  )
}
