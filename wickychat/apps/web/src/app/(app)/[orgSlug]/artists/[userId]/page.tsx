'use client'
import type { ArtistPage, ArtistsPage, Wallet } from '@quid/shared'
import { Avatar, Button, cn, EmptyState, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Heart, Palette } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { RequestDialog } from '@/components/shop/artists'
import { useStocks } from '@/components/shop/invest'
import {
  BUILTIN_ITEMS,
  cosmeticItem,
  ItemPreview,
  ItemTags,
  KIND_LABEL,
  type ShopItem,
} from '@/components/shop/items'
import { errorMessage, get, post } from '@/lib/api'
import { displayName } from '@/lib/format'

export default function ArtistProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const { api, org, me, base } = useOrgContext()
  const qc = useQueryClient()
  const key = ['artist-page', org.id, userId]
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<ArtistPage>(`${api}/artists/${userId}/page`, signal),
  })
  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: ({ signal }) => get<Wallet>('/api/me/wallet', signal),
  })
  const stocks = useStocks()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const price = useMemo(() => {
    const now = new Map((stocks.data ?? []).map((s) => [s.key, s.price]))
    return (it: ShopItem) => now.get(it.itemId) ?? it.price
  }, [stocks.data])

  const d = q.data
  const owned = new Set(wallet.data?.owned ?? [])
  const mine = userId === me.id

  const follow = async () => {
    if (!d) return
    const next = !d.artist.following
    setBusy('follow')
    qc.setQueryData<ArtistPage>(key, {
      ...d,
      artist: { ...d.artist, following: next, followers: d.artist.followers + (next ? 1 : -1) },
    })
    try {
      const artist = await post<ArtistPage['artist']>(`${api}/artists/${userId}/follow`, {
        follow: next,
      })
      qc.setQueryData<ArtistPage>(key, (p) => (p ? { ...p, artist } : p))
      void qc.invalidateQueries({ queryKey: ['artists', org.id] })
      if (next)
        toast.success(`Following ${displayName(d.artist.user)}. You'll hear about new drops!`)
    } catch (e) {
      qc.setQueryData<ArtistPage>(key, d)
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const buy = async (it: ShopItem) => {
    setBusy(it.itemId)
    try {
      const w = await post<Wallet>(`/api/me/shop/${encodeURIComponent(it.itemId)}/buy`, {})
      qc.setQueryData(['wallet'], w)
      void qc.invalidateQueries({ queryKey: key })
      toast.success(`${it.name} is yours! ✨`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const card = (it: ShopItem, big = false) => {
    const has = owned.has(it.itemId)
    const cost = price(it)
    const soldOut = it.stock != null && (it.sales ?? 0) >= it.stock
    return (
      <li
        key={it.itemId}
        className={cn(
          'flex flex-col items-center gap-1 rounded-xl border p-3 text-center',
          big ? 'border-[#ff7a00]/50 bg-[#ff7a00]/5' : 'border-border',
        )}
      >
        <ItemPreview it={it} compact={!big} />
        <p className="truncate text-[13px] font-semibold">{it.name}</p>
        <p className="text-2xs text-fg-subtle">{KIND_LABEL[it.kind]}</p>
        <ItemTags it={it} />
        {mine ? (
          <p className="mt-auto pt-1 text-2xs text-fg-subtle">{it.sales ?? 0} sold</p>
        ) : (
          <Button
            size="sm"
            variant={has ? 'ghost' : 'primary'}
            className="mt-auto w-full"
            disabled={has || soldOut}
            loading={busy === it.itemId}
            onClick={() => void buy(it)}
          >
            {has ? 'Owned' : soldOut ? 'Sold out' : `🪙 ${cost}`}
          </Button>
        )}
      </li>
    )
  }

  const works = (d?.works ?? []).map(cosmeticItem)
  const featured = (d?.featured ?? [])
    .map((id) => works.find((w) => w.itemId === `u:${id}`))
    .filter((w): w is ShopItem => !!w)
  const rest = works.filter((w) => !featured.includes(w))
  const official = BUILTIN_ITEMS.filter((it) => d?.official.includes(it.itemId))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Artist" icon={<Palette />}>
        <div className="px-3 pb-2 md:px-6">
          <Link
            href={`${base}/shop?tab=artists`}
            className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> All artists
          </Link>
        </div>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isError ? (
          <EmptyState
            icon={<Palette />}
            title="Artist not found"
            description="They might not be a Official Artist anymore."
          />
        ) : !d ? (
          <div className="mx-auto max-w-4xl p-6">
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-8 p-4 md:p-6">
            <section className="flex flex-col gap-4 rounded-xl border border-border bg-gradient-to-br from-[#ff7a00]/10 to-[#8052ff]/10 p-5 sm:flex-row sm:items-center">
              <Avatar
                name={d.artist.user.name}
                id={d.artist.user.id}
                src={d.artist.user.avatarUrl}
                decoration={d.artist.user.decoration}
                size="xl"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[20px] font-bold">{displayName(d.artist.user)}</p>
                <p className="text-xs font-semibold text-[#c2410c]">
                  🎨 Official Artist
                  {d.artist.status !== 'approved' && ' (not approved yet)'}
                </p>
                {d.artist.bio && (
                  <p className="mt-2 text-[13px] whitespace-pre-wrap text-fg-muted">
                    {d.artist.bio}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-fg-muted">
                  <span>
                    <b className="text-fg">{d.artist.followers}</b>{' '}
                    {d.artist.followers === 1 ? 'follower' : 'followers'}
                  </span>
                  <span>
                    <b className="text-fg">{works.length}</b> in the Shop
                  </span>
                  <span>
                    <b className="text-fg">{d.sales}</b> sold
                  </span>
                  <span>
                    <b className="text-fg">{d.artist.delivered}</b> requests delivered
                  </span>
                </div>
              </div>
              {!mine && (
                <div className="flex shrink-0 flex-col gap-2 sm:w-40">
                  <Button
                    variant={d.artist.following ? 'secondary' : 'primary'}
                    loading={busy === 'follow'}
                    onClick={() => void follow()}
                  >
                    <Heart className={cn(d.artist.following && 'fill-current')} />
                    {d.artist.following ? 'Following' : 'Follow'}
                  </Button>
                  <Button disabled={!d.artist.open} onClick={() => setAsking(true)}>
                    <Palette />
                    {d.artist.open ? `Request from 🪙 ${d.artist.minPrice}` : 'Not taking requests'}
                  </Button>
                </div>
              )}
              {mine && (
                <Link
                  href={`${base}/shop?tab=artists`}
                  className="shrink-0 text-xs font-medium text-accent-text hover:underline"
                >
                  Edit your artist profile
                </Link>
              )}
            </section>

            {featured.length > 0 && (
              <section>
                <h3 className="mb-3 text-[14px] font-semibold">⭐ Featured</h3>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {featured.map((it) => card(it, true))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-3 text-[14px] font-semibold">
                {featured.length ? 'More from this artist' : 'Their work'}
              </h3>
              {!rest.length && !featured.length ? (
                <p className="text-[13px] text-fg-subtle">
                  {mine
                    ? 'Nothing in the Shop yet. Make something in Create and once a teacher approves it, it shows up here.'
                    : "Nothing in the Shop yet. Follow them and you'll get told when there first drop comes out!"}
                </p>
              ) : rest.length ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {rest.map((it) => card(it))}
                </ul>
              ) : null}
            </section>

            {official.length > 0 && (
              <section>
                <h3 className="mb-3 text-[14px] font-semibold">🏫 Made for WickyChat</h3>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {official.map((it) => card(it))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
      {asking && d && (
        <RequestDialog
          artist={d.artist}
          wallet={wallet.data}
          onClose={() => setAsking(false)}
          onDone={(p: ArtistsPage) => {
            qc.setQueryData(['artists', org.id], p)
            setAsking(false)
          }}
        />
      )}
    </div>
  )
}
