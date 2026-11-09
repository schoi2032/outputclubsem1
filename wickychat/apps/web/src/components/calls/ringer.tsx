'use client'
import { useEffect } from 'react'

/**
 * Synthesized ring tones (no audio files). Incoming: two short rising tones
 * every two seconds. Outgoing: a soft ringback while the other side is rung.
 * Browsers may block sound until the page has been interacted with.
 */
export function Ringer({ mode }: { mode: 'incoming' | 'outgoing' | null }) {
  useEffect(() => {
    if (!mode) return
    let ctx: AudioContext | null = null
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
    const beep = (freq: number, at: number, len: number, volume: number) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(volume, at + 0.02)
      gain.gain.linearRampToValueAtTime(0, at + len)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(at)
      osc.stop(at + len + 0.05)
    }
    const ring = () => {
      if (!ctx || ctx.state === 'closed') return
      void ctx.resume().catch(() => {})
      const t = ctx.currentTime
      if (mode === 'incoming') {
        beep(660, t, 0.18, 0.18)
        beep(880, t + 0.22, 0.22, 0.18)
      } else {
        beep(440, t, 0.9, 0.05)
      }
    }
    ring()
    const timer = setInterval(ring, mode === 'incoming' ? 2000 : 3000)
    return () => {
      clearInterval(timer)
      void ctx?.close()
    }
  }, [mode])
  return null
}
