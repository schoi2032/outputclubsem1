'use client'
import { type SpecKind, specFromValue, typingText } from '@quid/shared'
import { cn } from '@quid/ui'
import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import {
  bubbleProps,
  MessageFxLayer,
  mentionStyleProps,
  nameFxFor,
  reactionSkinProps,
  TypingLine,
} from '@/components/profile/flair'
import { displayName } from '@/lib/format'
import { playPack } from '@/lib/sounds'

function useTick(ms: number) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

function FxDemo({ value, compact }: { value: string; compact?: boolean }) {
  const tick = useTick(2600)
  const spec = specFromValue('message_effect', value)
  if (!spec) return null
  return (
    <div className="relative flex w-full items-center justify-center">
      <span
        key={tick}
        className={cn(
          'relative rounded-lg bg-bg-muted px-2.5 py-1 text-[13px]',
          `q-mfx-${spec.motion}`,
          compact && 'text-[11px]',
        )}
        style={spec.color ? ({ '--mfx-c': spec.color } as React.CSSProperties) : undefined}
      >
        we won!!
        <MessageFxLayer key={tick} spec={spec} seed={tick + 3} />
      </span>
    </div>
  )
}

export function FlairPreview({
  kind,
  value,
  compact,
}: {
  kind: SpecKind
  value?: string
  compact?: boolean
}) {
  const { me } = useOrgContext()
  const name = displayName(me)
  if (!value) return null
  if (kind === 'name_effect') {
    const p = nameFxFor(value)
    return (
      <span
        className={cn('truncate font-bold', compact ? 'text-[14px]' : 'text-[18px]', p?.className)}
        style={p?.style}
      >
        {name}
      </span>
    )
  }
  if (kind === 'message_effect') return <FxDemo value={value} compact={compact} />
  if (kind === 'typing') {
    const spec = specFromValue('typing', value)
    return spec ? (
      <span className="text-[12px] text-fg-subtle">
        <TypingLine spec={spec} value={value} text={typingText(name.split(' ')[0]!, spec)} />
      </span>
    ) : null
  }
  if (kind === 'reaction_skin') {
    const p = reactionSkinProps(value)
    return (
      <span className="flex gap-1">
        {[
          ['👍', 3],
          ['🔥', 1],
        ].map(([e, n]) => (
          <span
            key={e}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 text-xs',
              p?.className,
            )}
            style={p?.style}
          >
            {e} {n}
          </span>
        ))}
      </span>
    )
  }
  if (kind === 'mention_style') {
    const p = mentionStyleProps(value)
    return (
      <span className={cn('text-[13px]', p?.className)} style={p?.style}>
        hey <span className="q-mention">@Ben</span> look
      </span>
    )
  }
  if (kind === 'bubble') {
    const p = bubbleProps(value)
    return (
      <span className={cn('q-msg-text truncate', p.className)} style={p.style}>
        hey whats up 👋
      </span>
    )
  }
  return (
    <span className="flex gap-1.5">
      {(['notify', 'send'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            playPack(value, k)
          }}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-bg px-2.5 py-1 text-xs hover:bg-bg-muted"
        >
          <Play className="size-3" />
          {k === 'notify' ? 'Ping' : 'Send'}
        </button>
      ))}
    </span>
  )
}
