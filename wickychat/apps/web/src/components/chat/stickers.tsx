'use client'
/** WickyChat stickers: how a sticker looks, and the picker in the message box. */
import type { Channel, Sticker, StickerPack } from '@quid/shared'
import { cn, IconButton, Popover, PopoverContent, PopoverTrigger, Tooltip, toast } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { Sticker as StickerIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { errorMessage, get, post } from '@/lib/api'
import { useOrgContext } from '../org-context'

export function useStickerPacks(view: 'shop' | 'mine' | 'review' = 'shop', enabled = true) {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: ['sticker-packs', org.id, view],
    queryFn: ({ signal }) => get<StickerPack[]>(`${api}/sticker-packs?view=${view}`, signal),
    staleTime: 60_000,
    enabled,
  })
}

export function StickerView({
  sticker,
  size = 128,
  colors,
}: {
  sticker: Sticker
  size?: number
  colors?: [string, string]
}) {
  if (sticker.url)
    return (
      <img
        src={sticker.url}
        alt={sticker.name}
        width={size}
        height={size}
        className="object-contain"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    )
  return (
    <div
      role="img"
      aria-label={sticker.name}
      className="q-sticker relative flex flex-col items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span style={{ fontSize: size * 0.5, lineHeight: 1 }} aria-hidden="true">
        {sticker.emoji}
      </span>
      {sticker.text && (
        <span
          className="q-sticker-text mt-1 rounded-md px-1.5 text-center font-black text-white uppercase"
          style={{
            fontSize: Math.max(9, size * 0.13),
            background: colors
              ? `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`
              : 'linear-gradient(135deg, #8052ff, #e0457b)',
          }}
          aria-hidden="true"
        >
          {sticker.text}
        </span>
      )}
    </div>
  )
}

export function StickerButton({
  channel,
  parentId,
}: {
  channel: Channel
  parentId?: string | null
}) {
  const { api, base } = useOrgContext()
  const [open, setOpen] = useState(false)
  const packs = useStickerPacks('shop', open)
  const mine = (packs.data ?? []).filter((p) => p.owned)
  const [tab, setTab] = useState(0)
  const pack = mine[Math.min(tab, mine.length - 1)]

  const send = async (key: string) => {
    setOpen(false)
    try {
      await post(`${api}/channels/${channel.id}/stickers`, { key, parentId: parentId ?? null })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Stickers">
        <PopoverTrigger asChild>
          <IconButton label="Stickers" size="sm">
            <StickerIcon />
          </IconButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" align="start" className="w-[330px] p-2">
        {!packs.data ? (
          <div className="h-40 animate-pulse rounded-md bg-bg-muted" />
        ) : (
          <>
            <div className="mb-2 flex gap-1 overflow-x-auto">
              {mine.map((p, i) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setTab(i)}
                  className={cn(
                    'shrink-0 rounded-md px-2 py-1 text-xs font-medium',
                    p === pack ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-muted',
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {pack && (
              <ul className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto">
                {pack.stickers.map((st) => (
                  <li key={st.key}>
                    <button
                      type="button"
                      title={st.name}
                      onClick={() => send(st.key)}
                      className="flex w-full items-center justify-center rounded-md p-1 hover:bg-bg-muted"
                    >
                      <StickerView sticker={st} size={64} colors={pack.colors} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`${base}/shop?tab=stickers`}
              onClick={() => setOpen(false)}
              className="mt-2 block text-center text-2xs text-accent-text hover:underline"
            >
              Get more sticker packs in the Shop →
            </Link>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** React to a message with one of your stickers. */
export function StickerReactPicker({
  onPick,
  open,
  onOpenChange,
}: {
  onPick: (reaction: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const packs = useStickerPacks('shop', open)
  const mine = (packs.data ?? []).filter((p) => p.owned)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip content="React with a sticker">
        <PopoverTrigger asChild>
          <IconButton label="React with a sticker" size="sm" className="size-7">
            <StickerIcon />
          </IconButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" align="end" className="w-[300px] p-2">
        {!packs.data ? (
          <div className="h-32 animate-pulse rounded-md bg-bg-muted" />
        ) : (
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {mine.map((p) => (
              <div key={p.key}>
                <p className="mb-1 text-2xs font-semibold text-fg-subtle uppercase">{p.name}</p>
                <div className="grid grid-cols-6 gap-1">
                  {p.stickers.map((st) => (
                    <button
                      key={st.key}
                      type="button"
                      title={st.name}
                      onClick={() => {
                        onPick(`sticker:${st.key}`)
                        onOpenChange(false)
                      }}
                      className="flex items-center justify-center rounded-md p-0.5 hover:bg-bg-muted"
                    >
                      <StickerView sticker={st} size={38} colors={p.colors} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
