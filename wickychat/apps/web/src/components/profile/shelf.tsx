'use client'
/** WickyChat: someone's showcase shelf and wishlist, on their profile card. */
import type { Shelf, Wallet } from '@quid/shared'
import { Button, cn, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { ItemPreview, RARITY, useCatalog } from '@/components/shop/items'
import { del, errorMessage, get, post, put } from '@/lib/api'

export function useShelf(userId: string) {
  const { api, me } = useOrgContext()
  return useQuery({
    queryKey: ['shelf', userId === me.id ? 'me' : userId],
    queryFn: ({ signal }) => get<Shelf>(`${api}/members/${userId}/shelf`, signal),
    staleTime: 30_000,
  })
}

/** Your own shelf and wishlist, with toggles for the Shop. */
export function useMyShelf() {
  const { me } = useOrgContext()
  const qc = useQueryClient()
  const shelf = useShelf(me.id)
  const save = (next: Shelf) => qc.setQueryData(['shelf', 'me'], next)
  const run = async (fn: () => Promise<Shelf>, ok?: string) => {
    try {
      save(await fn())
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const pinned = new Set(shelf.data?.showcase.map((s) => s.itemId) ?? [])
  const wanted = new Set(shelf.data?.wishlist ?? [])
  return {
    pinned,
    wanted,
    togglePin: (itemId: string) => {
      const cur = shelf.data?.showcase.map((s) => s.itemId) ?? []
      const items = pinned.has(itemId) ? cur.filter((i) => i !== itemId) : [...cur, itemId]
      return run(
        () => put<Shelf>('/api/me/showcase', { items }),
        pinned.has(itemId) ? undefined : 'Pinned to your profile shelf 📌',
      )
    },
    toggleWant: (itemId: string) =>
      run(
        () =>
          wanted.has(itemId)
            ? del<Shelf>(`/api/me/wishlist/${encodeURIComponent(itemId)}`, {})
            : post<Shelf>('/api/me/wishlist', { itemId }),
        wanted.has(itemId) ? undefined : 'Added to your wishlist 💜',
      ),
  }
}

export function ShelfBlock({ userId, name }: { userId: string; name: string }) {
  const { me } = useOrgContext()
  const qc = useQueryClient()
  const shelf = useShelf(userId)
  const catalog = useCatalog()
  const [busy, setBusy] = useState<string | null>(null)
  const show = (shelf.data?.showcase ?? []).filter((s) => catalog.has(s.itemId))
  const wants = (shelf.data?.wishlist ?? []).filter((id) => catalog.get(id)?.live !== false)
  if (!show.length && !wants.length) return null
  const mine = userId === me.id

  const gift = async (itemId: string) => {
    setBusy(itemId)
    try {
      const w = await post<Wallet>(`/api/me/shop/${encodeURIComponent(itemId)}/buy`, {
        giftTo: userId,
      })
      qc.setQueryData(['wallet'], w)
      void qc.invalidateQueries({ queryKey: ['shelf', userId] })
      toast.success(`Sent ${catalog.get(itemId)?.name ?? 'it'} to ${name} 🎁`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {show.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-2xs font-semibold text-fg-subtle uppercase">Showcase</p>
          <ul className="grid grid-cols-3 gap-1.5">
            {show.map((s) => {
              const it = catalog.get(s.itemId)!
              return (
                <li
                  key={s.itemId}
                  title={it.description}
                  className="flex min-w-0 flex-col items-center rounded-lg border border-border bg-bg-muted/40 p-1.5 text-center"
                >
                  <ItemPreview it={it} compact />
                  <p className="w-full truncate text-2xs font-semibold">{it.name}</p>
                  <span
                    className={cn(
                      'mt-0.5 rounded-full px-1.5 text-[10px] font-semibold',
                      RARITY[it.rarity].className,
                    )}
                  >
                    {s.serial ? `#${String(s.serial).padStart(3, '0')}` : RARITY[it.rarity].label}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {wants.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-2xs font-semibold text-fg-subtle uppercase">Wishlist</p>
          <ul className="flex flex-col gap-1">
            {wants.slice(0, 6).map((id) => {
              const it = catalog.get(id)!
              const canGift = !mine && it.visibility !== 'private' && it.live
              return (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-md border border-border bg-bg-muted/40 px-2 py-1 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {canGift ? (
                    <Button
                      size="sm"
                      title={`Gift it to ${name}`}
                      loading={busy === id}
                      onClick={() => gift(id)}
                    >
                      <Gift /> 🪙 {it.price}
                    </Button>
                  ) : (
                    <span className="text-2xs text-fg-subtle tabular-nums">🪙 {it.price}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
