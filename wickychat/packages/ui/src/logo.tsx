import { useId } from 'react'
import { cn } from './cn'

/** The Wicky mark from Output Club's homepage: a purple-to-green kite with a gold tip. */
export function QuidMark({
  className,
  title = 'WickyChat',
}: {
  className?: string
  title?: string
}) {
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8052ff" />
          <stop offset="1" stopColor="#15846e" />
        </linearGradient>
      </defs>
      <path d="M3 5 L29 9 L12 28 Z" fill={`url(#${id})`} />
      <path d="M17 3 L28 4 L22 11 Z" fill="#ffb829" />
    </svg>
  )
}

export function QuidWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <QuidMark className="size-7" />
      <span className="text-[19px] font-semibold tracking-[-0.04em]">wickychat</span>
    </span>
  )
}
