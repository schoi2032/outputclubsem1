'use client'
/**
 * Records a meeting in the host's browser and saves it to their computer.
 * Captures this tab (the meeting view) and mixes everyone's audio into it.
 * Nothing is uploaded; everyone in the meeting sees that it's being recorded.
 */
import { type Room, RoomEvent, Track } from 'livekit-client'
import { useCallback, useEffect, useRef, useState } from 'react'

function pickMime() {
  const options = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  return (
    options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ??
    ''
  )
}

export const recordingSupported = () =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getDisplayMedia

export function useRecording(opts: {
  room: Room | null
  fileName: string
  announce: (on: boolean) => Promise<void>
}) {
  const { room, fileName, announce } = opts
  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const start = useCallback(async () => {
    if (!room || recording) return
    // Ask the user to share this tab (Chrome preselects it).
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 24 },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    } as DisplayMediaStreamOptions)

    // Mix my microphone and everyone else's audio.
    const ctx = new AudioContext()
    const mix = ctx.createMediaStreamDestination()
    const connected = new Set<string>()
    const addTrack = (t: MediaStreamTrack | undefined) => {
      if (!t || connected.has(t.id)) return
      connected.add(t.id)
      ctx.createMediaStreamSource(new MediaStream([t])).connect(mix)
    }
    const addAll = () => {
      addTrack(
        room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack,
      )
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (pub.kind === Track.Kind.Audio) addTrack(pub.track?.mediaStreamTrack)
        }
      }
    }
    addAll()
    room.on(RoomEvent.TrackSubscribed, addAll).on(RoomEvent.LocalTrackPublished, addAll)

    const stream = new MediaStream([...display.getVideoTracks(), ...mix.stream.getAudioTracks()])
    const mimeType = pickMime()
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined,
    )
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.onstop = () => {
      const type = recorder.mimeType || 'video/webm'
      const blob = new Blob(chunks, { type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileName}.${type.includes('mp4') ? 'mp4' : 'webm'}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }

    const heartbeat = setInterval(() => void announce(true), 10_000)
    const stop = () => {
      clearInterval(heartbeat)
      room.off(RoomEvent.TrackSubscribed, addAll).off(RoomEvent.LocalTrackPublished, addAll)
      if (recorder.state !== 'inactive') recorder.stop()
      for (const t of display.getTracks()) t.stop()
      void ctx.close()
      void announce(false)
      stopRef.current = null
      setRecording(false)
      setStartedAt(null)
    }
    // Stopping the tab share from the browser's own bar also stops the recording.
    display.getVideoTracks()[0]?.addEventListener('ended', stop)
    stopRef.current = stop
    recorder.start(1000)
    await announce(true)
    setRecording(true)
    setStartedAt(Date.now())
  }, [room, recording, fileName, announce])

  const stop = useCallback(() => stopRef.current?.(), [])

  // Leaving the meeting stops and saves the recording.
  useEffect(() => () => stopRef.current?.(), [])

  return { recording, startedAt, start, stop, supported: recordingSupported() }
}
