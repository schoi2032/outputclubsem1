'use client'
import {
  type BubbleSpec,
  bubbleById,
  type MentionStyleSpec,
  type MessageEffectSpec,
  type NameEffectSpec,
  type ReactionSkinSpec,
  specFromValue,
  type TypingSpec,
} from '@quid/shared'
import { cn } from '@quid/ui'
import { type CSSProperties, useEffect, useState } from 'react'

type Vars = CSSProperties & Record<`--${string}`, string | number>

const grad = (cols: string[], angle = 90) =>
  cols.length === 1 ? cols[0]! : `linear-gradient(${angle}deg, ${cols.join(', ')})`

export function nameEffectProps(spec: NameEffectSpec | null) {
  if (!spec) return null
  const [c1, c2 = c1, c3 = c2] = spec.colors as [string, string?, string?]
  const style: Vars = {
    '--ne1': c1,
    '--ne2': c2 ?? c1,
    '--ne3': c3 ?? c2 ?? c1,
    '--ne-t': `${(3 / spec.speed).toFixed(2)}s`,
  }
  return { className: `q-ne q-ne-${spec.anim}`, style }
}

export function bubbleProps(value?: string | null): { className: string; style?: Vars } {
  const builtin = bubbleById(value)
  if (builtin) return { className: `q-bubble q-bubble-${builtin.id.slice(2)}` }
  const spec = specFromValue('bubble', value)
  if (!spec) return { className: '' }
  return customBubble(spec)
}

export function customBubble(spec: BubbleSpec) {
  const style: Vars = {
    '--bb-bg': grad(spec.bg, 125),
    '--bb-fg': spec.text,
    '--bb-border': spec.border ?? 'transparent',
    '--bb-c1': spec.bg[0]!,
  }
  return {
    className: cn(
      'q-bubble q-bubble-custom',
      `q-bb-shape-${spec.shape}`,
      spec.border && spec.borderStyle !== 'none' && `q-bb-border-${spec.borderStyle}`,
      spec.pattern !== 'none' && `q-bb-pat-${spec.pattern}`,
      spec.anim !== 'none' && `q-bb-anim-${spec.anim}`,
    ),
    style,
  }
}

export function reactionSkinProps(value?: string | null) {
  const spec = specFromValue('reaction_skin', value)
  return spec ? reactionSkinFromSpec(spec) : null
}

export function reactionSkinFromSpec(spec: ReactionSkinSpec) {
  const style: Vars = {
    '--rs-bg': grad(spec.bg, 135),
    '--rs-border': spec.border,
    '--rs-fg': spec.text,
  }
  return {
    className: cn('q-rs', `q-rs-${spec.shape}`, spec.glow && 'q-rs-glow'),
    style,
  }
}

export function mentionStyleProps(value?: string | null) {
  const spec = specFromValue('mention_style', value)
  return spec ? mentionFromSpec(spec) : null
}

export function mentionFromSpec(spec: MentionStyleSpec) {
  const style: Vars = { '--ms-bg': grad(spec.bg, 120), '--ms-fg': spec.text }
  return { className: cn('q-ms', `q-ms-${spec.shape}`, spec.glow && 'q-ms-glow'), style }
}

const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

const PAPER = ['#ff5c8a', '#ffd23f', '#3bceac', '#5b6ee8', '#ff8c42', '#b06cff']

export function MessageFxLayer({ spec, seed = 1 }: { spec: MessageEffectSpec; seed?: number }) {
  if (spec.motion === 'shake' || spec.motion === 'pop' || spec.motion === 'glow') return null
  const count = spec.motion === 'burst' ? 12 : 14
  const parts = spec.particles.length ? spec.particles : ['✨']
  return (
    <span aria-hidden="true" className={`q-mfx q-mfx-${spec.motion}`}>
      {Array.from({ length: count }, (_, i) => {
        const a = rand(i, seed)
        const b = rand(i + 50, seed)
        const angle = (i / count) * Math.PI * 2 + a * 0.5
        const dist = 40 + b * 50
        const style: Vars = {
          '--x': `${Math.round(a * 100)}%`,
          '--dx': `${Math.round(Math.cos(angle) * dist)}px`,
          '--dy': `${Math.round(Math.sin(angle) * dist * 0.7)}px`,
          '--d': `${Math.round(b * 400)}ms`,
          '--r': `${Math.round(a * 720 - 360)}deg`,
          ...(spec.motion === 'confetti' && { '--pc': PAPER[i % PAPER.length]! }),
        }
        return (
          <span key={i} style={style}>
            {spec.motion === 'confetti' ? '' : parts[i % parts.length]}
          </span>
        )
      })}
    </span>
  )
}

const played = new Set<string>()

export function useMessageFx(key: string, createdAt: string, value?: string | null, ready = true) {
  const [spec] = useState(() => {
    if (!ready || !value || played.has(key)) return null
    if (Date.now() - new Date(createdAt).getTime() > 15_000) return null
    const s = specFromValue('message_effect', value)
    if (s) played.add(key)
    return s
  })
  const [on, setOn] = useState(!!spec)
  useEffect(() => {
    if (!on) return
    const t = setTimeout(() => setOn(false), 2200)
    return () => clearTimeout(t)
  }, [on])
  return on ? spec : null
}

export function TypingLine({ spec, text }: { spec: TypingSpec | null; text: string }) {
  const words = spec?.textColors
    ? nameEffectProps({ colors: spec.textColors, anim: spec.textAnim ?? 'none', speed: 1 })
    : null
  const pill: Vars | undefined = spec?.bg
    ? { '--typ-bg': grad(spec.bg, 110), '--typ-border': spec.border ?? 'transparent' }
    : undefined
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        pill && 'q-ty-pill',
        spec?.size === 'small' && 'text-[10px]',
        spec?.size === 'big' && 'text-[13px]',
      )}
      style={pill}
    >
      {spec ? (
        <TypingGlyphs spec={spec} />
      ) : (
        <span className="inline-flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1 animate-bounce rounded-full bg-fg-subtle"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </span>
      )}
      <span
        className={cn(
          words?.className,
          spec?.font && `q-font-${spec.font}`,
          spec?.bold && 'font-bold',
          spec?.italic && 'italic',
        )}
        style={words?.style}
      >
        {text}…
      </span>
    </span>
  )
}

export function TypingGlyphs({ spec }: { spec: TypingSpec }) {
  return (
    <span
      className={`q-ty q-ty-${spec.anim}`}
      style={spec.color ? { color: spec.color } : undefined}
      aria-hidden="true"
    >
      {spec.glyphs.map((g, i) => (
        <span key={i} style={{ animationDelay: `${i * 140}ms` }}>
          {g}
        </span>
      ))}
    </span>
  )
}
