'use client'
import { Button, cn } from '@quid/ui'
import { X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useOrgContext } from '../org-context'

type Step = {
  /** `data-tour` of the element to spotlight; none centers the card. */
  target?: string
  title: string
  body: string
  emoji: string
}

const STEPS: Step[] = [
  {
    title: 'Welcome to WickyChat 👋',
    body: "Glad you're here! Here's a one-minute tour of where everything lives. You can replay it any time from your profile menu.",
    emoji: '🎉',
  },
  {
    target: 'search',
    title: 'Find anything',
    body: 'Messages, files, people, channels: it’s all one search away. Press ⌘K (Ctrl+K on Windows) from anywhere to jump straight there.',
    emoji: '🔍',
  },
  {
    target: 'channels',
    title: 'Channels',
    body: 'Where your teams, projects and side quests hang out. Click + to start one or browse the ones you can join.',
    emoji: '💬',
  },
  {
    target: 'plugins',
    title: 'Plugins',
    body: 'Polls, reminders, standups, translation and more live here. Once added, run them with slash commands like /poll.',
    emoji: '🧩',
  },
  {
    target: 'rail-voice',
    title: 'Talk, not just type',
    body: 'Hop into a voice room for a quick chat, or start a Meet with video, screen sharing and live captions.',
    emoji: '🎧',
  },
  {
    target: 'rail-activity',
    title: 'Never miss a mention',
    body: 'Mentions, replies and DMs land in Activity. Home shows what needs you today.',
    emoji: '🔔',
  },
  {
    target: 'user-menu',
    title: "You're all set",
    body: 'Set your status, theme and notifications here. That’s the tour: go say hi to your team!',
    emoji: '🚀',
  },
]

const doneKey = (userId: string) => `quid-tour-done:${userId}`

/** Automated browsers (tests) don't get onboarding popups unless they opt in. */
export function onboardingAllowed() {
  try {
    return !navigator.webdriver || localStorage.getItem('quid-e2e-onboarding') === '1'
  } catch {
    return !navigator.webdriver
  }
}

export function tourDone(userId: string) {
  try {
    return localStorage.getItem(doneKey(userId)) === '1'
  } catch {
    return true
  }
}

type Rect = { top: number; left: number; width: number; height: number }

/** A short spotlight tour, shown once per person and replayable from the profile menu. */
export function Tour() {
  const { me, base } = useOrgContext()
  const pathname = usePathname()
  const router = useRouter()
  const [step, setStep] = useState<number | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [vw, setVw] = useState(1200)
  const [vh, setVh] = useState(800)

  const start = useCallback(() => setStep(0), [])

  useEffect(() => {
    window.addEventListener('quid:tour', start)
    return () => window.removeEventListener('quid:tour', start)
  }, [start])

  // First visit: start shortly after the app has settled.
  useEffect(() => {
    if (!onboardingAllowed() || tourDone(me.id)) return
    const t = setTimeout(start, 900)
    return () => clearTimeout(t)
  }, [me.id, start])

  // The sidebar is visible on the home and chat screens.
  useEffect(() => {
    if (step === null) return
    if (
      !pathname.startsWith(`${base}/home`) &&
      !pathname.startsWith(`${base}/c/`) &&
      pathname !== base
    )
      router.push(`${base}/home`)
  }, [step, pathname, base, router])

  const current = step === null ? null : STEPS[step]

  useLayoutEffect(() => {
    if (!current) return
    const measure = () => {
      setVw(window.innerWidth)
      setVh(window.innerHeight)
      const el = current.target
        ? document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
        : null
      const r = el?.getBoundingClientRect()
      setRect(
        r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
      )
    }
    measure()
    const t = setInterval(measure, 300)
    window.addEventListener('resize', measure)
    return () => {
      clearInterval(t)
      window.removeEventListener('resize', measure)
    }
  }, [current])

  const finish = () => {
    try {
      localStorage.setItem(doneKey(me.id), '1')
    } catch {}
    setStep(null)
  }

  useEffect(() => {
    if (step === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight')
        setStep((s) => (s === null ? s : Math.min(STEPS.length - 1, s + 1)))
      if (e.key === 'ArrowLeft') setStep((s) => (s === null ? s : Math.max(0, s - 1)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current || step === null) return null
  const last = step === STEPS.length - 1
  const pad = 6
  const spot = rect && {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: Math.min(rect.height + pad * 2, vh - rect.top),
  }

  // Card next to the spotlight: to the right if there's room, otherwise below or above.
  const CARD_W = 340
  let card: React.CSSProperties
  if (!spot || vw < 640) {
    card = spot
      ? { left: 16, right: 16, bottom: 16 }
      : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: CARD_W + 40 }
  } else if (spot.left + spot.width + CARD_W + 24 < vw) {
    card = {
      left: spot.left + spot.width + 16,
      top: Math.max(16, Math.min(spot.top, vh - 240)),
      width: CARD_W,
    }
  } else {
    card = {
      left: Math.max(16, Math.min(spot.left, vw - CARD_W - 16)),
      top: spot.top + spot.height + 220 < vh ? spot.top + spot.height + 12 : undefined,
      bottom: spot.top + spot.height + 220 < vh ? undefined : vh - spot.top + 12,
      width: CARD_W,
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-label="WickyChat tour"
    >
      {spot ? (
        <div
          className="pointer-events-none absolute rounded-xl transition-all duration-300 ease-out"
          style={{ ...spot, boxShadow: '0 0 0 9999px rgb(9 9 11 / 0.55)' }}
        >
          <span className="absolute inset-0 animate-pulse rounded-xl ring-2 ring-accent" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-[rgb(9_9_11/0.55)]" />
      )}
      <div
        className="absolute animate-in rounded-2xl border-2 border-dashed border-accent/30 bg-bg-overlay p-5 shadow-dialog"
        style={card}
      >
        <button
          type="button"
          onClick={finish}
          aria-label="Close tour"
          className="absolute top-3 right-3 rounded-md p-1 text-fg-subtle transition-colors duration-150 hover:bg-bg-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
        <span
          key={current.emoji}
          aria-hidden="true"
          className="q-sketch mb-3 flex size-11 animate-in items-center justify-center border-2 border-dashed border-accent/35 bg-accent-subtle text-xl leading-none"
        >
          {current.emoji}
        </span>
        <p className="pr-6 text-[15px] font-semibold tracking-[-0.01em]">{current.title}</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{current.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <div
            className="flex flex-1 gap-1"
            role="img"
            aria-label={`Step ${step + 1} of ${STEPS.length}`}
          >
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === step ? 'w-4 bg-accent' : 'w-1.5 bg-border-strong',
                )}
              />
            ))}
          </div>
          {step === 0 ? (
            <Button size="sm" variant="ghost" onClick={finish}>
              Skip
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (last ? finish() : setStep(step + 1))}>
            {step === 0 ? 'Show me around' : last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
