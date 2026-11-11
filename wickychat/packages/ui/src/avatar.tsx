import { cn } from './cn'

const PALETTE = [
  '#5b6ee8',
  '#d4691e',
  '#2c9c6a',
  '#b0478f',
  '#3b8fc9',
  '#8a6ad8',
  '#c4483e',
  '#4f8f2f',
]

export function initials(name: string) {
  const parts = name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() ||
    '?'
  )
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export type PresenceState = 'active' | 'away' | 'dnd' | 'offline'

const SIZES = {
  xs: 'size-5 text-[9px] rounded-[5px]',
  sm: 'size-6 text-[10px] rounded-md',
  md: 'size-8 text-xs rounded-md',
  lg: 'size-10 text-sm rounded-lg',
  xl: 'size-16 text-xl rounded-xl',
}

export function Avatar({
  name,
  src,
  id,
  size = 'md',
  presence,
  decoration,
  className,
}: {
  name: string
  src?: string | null
  id?: string
  size?: keyof typeof SIZES
  presence?: PresenceState
  /** WickyChat: an animated decoration id (see DECORATIONS in @quid/shared). */
  decoration?: string | null
  className?: string
}) {
  const color = PALETTE[hash(id ?? name) % PALETTE.length]
  // Animated avatars (`anim=1`) show a still frame and play on hover; see styles.css.
  const animated = !!src?.includes('anim=1')
  return (
    <span className={cn('q-ava relative inline-flex shrink-0', className)} data-size={size}>
      {src && animated ? (
        <>
          <img src={`${src}&thumb=1`} alt="" className={cn('object-cover', SIZES[size])} />
          <img
            src={src}
            alt=""
            loading="lazy"
            className={cn('q-ava-anim absolute inset-0 object-cover', SIZES[size])}
          />
        </>
      ) : src ? (
        <img src={src} alt="" className={cn('object-cover', SIZES[size])} />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex items-center justify-center font-semibold text-white',
            SIZES[size],
          )}
          style={{ background: color }}
        >
          {initials(name)}
        </span>
      )}
      {decoration && size !== 'xs' && (
        <span aria-hidden="true" className={`q-deco q-deco-${decoration}`} />
      )}
      {presence && <PresenceDot state={presence} className="absolute -right-0.5 -bottom-0.5" />}
    </span>
  )
}

export function PresenceDot({ state, className }: { state: PresenceState; className?: string }) {
  const label = { active: 'Active', away: 'Away', dnd: 'Do not disturb', offline: 'Offline' }[state]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-block size-2.5 rounded-full ring-2 ring-[var(--presence-ring,var(--q-bg))]',
        state === 'active' && 'bg-success',
        state === 'away' && 'border-[1.5px] border-fg-subtle bg-[var(--presence-ring,var(--q-bg))]',
        state === 'dnd' && 'bg-danger',
        state === 'offline' && 'border-[1.5px] border-fg-subtle/60 bg-transparent',
        className,
      )}
    />
  )
}
