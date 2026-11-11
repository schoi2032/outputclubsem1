'use client'
import { Avatar, cn } from '@quid/ui'
import type { Track } from 'livekit-client'
import { MicOff, MonitorUp, Pin, PinOff } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { TileInfo } from './use-meeting-room'

function VideoTrackView({
  track,
  mirror,
  contain,
}: {
  track: Track
  mirror: boolean
  contain: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        'size-full',
        contain ? 'object-contain' : 'object-cover',
        mirror && '-scale-x-100',
      )}
    />
  )
}

export function Tile({
  t,
  pinned,
  onPin,
  large,
}: {
  t: TileInfo
  pinned?: boolean
  onPin?: () => void
  large?: boolean
}) {
  const track = t.publication?.track
  const showVideo = !!track && !t.publication?.isMuted
  const name = t.isLocal ? `${t.participant.name || 'You'} (you)` : t.participant.name || 'Guest'
  return (
    <div
      className={cn(
        'group relative flex size-full min-h-0 items-center justify-center overflow-hidden rounded-xl bg-[#1f1f23] ring-2 ring-transparent transition-shadow',
        t.speaking && 'ring-success',
      )}
    >
      {showVideo ? (
        <VideoTrackView
          track={track!}
          mirror={t.isLocal && t.kind === 'camera'}
          contain={t.kind === 'screen'}
        />
      ) : (
        <Avatar
          name={t.participant.name || '?'}
          id={t.participant.identity}
          size={large ? 'xl' : 'lg'}
          className={
            large ? '[&>span]:size-24 [&>span]:text-3xl' : '[&>span]:size-14 [&>span]:text-lg'
          }
        />
      )}
      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
        {t.kind === 'screen' ? (
          <MonitorUp className="size-3.5 shrink-0" />
        ) : t.micMuted ? (
          <MicOff className="size-3.5 shrink-0 text-red-400" />
        ) : null}
        <span className="truncate">{t.kind === 'screen' ? `${name}'s screen` : name}</span>
      </div>
      {onPin && (
        <button
          type="button"
          onClick={onPin}
          aria-label={pinned ? 'Unpin' : 'Pin to main view'}
          className="absolute top-2 right-2 hidden rounded-md bg-black/55 p-1.5 text-white group-hover:block focus-visible:block"
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
      )}
    </div>
  )
}

/** Columns for a balanced gallery grid. */
function columns(n: number) {
  if (n <= 1) return 1
  if (n <= 4) return 2
  if (n <= 9) return 3
  if (n <= 16) return 4
  return 5
}

export function Stage({
  tiles,
  layout,
  pinned,
  onPin,
}: {
  tiles: TileInfo[]
  layout: 'gallery' | 'speaker'
  pinned: string | null
  onPin: (key: string | null) => void
}) {
  // A screen share or a pinned tile always takes the main view.
  const screen = tiles.find((t) => t.kind === 'screen')
  const main =
    tiles.find((t) => t.key === pinned) ??
    screen ??
    (layout === 'speaker'
      ? (tiles.find((t) => t.speaking && !t.isLocal) ?? tiles.find((t) => !t.isLocal) ?? tiles[0])
      : undefined)

  if (!main) {
    const cols = columns(tiles.length)
    return (
      <div
        className="grid size-full auto-rows-fr gap-2 p-2 md:gap-3 md:p-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {tiles.map((t) => (
          <Tile key={t.key} t={t} onPin={() => onPin(t.key)} />
        ))}
      </div>
    )
  }

  const rest = tiles.filter((t) => t.key !== main.key)
  return (
    <div className="flex size-full min-h-0 flex-col gap-2 p-2 md:flex-row md:gap-3 md:p-3">
      <div className="min-h-0 flex-1">
        <Tile
          t={main}
          large
          pinned={pinned === main.key}
          onPin={() => onPin(pinned === main.key ? null : main.key)}
        />
      </div>
      {rest.length > 0 && (
        <div className="flex h-28 shrink-0 gap-2 overflow-x-auto md:h-auto md:w-56 md:flex-col md:overflow-y-auto">
          {rest.map((t) => (
            <div key={t.key} className="aspect-video h-full shrink-0 md:h-auto md:w-full">
              <Tile t={t} onPin={() => onPin(t.key)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
