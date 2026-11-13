/**
 * WickyChat: draws profile effects (animated overlay on the card) and name plates (animated
 * background behind a name). Values are Shop item ids (`e-snow`, `p-ocean`) or student-made
 * ones (`u:<id>|i:<image file id>`).
 */
import { bubbleById, customImageFile, effectById } from '@quid/shared'
import { LiveLayer } from './live-layer'

const CONFETTI = ['#ff5c8a', '#ffd23f', '#3bceac', '#5b6ee8', '#ff8c42']

/** Small fixed "random" numbers so every card looks the same on every render. */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

const fileUrl = (id: string) => `/api/files/${id}/content?inline=1`

export function ProfileEffect({ value }: { value?: string | null }) {
  if (!value) return null
  const img = customImageFile(value)
  if (img)
    return (
      <div className="q-fx" aria-hidden="true">
        {/* biome-ignore lint/performance/noImgElement: animated GIF/WebP overlays need a plain img */}
        <img src={fileUrl(img)} alt="" />
        <LiveLayer kind="effect" value={value} front pad={0} />
      </div>
    )
  const fx = effectById(value)
  if (!fx) return null
  const name = fx.id.slice(2)
  const count = name === 'stars' ? 5 : name === 'emorain' ? 25 : 14
  return (
    <div
      className={`q-fx q-fx-${name}${fx.motion ? ` q-fx-m-${fx.motion}` : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list of particles
          key={i}
          style={
            {
              '--x': `${Math.round(rand(i, 1) * 95)}%`,
              '--y': `${Math.round(rand(i, 2) * 85)}%`,
              '--d': `${(rand(i, 3) * (name === 'stars' ? 6 : 5)).toFixed(2)}s`,
              '--t': `${(name === 'stars' ? 3 : 5) + rand(i, 4) * 4}s`,
              '--s': `${10 + Math.round(rand(i, 5) * 10)}px`,
              '--c': CONFETTI[i % CONFETTI.length],
            } as React.CSSProperties
          }
        >
          {fx.particles ? fx.particles[i % fx.particles.length] : fx.particle}
        </span>
      ))}
    </div>
  )
}

/**
 * The animated background behind a name. Put it inside an element with
 * `relative isolate overflow-hidden`.
 */
export function NamePlate({ value }: { value?: string | null }) {
  if (!value) return null
  const img = customImageFile(value)
  if (img)
    return (
      <span
        aria-hidden="true"
        className="q-plate q-plate-img"
        style={{ backgroundImage: `url("${fileUrl(img)}")` }}
      >
        <LiveLayer kind="plate" value={value} pad={0} className="q-live-front" />
      </span>
    )
  if (!/^p-[a-z]+$/.test(value)) return null
  return <span aria-hidden="true" className={`q-plate q-plate-${value.slice(2)}`} />
}

export function bubbleClass(value?: string | null) {
  const b = bubbleById(value)
  return b ? `q-bubble q-bubble-${b.id.slice(2)}` : ''
}
