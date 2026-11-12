'use client'
import { type SoundPackSpec, specFromValue } from '@quid/shared'

type Note = { f: number; t: number; d: number; type?: OscillatorType; g?: number; slide?: number }
type Kind = 'notify' | 'send'

const SYNTH: Record<string, Record<Kind, Note[]>> = {
  retro: {
    notify: [
      { f: 660, t: 0, d: 0.08, type: 'square', g: 0.12 },
      { f: 990, t: 0.09, d: 0.12, type: 'square', g: 0.12 },
    ],
    send: [{ f: 520, t: 0, d: 0.06, type: 'square', g: 0.08, slide: 780 }],
  },
  chime: {
    notify: [
      { f: 784, t: 0, d: 0.6, g: 0.18 },
      { f: 1175, t: 0.12, d: 0.7, g: 0.12 },
    ],
    send: [{ f: 1047, t: 0, d: 0.35, g: 0.1 }],
  },
  pop: {
    notify: [
      { f: 420, t: 0, d: 0.07, g: 0.25, slide: 900 },
      { f: 520, t: 0.1, d: 0.07, g: 0.2, slide: 1100 },
    ],
    send: [{ f: 380, t: 0, d: 0.06, g: 0.2, slide: 820 }],
  },
  drop: {
    notify: [{ f: 1400, t: 0, d: 0.18, g: 0.2, slide: 600 }],
    send: [{ f: 1100, t: 0, d: 0.12, g: 0.12, slide: 500 }],
  },
  kalimba: {
    notify: [
      { f: 523, t: 0, d: 0.5, type: 'triangle', g: 0.22 },
      { f: 659, t: 0.11, d: 0.5, type: 'triangle', g: 0.2 },
      { f: 784, t: 0.22, d: 0.7, type: 'triangle', g: 0.2 },
    ],
    send: [{ f: 659, t: 0, d: 0.35, type: 'triangle', g: 0.15 }],
  },
  typewriter: {
    notify: [
      { f: 180, t: 0, d: 0.03, type: 'square', g: 0.12 },
      { f: 2093, t: 0.08, d: 0.5, g: 0.12 },
    ],
    send: [{ f: 160, t: 0, d: 0.03, type: 'square', g: 0.12 }],
  },
  bell: {
    notify: [
      { f: 1568, t: 0, d: 0.9, g: 0.16 },
      { f: 3136, t: 0, d: 0.5, g: 0.04 },
    ],
    send: [{ f: 1318, t: 0, d: 0.3, g: 0.08 }],
  },
  arcade: {
    notify: [
      { f: 988, t: 0, d: 0.07, type: 'square', g: 0.1 },
      { f: 1319, t: 0.07, d: 0.25, type: 'square', g: 0.1 },
    ],
    send: [{ f: 880, t: 0, d: 0.05, type: 'square', g: 0.07 }],
  },
}

let ctx: AudioContext | null = null

function audio() {
  if (typeof window === 'undefined') return null
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function playNotes(notes: Note[]) {
  const ac = audio()
  if (!ac) return
  const now = ac.currentTime + 0.01
  for (const n of notes) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = n.type ?? 'sine'
    osc.frequency.setValueAtTime(n.f, now + n.t)
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, now + n.t + n.d)
    gain.gain.setValueAtTime(0, now + n.t)
    gain.gain.linearRampToValueAtTime(n.g ?? 0.15, now + n.t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d)
    osc.connect(gain).connect(ac.destination)
    osc.start(now + n.t)
    osc.stop(now + n.t + n.d + 0.05)
  }
}

export function playSpec(spec: SoundPackSpec, kind: Kind) {
  try {
    if ('synth' in spec) {
      const s = SYNTH[spec.synth]
      if (s) playNotes(s[kind])
      return
    }
    const file = kind === 'notify' ? spec.notify : (spec.send ?? null)
    if (!file) return
    const el = new Audio(`/api/files/${file}/content?inline=1`)
    el.volume = 0.5
    void el.play().catch(() => {})
  } catch {}
}

export function playPack(value: string | null | undefined, kind: Kind) {
  const spec = specFromValue('sound_pack', value)
  if (spec) playSpec(spec, kind)
}
