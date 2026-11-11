'use client'
/**
 * Live captions for *your own* voice, using the browser's speech recognition.
 * Interim text is shared live with the meeting; finished lines are also saved
 * to the meeting transcript. Only runs after you turn captions on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { post } from '@/lib/api'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}
type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const captionsSupported = () => recognitionCtor() !== null

export function useCaptions(opts: {
  enabled: boolean
  micOn: boolean
  /** Where finished lines are saved; omit to caption without saving (guests). */
  transcriptUrl?: string
  publish: (text: string, final: boolean) => Promise<void>
}) {
  const { enabled, micOn, transcriptUrl, publish } = opts
  const [error, setError] = useState<string | null>(null)
  const queue = useRef<{ text: string; spokenAt: string }[]>([])
  const publishRef = useRef(publish)
  publishRef.current = publish

  const flush = useCallback(async () => {
    if (!transcriptUrl || queue.current.length === 0) return
    const batch = queue.current.splice(0, 50)
    try {
      await post(transcriptUrl, { segments: batch })
    } catch {
      // Put them back and try again on the next flush.
      queue.current.unshift(...batch)
    }
  }, [transcriptUrl])

  // Save finished lines every few seconds, and once more when captions stop.
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => void flush(), 4000)
    return () => {
      clearInterval(t)
      void flush()
    }
  }, [enabled, flush])

  useEffect(() => {
    const Ctor = recognitionCtor()
    if (!enabled || !micOn || !Ctor) return
    let stopped = false
    let lastInterim = 0
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!
        const text = r[0].transcript.trim()
        if (!text) continue
        if (r.isFinal) {
          void publishRef.current(text, true)
          queue.current.push({ text, spokenAt: new Date().toISOString() })
        } else if (Date.now() - lastInterim > 250) {
          lastInterim = Date.now()
          void publishRef.current(text, false)
        }
      }
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        stopped = true
        setError('Captions need microphone and speech recognition access in your browser.')
      }
    }
    // Recognition stops on its own after silence; keep it going while captions are on.
    rec.onend = () => {
      if (!stopped) {
        try {
          rec.start()
        } catch {}
      }
    }
    try {
      rec.start()
      setError(null)
    } catch {
      setError("Captions couldn't start.")
    }
    return () => {
      stopped = true
      rec.onend = null
      rec.stop()
    }
  }, [enabled, micOn])

  return { error, supported: captionsSupported() }
}
