'use client'
import type { CustomEmoji } from '@quid/shared'
import { Popover, PopoverContent, PopoverTrigger } from '@quid/ui'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useCustomEmojis } from '@/lib/expressions'
import { useOrgContext } from '../org-context'
import { CustomEmojiImg } from './custom-emoji'
import { ALL_EMOJI, EMOJI_GROUPS } from './emoji'

type Item = { value: string; label: string; custom?: CustomEmoji }

const toItems = (list: [string, string][]): Item[] =>
  list.map(([e, words]) => ({ value: e, label: words.split(' ')[0]! }))

export function EmojiPicker({
  onPick,
  children,
  side = 'top',
  align = 'end',
  open,
  onOpenChange,
}: {
  onPick: (emoji: string) => void
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'end' | 'center'
  open?: boolean
  onOpenChange?: (o: boolean) => void
}) {
  const { base, org } = useOrgContext()
  const [q, setQ] = useState('')
  const [innerOpen, setInnerOpen] = useState(false)
  const isOpen = open ?? innerOpen
  const setOpen = onOpenChange ?? setInnerOpen
  const customs = useCustomEmojis().data
  const custom = useMemo<Item[]>(
    () => (customs ?? []).map((c) => ({ value: `:${c.name}:`, label: `:${c.name}:`, custom: c })),
    [customs],
  )
  const results = useMemo(() => {
    const n = q.trim().toLowerCase().replace(/:/g, '')
    if (!n) return null
    return [
      ...custom.filter((c) => c.custom!.name.includes(n)),
      ...toItems(ALL_EMOJI.filter(([, words]) => words.includes(n))),
    ]
  }, [q, custom])
  const groups = useMemo(
    () => [
      ...(custom.length ? [{ name: org.name, items: custom }] : []),
      ...EMOJI_GROUPS.map((g) => ({ name: g.name, items: toItems(g.emoji) })),
    ],
    [custom, org.name],
  )

  const pick = (e: string) => {
    onPick(e)
    setOpen(false)
    setQ('')
  }

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-[300px] p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <input
          autoFocus
          aria-label="Search emoji"
          placeholder="Search emoji"
          className="mb-2 h-8 w-full rounded-md border border-border bg-bg px-2 text-[13px] outline-none focus:border-accent"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) pick(results[0].value)
          }}
        />
        <div className="max-h-64 overflow-y-auto">
          {(results ? [{ name: 'Results', items: results }] : groups).map((g) => (
            <div key={g.name} className="mb-1.5">
              <p className="truncate px-1 pb-1 text-2xs font-medium text-fg-subtle">{g.name}</p>
              <div className="grid grid-cols-8">
                {g.items.map((it) => (
                  <button
                    key={it.value}
                    type="button"
                    title={it.label}
                    aria-label={it.label}
                    onClick={() => pick(it.value)}
                    className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-bg-muted"
                  >
                    {it.custom ? (
                      <CustomEmojiImg emoji={it.custom} className="size-6 max-w-none" />
                    ) : (
                      it.value
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {results && results.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-fg-subtle">No emoji found</p>
          )}
        </div>
        {org.role !== 'guest' && (
          <Link
            href={`${base}/settings/expressions`}
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-1.5 rounded-md border-t border-border px-1 pt-2 text-xs text-fg-muted hover:text-fg"
          >
            <Plus className="size-3.5" /> Add custom emoji
          </Link>
        )}
      </PopoverContent>
    </Popover>
  )
}
