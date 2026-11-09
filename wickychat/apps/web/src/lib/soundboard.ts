'use client'
/**
 * Soundboard playback. Built-in sounds are synthesized with WebAudio, so they
 * ship no audio files; an org's own sounds are short clips played with <audio>.
 * Volumes multiply: the sound's own level × the listener's soundboard volume.
 */
import type { SoundboardSound } from '@quid/shared'

export interface BoardSound {
  id: string
  name: string
  emoji: string | null
  volume: number
  url?: string
}

type Synth = (ctx: AudioContext, out: AudioNode, t: number) => number

let audioCtx: AudioContext | null = null
function ctx() {
  audioCtx ??= new AudioContext()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

function tone(
  c: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  peak = 0.3,
  attack = 0.01,
) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(peak, start + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g).connect(out)
  o.start(start)
  o.stop(start + dur + 0.05)
  return o
}

let noiseBuf: AudioBuffer | null = null
function noise(c: AudioContext, out: AudioNode, start: number, dur: number, peak: number) {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  const g = c.createGain()
  g.gain.setValueAtTime(peak, start)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  src.connect(g).connect(out)
  src.start(start, Math.random())
  src.stop(start + dur + 0.05)
  return { src, gain: g }
}

const SYNTHS: Record<string, Synth> = {
  airhorn: (c, out, t) => {
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 2400
    f.connect(out)
    for (const [i, len] of [0.18, 0.18, 0.8].entries()) {
      const s = t + [0, 0.24, 0.48][i]!
      for (const hz of [466, 587, 698]) tone(c, f, 'sawtooth', hz, s, len, 0.09, 0.02)
    }
    return 1.4
  },
  ding: (c, out, t) => {
    tone(c, out, 'sine', 1318.5, t, 1.4, 0.35)
    tone(c, out, 'sine', 2637, t, 0.8, 0.12)
    return 1.5
  },
  tada: (c, out, t) => {
    const notes = [523.25, 659.25, 783.99]
    for (const [i, hz] of notes.entries()) tone(c, out, 'triangle', hz, t + i * 0.09, 0.25, 0.25)
    for (const hz of [523.25, 659.25, 783.99, 1046.5])
      tone(c, out, 'triangle', hz, t + 0.3, 1.1, 0.14)
    return 1.5
  },
  boing: (c, out, t) => {
    const o = tone(c, out, 'sine', 140, t, 0.9, 0.4)
    o.frequency.exponentialRampToValueAtTime(620, t + 0.12)
    o.frequency.exponentialRampToValueAtTime(220, t + 0.85)
    const lfo = c.createOscillator()
    const depth = c.createGain()
    lfo.frequency.value = 18
    depth.gain.value = 30
    lfo.connect(depth).connect(o.frequency)
    lfo.start(t)
    lfo.stop(t + 0.95)
    return 1
  },
  sad: (c, out, t) => {
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 1200
    f.connect(out)
    const notes = [392, 370, 349.2]
    for (const [i, hz] of notes.entries())
      tone(c, f, 'sawtooth', hz, t + i * 0.45, 0.42, 0.18, 0.04)
    const last = tone(c, f, 'sawtooth', 329.6, t + 1.35, 1.3, 0.18, 0.04)
    const lfo = c.createOscillator()
    const depth = c.createGain()
    lfo.frequency.value = 6
    depth.gain.value = 7
    lfo.connect(depth).connect(last.frequency)
    lfo.start(t + 1.5)
    lfo.stop(t + 2.7)
    return 2.8
  },
  drumroll: (c, out, t) => {
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 900
    f.connect(out)
    for (let i = 0; i < 26; i++) noise(c, f, t + i * 0.055, 0.06, 0.18 + i * 0.012)
    const hi = c.createBiquadFilter()
    hi.type = 'highpass'
    hi.frequency.value = 5000
    hi.connect(out)
    noise(c, hi, t + 1.45, 1.2, 0.5)
    tone(c, out, 'sine', 70, t + 1.45, 0.35, 0.6)
    return 2.7
  },
  applause: (c, out, t) => {
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 2200
    f.Q.value = 0.8
    f.connect(out)
    for (let i = 0; i < 90; i++) {
      const s = t + Math.random() * 2.2
      noise(c, f, s, 0.03 + Math.random() * 0.03, 0.15 + Math.random() * 0.25)
    }
    return 2.4
  },
  crickets: (c, out, t) => {
    for (let chirp = 0; chirp < 4; chirp++) {
      const s = t + chirp * 0.55
      for (let i = 0; i < 3; i++) tone(c, out, 'sine', 4400, s + i * 0.045, 0.035, 0.12, 0.004)
    }
    return 2.3
  },
}

export const BUILTIN_SOUNDS: BoardSound[] = [
  { id: 'builtin:airhorn', name: 'Airhorn', emoji: '📯', volume: 80 },
  { id: 'builtin:tada', name: 'Ta-da', emoji: '🎉', volume: 100 },
  { id: 'builtin:applause', name: 'Applause', emoji: '👏', volume: 100 },
  { id: 'builtin:drumroll', name: 'Drumroll', emoji: '🥁', volume: 100 },
  { id: 'builtin:ding', name: 'Ding', emoji: '🔔', volume: 90 },
  { id: 'builtin:boing', name: 'Boing', emoji: '🤸', volume: 100 },
  { id: 'builtin:sad', name: 'Sad trombone', emoji: '🎺', volume: 100 },
  { id: 'builtin:crickets', name: 'Crickets', emoji: '🦗', volume: 100 },
]

export const toBoardSound = (s: SoundboardSound): BoardSound => ({
  id: s.id,
  name: s.name,
  emoji: s.emoji,
  volume: s.volume,
  url: s.url,
})

const playing = new Set<{ stop: () => void }>()
const MAX_AT_ONCE = 4

/** Plays a sound at `listenerVolume` (0–100). Old sounds are cut when too many overlap. */
export function playSound(sound: BoardSound, listenerVolume: number) {
  const level = (sound.volume / 100) * (listenerVolume / 100)
  if (level <= 0) return
  if (playing.size >= MAX_AT_ONCE) {
    const oldest = playing.values().next().value
    oldest?.stop()
  }
  if (sound.url) {
    const a = new Audio(sound.url)
    a.volume = Math.min(1, level)
    const h = { stop: () => a.pause() }
    playing.add(h)
    const done = () => playing.delete(h)
    a.addEventListener('ended', done)
    a.addEventListener('pause', done)
    a.addEventListener('error', done)
    // Clips are meant to be short; cut anything long.
    setTimeout(() => a.pause(), 8000)
    void a.play().catch(done)
    return
  }
  const synth = SYNTHS[sound.id.replace('builtin:', '')]
  if (!synth) return
  const c = ctx()
  const out = c.createGain()
  out.gain.value = level
  out.connect(c.destination)
  const len = synth(c, out, c.currentTime + 0.02)
  const h = { stop: () => out.disconnect() }
  playing.add(h)
  setTimeout(
    () => {
      out.disconnect()
      playing.delete(h)
    },
    len * 1000 + 200,
  )
}
