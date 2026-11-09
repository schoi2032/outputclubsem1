import { cn } from './cn'

/*
 * The WickyChat crew: three soft characters drawn on a 120×120 grid.
 * Bubble (terracotta speech bubble) is the lead; Sprout (sage flower) and Pebble (pink) back it up.
 * Colors are fixed brand colors, not theme tokens, so the crew looks the same in light and dark.
 */

export type MascotKind = 'bubble' | 'sprout' | 'pebble'
export type MascotMood = 'happy' | 'sleepy' | 'wink' | 'wow'

const BODY: Record<MascotKind, { color: string; face: [number, number] }> = {
  bubble: { color: '#e2694a', face: [60, 54] },
  sprout: { color: '#8fbf9b', face: [60, 60] },
  pebble: { color: '#f5c2d3', face: [60, 61] },
}

const INK = '#2b1d17'

function Body({ kind, color }: { kind: MascotKind; color: string }) {
  if (kind === 'bubble')
    return (
      <path
        fill={color}
        d="M60 12C88 12 108 30 108 55C108 80 88 97 60 97C52 97 45 96 39 93L20 103C16.6 104.8 13.6 101.8 15.4 98.4L22.6 84C15.8 76.2 12 66 12 55C12 30 32 12 60 12Z"
      />
    )
  if (kind === 'sprout')
    return (
      <g fill={color}>
        {[0, 60, 120, 180, 240, 300].map((a) => {
          const r = (a * Math.PI) / 180
          return (
            <circle
              key={a}
              cx={(60 + 27 * Math.cos(r)).toFixed(2)}
              cy={(60 + 27 * Math.sin(r)).toFixed(2)}
              r="21"
            />
          )
        })}
        <circle cx="60" cy="60" r="32" />
      </g>
    )
  return <ellipse fill={color} cx="60" cy="62" rx="47" ry="40" transform="rotate(-8 60 62)" />
}

function Face({ mood, cx, cy }: { mood: MascotMood; cx: number; cy: number }) {
  const eye = (x: number, kind: 'open' | 'closed' | 'dot') =>
    kind === 'dot' ? (
      <circle cx={x} cy={cy - 4} r="4" fill={INK} />
    ) : kind === 'open' ? (
      // "^" happy-closed eye
      <path d={`M${x - 6} ${cy - 1}Q${x} ${cy - 10} ${x + 6} ${cy - 1}`} />
    ) : (
      // "u" sleepy eye
      <path d={`M${x - 6} ${cy - 6}Q${x} ${cy + 2} ${x + 6} ${cy - 6}`} />
    )
  const [left, right] =
    mood === 'happy'
      ? (['open', 'open'] as const)
      : mood === 'sleepy'
        ? (['closed', 'closed'] as const)
        : mood === 'wink'
          ? (['dot', 'open'] as const)
          : (['dot', 'dot'] as const)
  return (
    <g stroke={INK} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
      <circle cx={cx - 22} cy={cy + 7} r="6" fill="#ff8fa3" fillOpacity="0.45" stroke="none" />
      <circle cx={cx + 22} cy={cy + 7} r="6" fill="#ff8fa3" fillOpacity="0.45" stroke="none" />
      {eye(cx - 13, left)}
      {eye(cx + 13, right)}
      {mood === 'wow' ? (
        <ellipse cx={cx} cy={cy + 12} rx="4.5" ry="5.5" fill={INK} stroke="none" />
      ) : (
        <path
          d={
            mood === 'sleepy'
              ? `M${cx - 6} ${cy + 9}Q${cx} ${cy + 14} ${cx + 6} ${cy + 9}`
              : `M${cx - 9} ${cy + 7}Q${cx} ${cy + 18} ${cx + 9} ${cy + 7}`
          }
        />
      )}
    </g>
  )
}

/** A WickyChat mascot. Decorative unless given a `title`. */
export function Mascot({
  kind = 'bubble',
  mood = 'happy',
  float,
  title,
  className,
  style,
}: {
  kind?: MascotKind
  mood?: MascotMood
  /** Gently bob up and down. */
  float?: boolean
  title?: string
  className?: string
  style?: React.CSSProperties
}) {
  const { color, face } = BODY[kind]
  return (
    <svg
      viewBox="0 0 120 120"
      className={cn(
        'size-16 overflow-visible',
        float && 'animate-[q-float_4s_ease-in-out_infinite]',
        className,
      )}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <Body kind={kind} color={color} />
      <Face mood={mood} cx={face[0]} cy={face[1]} />
    </svg>
  )
}

const STAR = 'M0-7C1-1.6 1.6-1 7 0C1.6 1 1-1.6 0 7C-1 1.6-1.6 1-7 0C-1.6-1-1 1.6 0-7Z'

// [left %, top %, size px, color]; stars twinkle, dots stay put.
const STARS: [number, number, number, string][] = [
  [16, 20, 14, '#f2b84b'],
  [80, 10, 11, '#cfc6bb'],
  [92, 60, 15, '#f2b84b'],
  [6, 66, 11, '#cfc6bb'],
  [56, 92, 12, '#f2b84b'],
]
const DOTS: [number, number, string][] = [
  [38, 6, '#f08fb0'],
  [97, 32, '#e98a5a'],
  [28, 90, '#f08fb0'],
  [76, 86, '#e98a5a'],
]

/** Scattered stars and dots that fill the nearest positioned ancestor, for behind a mascot. */
export function Sparkles({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0', className)}>
      {STARS.map(([x, y, size, color], i) => (
        <svg
          key={`${x}-${y}`}
          viewBox="-7 -7 14 14"
          className="absolute -translate-x-1/2 -translate-y-1/2 animate-[q-twinkle_3s_ease-in-out_infinite]"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: size,
            height: size,
            animationDelay: `${i * 0.6}s`,
          }}
        >
          <path d={STAR} fill={color} />
        </svg>
      ))}
      {DOTS.map(([x, y, color]) => (
        <span
          key={`${x}-${y}`}
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${x}%`, top: `${y}%`, background: color }}
        />
      ))}
    </span>
  )
}
