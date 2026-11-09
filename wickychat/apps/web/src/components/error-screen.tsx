'use client'
import { Button, QuidMark } from '@quid/ui'

export function ErrorScreen({
  title,
  description,
  emoji,
  illustration,
  onRetry,
  action,
}: {
  title: string
  description: string
  /** Shown in a hand-drawn bubble in place of the WickyChat mark. */
  emoji?: string
  /** A custom drawing (e.g. a mascot); takes the place of `emoji`. */
  illustration?: React.ReactNode
  onRetry?: () => void
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-full animate-in flex-col items-center justify-center gap-4 px-6 text-center">
      {illustration ? (
        illustration
      ) : emoji ? (
        <span
          aria-hidden="true"
          className="q-sketch flex size-16 items-center justify-center border-2 border-dashed border-accent/35 bg-accent-subtle text-[30px] leading-none"
        >
          {emoji}
        </span>
      ) : (
        <QuidMark className="size-9 opacity-80" />
      )}
      <div>
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="mt-1 max-w-sm text-[13px] text-fg-muted">{description}</p>
      </div>
      <div className="flex gap-2">
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        {action}
      </div>
    </div>
  )
}
