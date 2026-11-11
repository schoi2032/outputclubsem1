'use client'
import { Button, Dialog, DialogContent, DialogFooter } from '@quid/ui'
import { useEffect, useState } from 'react'
import type { LiveCaption } from './use-meeting-room'

/** Recent caption lines over the bottom of the stage. */
export function CaptionOverlay({ captions }: { captions: Record<string, LiveCaption> }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const lines = Object.values(captions)
    .filter((c) => now - c.at < 7000)
    .sort((a, b) => a.at - b.at)
    .slice(-3)
  if (!lines.length) return null
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4"
      aria-live="polite"
    >
      <div className="max-w-3xl rounded-lg bg-black/75 px-4 py-2 text-center text-[15px] leading-snug text-white">
        {lines.map((c) => (
          <p key={c.speakerId}>
            <span className="font-semibold text-white/70">{c.name}: </span>
            {c.text}
          </p>
        ))}
      </div>
    </div>
  )
}

const CONSENT_KEY = 'quid-captions-consent'

export function hasCaptionConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

/** Explains where speech goes before captions transcribe your voice for the first time. */
export function CaptionConsent({
  open,
  onOpenChange,
  onAccept,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAccept: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Turn on captions?"
        description="Captions show what people say, as they say it."
      >
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] text-fg-muted">
          <li>
            While your captions are on, your browser turns{' '}
            <strong className="text-fg">your own voice</strong> into text and shares it with the
            meeting.
          </li>
          <li>
            Your finished lines are saved to the meeting transcript, which only people in the
            meeting can read.
          </li>
          <li>
            Speech recognition is provided by your browser. In Chrome and Edge, your audio is
            processed by Google or Microsoft to do this.
          </li>
          <li>Other people's speech is captioned only when they turn their captions on.</li>
        </ul>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Not now</Button>
          <Button
            variant="primary"
            onClick={() => {
              try {
                localStorage.setItem(CONSENT_KEY, '1')
              } catch {}
              onAccept()
              onOpenChange(false)
            }}
          >
            Turn on captions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
