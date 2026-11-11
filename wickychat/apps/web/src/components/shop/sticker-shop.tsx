'use client'
/** WickyChat: sticker packs in the Shop: buy, gift, make your own, and (teachers) review. */
import {
  type Attachment,
  CREATOR_SHARE,
  STICKER_PACK,
  type StickerPack,
  type Wallet,
} from '@quid/shared'
import { Button, cn, Dialog, DialogContent, DialogFooter, Input, Skeleton, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Gift, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { StickerView, useStickerPacks } from '@/components/chat/stickers'
import { PeoplePicker } from '@/components/dialogs/people-picker'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, post, upload } from '@/lib/api'
import { displayName } from '@/lib/format'

function PackCard({ p, children }: { p: StickerPack; children?: React.ReactNode }) {
  return (
    <li className="flex flex-col rounded-xl border border-border p-3">
      <div
        className="grid grid-cols-4 gap-1 rounded-lg p-2"
        style={{
          background: p.colors
            ? `linear-gradient(135deg, ${p.colors[0]}22, ${p.colors[1]}22)`
            : 'var(--q-bg-muted)',
        }}
      >
        {p.stickers.slice(0, 8).map((st) => (
          <div key={st.key} className="flex items-center justify-center" title={st.name}>
            <StickerView sticker={st} size={52} colors={p.colors} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[14px] font-semibold">{p.name}</p>
      <p className="text-xs text-fg-muted">{p.description || `${p.stickers.length} stickers`}</p>
      {p.creator && (
        <p className="text-2xs text-fg-subtle">
          by {displayName(p.creator)}
          {p.sales != null && ` · ${p.sales} sold`}
        </p>
      )}
      <div className="mt-auto pt-3">{children}</div>
    </li>
  )
}

export function StickersView({ wallet }: { wallet: Wallet | undefined }) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const teacher = org.role === 'owner' || org.role === 'admin'
  const packs = useStickerPacks('shop')
  const mine = useStickerPacks('mine')
  const review = useStickerPacks('review', teacher)
  const [busy, setBusy] = useState<string | null>(null)
  const [gift, setGift] = useState<StickerPack | null>(null)
  const [to, setTo] = useState<string[]>([])
  const [making, setMaking] = useState(false)

  const buy = async (p: StickerPack, giftTo?: string) => {
    setBusy(p.key)
    try {
      const r = await post<{ packs: StickerPack[]; wallet: Wallet }>(
        `${api}/sticker-packs/${encodeURIComponent(p.key)}/buy`,
        giftTo ? { giftTo } : {},
      )
      qc.setQueryData(['sticker-packs', org.id, 'shop'], r.packs)
      qc.setQueryData(['wallet'], r.wallet)
      toast.success(giftTo ? `Sent ${p.name} 🎁` : `${p.name} is yours! Find it in the 🖼️ button.`)
      setGift(null)
      setTo([])
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const decide = async (p: StickerPack, approve: boolean) => {
    setBusy(p.key)
    try {
      qc.setQueryData(
        ['sticker-packs', org.id, 'review'],
        await post<StickerPack[]>(`${api}/sticker-packs/${p.key}/review`, { approve }),
      )
      void qc.invalidateQueries({ queryKey: ['sticker-packs', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (!packs.data) return <Skeleton className="h-60" />
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[13px] text-fg-muted">
          Send big stickers in any chat with the 🖼️ button. Wicky Basics is free for everyone.
        </p>
        <Button variant="primary" onClick={() => setMaking(true)}>
          <Upload /> Make a sticker pack
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {packs.data.map((p) => (
          <PackCard key={p.key} p={p}>
            <div className="flex gap-1.5">
              {p.owned ? (
                <Button size="sm" className="flex-1" disabled>
                  {p.price ? 'Owned ✓' : 'Free for everyone ✓'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  className="flex-1 tabular-nums"
                  disabled={(wallet?.coins ?? 0) < p.price}
                  loading={busy === p.key}
                  onClick={() => buy(p)}
                >
                  🪙 {p.price}
                </Button>
              )}
              {p.price > 0 && (
                <Button size="sm" aria-label={`Gift ${p.name}`} onClick={() => setGift(p)}>
                  <Gift />
                </Button>
              )}
            </div>
          </PackCard>
        ))}
      </ul>

      {!!mine.data?.length && (
        <section className="mt-8">
          <h3 className="mb-3 text-[14px] font-semibold">Your sticker packs</h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.data.map((p) => (
              <PackCard key={p.key} p={p}>
                <p
                  className={cn(
                    'text-xs font-medium',
                    p.status === 'approved'
                      ? 'text-success'
                      : p.status === 'rejected'
                        ? 'text-danger'
                        : 'text-warning',
                  )}
                >
                  {p.status === 'approved'
                    ? `✅ In the Shop for 🪙 ${p.price}`
                    : p.status === 'rejected'
                      ? `❌ Not approved${p.reviewNote ? `: ${p.reviewNote}` : ''}`
                      : '⏳ Waiting for a teacher'}
                </p>
              </PackCard>
            ))}
          </ul>
        </section>
      )}

      {teacher && !!review.data?.length && (
        <section className="mt-8">
          <h3 className="mb-3 text-[14px] font-semibold">🍎 Sticker packs to review</h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {review.data.map((p) => (
              <PackCard key={p.key} p={p}>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    className="flex-1"
                    loading={busy === p.key}
                    onClick={() => decide(p, true)}
                  >
                    Approve
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => decide(p, false)}>
                    Reject
                  </Button>
                </div>
              </PackCard>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={!!gift} onOpenChange={(o) => !o && setGift(null)}>
        <DialogContent
          title={`Gift ${gift?.name ?? ''}`}
          description={`Pick who gets it. You pay 🪙 ${gift?.price ?? 0}.`}
        >
          <PeoplePicker value={to} onChange={(ids) => setTo(ids.slice(-1))} autoFocus />
          <DialogFooter>
            <Button onClick={() => setGift(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!to[0]}
              loading={busy === gift?.key}
              onClick={() => gift && to[0] && buy(gift, to[0])}
            >
              <Gift /> Send gift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {making && <MakePack onClose={() => setMaking(false)} />}
    </div>
  )
}

function MakePack({ onClose }: { onClose: () => void }) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(50)
  const [items, setItems] = useState<{ fileId: string; url: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)

  const add = async (list: File[]) => {
    setUploading(true)
    try {
      for (const f of list.slice(0, STICKER_PACK.maxStickers - items.length)) {
        const a = await upload<Attachment>(`${api}/files?purpose=cosmetic`, f).promise
        setItems((cur) => [
          ...cur,
          {
            fileId: a.id,
            url: URL.createObjectURL(f),
            name: f.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Sticker',
          },
        ])
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    try {
      const mine = await post<StickerPack[]>(`${api}/sticker-packs`, {
        name,
        description,
        price,
        stickers: items.map((i) => ({ fileId: i.fileId, name: i.name })),
      })
      qc.setQueryData(['sticker-packs', org.id, 'mine'], mine)
      toast.success('Sent to a teacher for review. ✨')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Make a sticker pack"
        description={`${STICKER_PACK.minStickers}–${STICKER_PACK.maxStickers} images (PNG, GIF or WebP; transparent works best). A teacher checks it first. You get ${Math.round(CREATOR_SHARE * 100)}% of every sale.`}
        className="max-w-lg"
      >
        <div className="flex flex-col gap-2">
          <Input
            placeholder="Pack name"
            aria-label="Pack name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Short description (optional)"
            aria-label="Description"
            maxLength={140}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex items-center gap-2 text-[13px]">
            Price 🪙
            <Input
              type="number"
              aria-label="Price"
              min={STICKER_PACK.price.min}
              max={STICKER_PACK.price.max}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              className="w-24"
            />
          </div>
          <ul className="grid grid-cols-4 gap-2">
            {items.map((it, i) => (
              <li key={it.fileId} className="relative rounded-lg border border-border p-1">
                <img src={it.url} alt="" className="mx-auto size-16 object-contain" />
                <Input
                  aria-label="Sticker name"
                  value={it.name}
                  maxLength={30}
                  onChange={(e) =>
                    setItems((cur) =>
                      cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  className="mt-1 h-7 text-2xs"
                />
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}
                  className="absolute top-0.5 right-0.5 rounded-full bg-bg-overlay p-0.5"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
            {items.length < STICKER_PACK.maxStickers && (
              <li>
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  disabled={uploading}
                  className="flex h-full min-h-24 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border text-2xs text-fg-subtle hover:bg-bg-muted"
                >
                  <Upload className="mb-1 size-4" />
                  {uploading ? 'Uploading…' : 'Add images'}
                </button>
              </li>
            )}
          </ul>
          <input
            ref={input}
            type="file"
            accept="image/png,image/gif,image/webp,image/jpeg"
            multiple
            hidden
            onChange={(e) => {
              void add([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              name.trim().length < 2 ||
              items.length < STICKER_PACK.minStickers ||
              price < STICKER_PACK.price.min
            }
            onClick={submit}
          >
            Send for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
