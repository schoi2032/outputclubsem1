'use client'
import { toast } from '@quid/ui'
/**
 * Owns the LiveKit connection for a meeting and exposes a render-friendly
 * snapshot. LiveKit objects are mutable, so we bump a version counter on every
 * relevant room event and derive the snapshot from the room each render.
 */
import {
  DisconnectReason,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  type TrackPublication,
  VideoPresets,
} from 'livekit-client'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ChatMessage {
  id: string
  fromId: string
  fromName: string
  text: string
  at: number
}

export type EndReason = 'left' | 'removed' | 'ended' | 'error'

export interface TileInfo {
  key: string
  participant: Participant
  isLocal: boolean
  /** Camera tile or a screen share tile. */
  kind: 'camera' | 'screen'
  publication: TrackPublication | undefined
  speaking: boolean
  micMuted: boolean
}

const CHAT_TOPIC = 'quid-chat'
const CAPTION_TOPIC = 'quid-captions'
export const RECORDING_TOPIC = 'quid-recording'

/** The latest caption line from each speaker who has captions on. */
export interface LiveCaption {
  speakerId: string
  name: string
  text: string
  final: boolean
  at: number
}
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function useMeetingRoom() {
  const roomRef = useRef<Room | null>(null)
  const [, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  const [connected, setConnected] = useState(false)
  const [endReason, setEndReason] = useState<EndReason | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [unread, setUnread] = useState(0)
  const [captions, setCaptions] = useState<Record<string, LiveCaption>>({})
  /** Who is recording, refreshed by a heartbeat so late joiners see it too. */
  const [recordingBy, setRecordingBy] = useState<{ name: string; at: number } | null>(null)
  const chatOpen = useRef(false)
  const audioBox = useRef<HTMLDivElement | null>(null)

  const attachAudio = useCallback((pub: TrackPublication, p: Participant) => {
    if (p.isLocal || pub.kind !== Track.Kind.Audio || !pub.track || !audioBox.current) return
    const el = pub.track.attach()
    el.dataset.quid = 'meet-audio'
    audioBox.current.appendChild(el)
  }, [])

  const connect = useCallback(
    async (
      url: string,
      token: string,
      opts: { mic: boolean; camera: boolean; micId?: string; cameraId?: string },
    ) => {
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        publishDefaults: { simulcast: true },
      })
      roomRef.current = room
      const events = [
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.ActiveSpeakersChanged,
        RoomEvent.ConnectionStateChanged,
        RoomEvent.TrackUnsubscribed,
      ] as const
      for (const e of events) room.on(e, bump)
      room.on(RoomEvent.TrackSubscribed, (_track, pub, p) => {
        attachAudio(pub, p)
        bump()
      })
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) el.remove()
      })
      room.on(RoomEvent.DataReceived, (payload, p, _kind, topic) => {
        if (topic === RECORDING_TOPIC && p) {
          try {
            const { on } = JSON.parse(decoder.decode(payload)) as { on: boolean }
            setRecordingBy((prev) => {
              if (on && !prev) toast.info(`${p.name || 'Someone'} started recording this meeting`)
              return on ? { name: p.name || 'Someone', at: Date.now() } : null
            })
          } catch {}
          return
        }
        if (topic === CAPTION_TOPIC && p) {
          try {
            const { text, final } = JSON.parse(decoder.decode(payload)) as {
              text: string
              final: boolean
            }
            if (typeof text !== 'string') return
            setCaptions((c) => ({
              ...c,
              [p.identity]: {
                speakerId: p.identity,
                name: p.name || 'Someone',
                text: text.slice(0, 500),
                final: !!final,
                at: Date.now(),
              },
            }))
          } catch {}
          return
        }
        if (topic !== CHAT_TOPIC || !p) return
        try {
          const { id, text } = JSON.parse(decoder.decode(payload)) as { id: string; text: string }
          if (typeof text !== 'string' || !text.trim()) return
          setMessages((m) => [
            ...m,
            {
              id,
              fromId: p.identity,
              fromName: p.name || 'Someone',
              text: text.slice(0, 4000),
              at: Date.now(),
            },
          ])
          if (!chatOpen.current) setUnread((n) => n + 1)
        } catch {
          // ignore malformed chat payloads
        }
      })
      room.on(RoomEvent.Disconnected, (reason) => {
        setConnected(false)
        if (roomRef.current !== room) return
        setEndReason(
          reason === DisconnectReason.PARTICIPANT_REMOVED
            ? 'removed'
            : reason === DisconnectReason.ROOM_DELETED
              ? 'ended'
              : reason === DisconnectReason.CLIENT_INITIATED
                ? 'left'
                : 'error',
        )
      })

      await room.connect(url, token)
      setConnected(true)
      setEndReason(null)
      // Media problems shouldn't block joining: you can still listen and watch.
      if (opts.mic)
        await room.localParticipant
          .setMicrophoneEnabled(true, opts.micId ? { deviceId: opts.micId } : undefined)
          .catch(() => {})
      if (opts.camera)
        await room.localParticipant
          .setCameraEnabled(true, opts.cameraId ? { deviceId: opts.cameraId } : undefined)
          .catch(() => {})
      for (const p of room.remoteParticipants.values())
        for (const pub of p.trackPublications.values()) attachAudio(pub, p)
      bump()
      return room
    },
    [attachAudio, bump],
  )

  const disconnect = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    roomRef.current = null
    await room.disconnect()
    if (audioBox.current) audioBox.current.innerHTML = ''
    setConnected(false)
  }, [])

  // The recorder repeats its announcement every 10s; drop the badge if that stops (e.g. they crashed).
  useEffect(() => {
    if (!recordingBy) return
    const t = setInterval(
      () => setRecordingBy((r) => (r && Date.now() - r.at > 25_000 ? null : r)),
      5000,
    )
    return () => clearInterval(t)
  }, [recordingBy])

  useEffect(() => () => void roomRef.current?.disconnect(), [])

  const room = roomRef.current
  const local: LocalParticipant | undefined = room?.localParticipant
  const speakers = new Set(room?.activeSpeakers.map((s) => s.identity) ?? [])
  const everyone: Participant[] = room
    ? [room.localParticipant, ...room.remoteParticipants.values()]
    : []
  const tiles: TileInfo[] = []
  for (const p of everyone) {
    const screen = p.getTrackPublication(Track.Source.ScreenShare)
    if (screen && !screen.isMuted) {
      tiles.push({
        key: `${p.identity}:screen`,
        participant: p,
        isLocal: p.isLocal,
        kind: 'screen',
        publication: screen,
        speaking: false,
        micMuted: false,
      })
    }
    tiles.push({
      key: `${p.identity}:camera`,
      participant: p,
      isLocal: p.isLocal,
      kind: 'camera',
      publication: p.getTrackPublication(Track.Source.Camera),
      speaking: speakers.has(p.identity),
      micMuted: !p.isMicrophoneEnabled,
    })
  }

  const toggle = useCallback(
    async (what: 'mic' | 'camera' | 'screen') => {
      const lp = roomRef.current?.localParticipant
      if (!lp) return
      if (what === 'mic') await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled)
      if (what === 'camera') await lp.setCameraEnabled(!lp.isCameraEnabled)
      if (what === 'screen')
        await lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: true })
      bump()
    },
    [bump],
  )

  const sendChat = useCallback(async (text: string) => {
    const r = roomRef.current
    if (!r || !text.trim()) return
    const msg = { id: crypto.randomUUID(), text: text.trim().slice(0, 4000) }
    await r.localParticipant.publishData(encoder.encode(JSON.stringify(msg)), {
      reliable: true,
      topic: CHAT_TOPIC,
    })
    setMessages((m) => [
      ...m,
      {
        id: msg.id,
        fromId: r.localParticipant.identity,
        fromName: 'You',
        text: msg.text,
        at: Date.now(),
      },
    ])
  }, [])

  /** Tells everyone whether I'm recording. */
  const announceRecording = useCallback(async (on: boolean) => {
    await roomRef.current?.localParticipant
      .publishData(encoder.encode(JSON.stringify({ on })), {
        reliable: true,
        topic: RECORDING_TOPIC,
      })
      .catch(() => {})
  }, [])

  /** Shares one of my caption lines with everyone in the meeting, and shows it locally. */
  const publishCaption = useCallback(async (text: string, final: boolean) => {
    const r = roomRef.current
    if (!r) return
    const lp = r.localParticipant
    setCaptions((c) => ({
      ...c,
      [lp.identity]: { speakerId: lp.identity, name: 'You', text, final, at: Date.now() },
    }))
    await lp
      .publishData(encoder.encode(JSON.stringify({ text, final })), {
        reliable: final,
        topic: CAPTION_TOPIC,
      })
      .catch(() => {})
  }, [])

  const setChatOpen = useCallback((open: boolean) => {
    chatOpen.current = open
    if (open) setUnread(0)
  }, [])

  const switchDevice = useCallback(async (kind: MediaDeviceKind, id: string) => {
    await roomRef.current?.switchActiveDevice(kind, id)
  }, [])

  return {
    room,
    connected,
    endReason,
    local,
    remotes: room ? ([...room.remoteParticipants.values()] as RemoteParticipant[]) : [],
    tiles,
    micOn: !!local?.isMicrophoneEnabled,
    cameraOn: !!local?.isCameraEnabled,
    sharing: !!local?.isScreenShareEnabled,
    messages,
    unread,
    captions,
    publishCaption,
    recordingBy,
    announceRecording,
    audioBox,
    connect,
    disconnect,
    toggle,
    sendChat,
    setChatOpen,
    switchDevice,
  }
}

export type MeetingRoomState = ReturnType<typeof useMeetingRoom>
