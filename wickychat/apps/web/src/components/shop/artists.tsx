'use client'
/**
 * WickyChat official artists: browse artists, request custom profile art (coins are held until
 * it's delivered), handle requests if you're an artist, and (teachers) approve artists.
 */
import {
  ARTIST,
  type Artist,
  type ArtistsPage,
  type Commission,
  type CommissionKind,
  type Cosmetic,
  type Wallet,
} from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Input,
  Select,
  Skeleton,
  Textarea,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Palette } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, get, post } from '@/lib/api'
import { displayName, relative } from '@/lib/format'

const KIND: Record<CommissionKind, string> = {
  decoration: 'Avatar decoration',
  effect: 'Profile effect',
  plate: 'Name plate',
  bubble: 'Chat bubble',
  name_effect: 'Name effect',
  message_effect: 'Message effect',
  typing: 'Typing indicator',
  reaction_skin: 'Reaction skin',
  mention_style: 'Mention style',
  sound_pack: 'Sound pack',
  theme: 'App theme',
}
const STATUS: Record<Commission['status'], { label: string; className: string }> = {
  requested: { label: '⏳ Waiting for the artist', className: 'text-warning' },
  accepted: { label: '🎨 In progress', className: 'text-accent-text' },
  delivered: { label: '✅ Delivered', className: 'text-success' },
  declined: { label: '❌ Declined (coins back)', className: 'text-fg-subtle' },
  cancelled: { label: 'Cancelled (coins back)', className: 'text-fg-subtle' },
}

export function useArtists() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: ['artists', org.id],
    queryFn: ({ signal }) => get<ArtistsPage>(`${api}/artists`, signal),
    staleTime: 30_000,
  })
}

export function ArtistsView({ wallet, preset }: { wallet: Wallet | undefined; preset?: string }) {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const q = useArtists()
  const [asking, setAsking] = useState<Artist | null>(null)
  const [delivering, setDelivering] = useState<Commission | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const teacher = org.role === 'owner' || org.role === 'admin'
  const d = q.data
  const set = (p: ArtistsPage) => qc.setQueryData(['artists', org.id], p)

  const act = async (key: string, path: string, body: object = {}, ok?: string) => {
    setBusy(key)
    try {
      set(await post<ArtistsPage>(`${api}/${path}`, body))
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (!d) return <Skeleton className="h-60" />
  const approved = d.me?.status === 'approved'
  const presetArtist = preset ? d.artists.find((a) => a.user.id === preset) : undefined

  const card = (a: Artist) => (
    <li
      key={a.user.id}
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4',
        a.user.id === presetArtist?.user.id ? 'border-accent bg-accent-subtle' : 'border-border',
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar
          name={a.user.name}
          id={a.user.id}
          src={a.user.avatarUrl}
          decoration={a.user.decoration}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{displayName(a.user)}</p>
          <p className="text-2xs font-semibold text-[#c2410c]">🎨 Official Artist</p>
          <p className="text-2xs text-fg-subtle">
            {a.delivered} delivered · {a.open ? `from 🪙 ${a.minPrice}` : 'not taking requests'}
          </p>
        </div>
      </div>
      {a.bio && <p className="text-xs whitespace-pre-wrap text-fg-muted">{a.bio}</p>}
      <div className="mt-auto flex gap-1.5">
        <Button
          size="sm"
          variant="primary"
          className="flex-1"
          disabled={!a.open || a.user.id === me.id}
          onClick={() => setAsking(a)}
        >
          <Palette /> Request art
        </Button>
        {teacher && (
          <Button
            size="sm"
            loading={busy === `revoke:${a.user.id}`}
            onClick={() =>
              act(`revoke:${a.user.id}`, `artists/${a.user.id}/review`, { decision: 'revoked' })
            }
          >
            Remove
          </Button>
        )}
      </div>
    </li>
  )

  const commissionRow = (c: Commission, side: 'sent' | 'received') => {
    const other = side === 'sent' ? c.artist : c.requester
    const late =
      c.status === 'accepted' &&
      c.acceptedAt &&
      Date.now() - new Date(c.acceptedAt).getTime() > ARTIST.deliverDays * 86_400_000
    return (
      <li
        key={c.id}
        className="flex flex-col gap-1.5 rounded-lg border border-border p-3 text-[13px]"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Avatar name={other.name} id={other.id} src={other.avatarUrl} size="xs" />
          <span className="font-semibold">{displayName(other)}</span>
          <span className="text-fg-subtle">
            · {KIND[c.kind]} · 🪙 {c.offer}
          </span>
          <span className="ml-auto text-2xs text-fg-subtle">{relative(c.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap text-fg-muted">{c.description}</p>
        {c.note && <p className="text-xs text-fg-subtle">💬 {c.note}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('text-xs font-medium', STATUS[c.status].className)}>
            {STATUS[c.status].label}
          </span>
          <div className="ml-auto flex gap-1.5">
            {side === 'received' && c.status === 'requested' && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === `accept:${c.id}`}
                  onClick={() =>
                    act(
                      `accept:${c.id}`,
                      `commissions/${c.id}/accept`,
                      {},
                      'Accepted! Make it in Create, then deliver it here.',
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  loading={busy === `decline:${c.id}`}
                  onClick={() => act(`decline:${c.id}`, `commissions/${c.id}/decline`)}
                >
                  Decline
                </Button>
              </>
            )}
            {side === 'received' && c.status === 'accepted' && (
              <Button size="sm" variant="primary" onClick={() => setDelivering(c)}>
                Deliver
              </Button>
            )}
            {side === 'sent' && (c.status === 'requested' || late) && (
              <Button
                size="sm"
                loading={busy === `cancel:${c.id}`}
                onClick={() =>
                  act(
                    `cancel:${c.id}`,
                    `commissions/${c.id}/cancel`,
                    {},
                    'Cancelled. Your coins are back.',
                  )
                }
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border border-border bg-gradient-to-br from-[#ff7a00]/10 to-[#8052ff]/10 p-4">
        <p className="text-[16px] font-bold">🎨 Official Artists</p>
        <p className="mt-1 text-[13px] text-fg-muted">
          Want a one-of-a-kind decoration, effect, name plate or theme? Ask an artist. Your offer is
          held (not paid) until they deliver. They get {Math.round(ARTIST.share * 100)}%; if they
          decline, or don't deliver within {ARTIST.deliverDays} days, you get it all back.
        </p>
      </section>

      <section>
        <h3 className="mb-3 text-[14px] font-semibold">Artists</h3>
        {!d.artists.length ? (
          <p className="text-[13px] text-fg-subtle">No official artists yet. Apply below!</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{d.artists.map(card)}</ul>
        )}
      </section>

      {approved && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold">Requests for you</h3>
          {!d.received.length ? (
            <p className="text-[13px] text-fg-subtle">No requests yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {d.received.map((c) => commissionRow(c, 'received'))}
            </ul>
          )}
        </section>
      )}

      {d.sent.length > 0 && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold">Your requests</h3>
          <ul className="flex flex-col gap-2">{d.sent.map((c) => commissionRow(c, 'sent'))}</ul>
        </section>
      )}

      <ArtistProfile
        mine={d.me}
        onSave={(body) => act('me', 'artists/me', body, d.me ? 'Saved.' : 'Sent to a teacher. 🎨')}
        busy={busy === 'me'}
      />

      {teacher && d.pending.length > 0 && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold">🍎 Artist applications</h3>
          <ul className="flex flex-col gap-2">
            {d.pending.map((a) => (
              <li
                key={a.user.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-[13px]"
              >
                <Avatar name={a.user.name} id={a.user.id} src={a.user.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{displayName(a.user)}</p>
                  <p className="text-xs text-fg-muted">{a.bio || 'No bio.'}</p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === `ok:${a.user.id}`}
                  onClick={() =>
                    act(`ok:${a.user.id}`, `artists/${a.user.id}/review`, { decision: 'approved' })
                  }
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    act(`no:${a.user.id}`, `artists/${a.user.id}/review`, { decision: 'rejected' })
                  }
                >
                  Reject
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {asking && (
        <RequestDialog
          artist={asking}
          wallet={wallet}
          onClose={() => setAsking(null)}
          onDone={set}
        />
      )}
      {delivering && (
        <DeliverDialog c={delivering} onClose={() => setDelivering(null)} onDone={set} />
      )}
    </div>
  )
}

function ArtistProfile({
  mine,
  onSave,
  busy,
}: {
  mine: Artist | null
  onSave: (body: { bio: string; open: boolean; minPrice: number }) => void
  busy: boolean
}) {
  const [bio, setBio] = useState(mine?.bio ?? '')
  const [open, setOpen] = useState(mine?.open ?? true)
  const [minPrice, setMinPrice] = useState(mine?.minPrice ?? 50)
  if (mine?.status === 'revoked') return null
  const status = mine?.status
  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="text-[14px] font-semibold">
        {status === 'approved' ? 'Your artist profile' : 'Become an Official Artist'}
      </h3>
      <p className="mt-1 mb-3 text-xs text-fg-muted">
        {status === 'pending'
          ? '⏳ Waiting for a teacher to look at your application.'
          : status === 'rejected'
            ? 'Not approved last time. You can update your bio and apply again.'
            : status === 'approved'
              ? 'This is what people see before they send you a request.'
              : 'Tell people what you make. A teacher approves artists. Tip: make a few cosmetics in Create first so they can see your style.'}
      </p>
      <Textarea
        aria-label="Artist bio"
        placeholder="I make pixel-art name plates and cozy themes…"
        maxLength={300}
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={3}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
        <span className="flex items-center gap-2">
          Requests start at 🪙
          <Input
            type="number"
            aria-label="Lowest offer"
            min={ARTIST.offer.min}
            max={ARTIST.offer.max}
            value={minPrice}
            onChange={(e) => setMinPrice(Number(e.target.value) || ARTIST.offer.min)}
            className="w-24"
          />
        </span>
        {status === 'approved' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
            Taking requests
          </label>
        )}
        <Button
          size="sm"
          variant="primary"
          className="ml-auto"
          loading={busy}
          disabled={status === 'pending' && bio === (mine?.bio ?? '')}
          onClick={() => onSave({ bio, open, minPrice })}
        >
          {status === 'approved' ? 'Save' : status === 'pending' ? 'Update application' : 'Apply'}
        </Button>
      </div>
    </section>
  )
}

function RequestDialog({
  artist,
  wallet,
  onClose,
  onDone,
}: {
  artist: Artist
  wallet: Wallet | undefined
  onClose: () => void
  onDone: (p: ArtistsPage) => void
}) {
  const { api } = useOrgContext()
  const qc = useQueryClient()
  const [kind, setKind] = useState<CommissionKind>('decoration')
  const [description, setDescription] = useState('')
  const [offer, setOffer] = useState(artist.minPrice)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      onDone(
        await post<ArtistsPage>(`${api}/commissions`, {
          artistId: artist.user.id,
          kind,
          description,
          offer,
        }),
      )
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      toast.success(`Sent to ${displayName(artist.user)}! 🪙 ${offer} is held until it's done.`)
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
        title={`Request art from ${displayName(artist.user)}`}
        description={`Requests start at 🪙 ${artist.minPrice}. Your coins are held until they deliver.`}
      >
        <div className="flex flex-col gap-3">
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as CommissionKind)}
            aria-label="What you want"
          >
            {(Object.keys(KIND) as CommissionKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND[k]}
              </option>
            ))}
          </Select>
          <Textarea
            aria-label="What you want"
            placeholder="Describe it: colours, vibe, a character, your name in a cool font…"
            maxLength={500}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex items-center gap-2 text-[13px]">
            Your offer 🪙
            <Input
              type="number"
              aria-label="Offer"
              min={artist.minPrice}
              max={ARTIST.offer.max}
              value={offer}
              onChange={(e) => setOffer(Number(e.target.value) || 0)}
              className="w-28"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              description.trim().length < 5 ||
              offer < artist.minPrice ||
              (wallet?.coins ?? 0) < offer
            }
            onClick={send}
          >
            Send request · 🪙 {offer}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeliverDialog({
  c,
  onClose,
  onDone,
}: {
  c: Commission
  onClose: () => void
  onDone: (p: ArtistsPage) => void
}) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const mine = useQuery({
    queryKey: ['cosmetics', org.id, 'mine'],
    queryFn: ({ signal }) => get<Cosmetic[]>(`${api}/cosmetics?view=mine`, signal),
  })
  const ready = (mine.data ?? []).filter((x) => x.status === 'approved' && x.kind === c.kind)
  const waiting = (mine.data ?? []).filter((x) => x.status === 'pending' && x.kind === c.kind)
  const [pick, setPick] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      const r = await post<{ page: ArtistsPage; wallet: Wallet }>(
        `${api}/commissions/${c.id}/deliver`,
        {
          cosmeticId: pick,
          note,
        },
      )
      onDone(r.page)
      qc.setQueryData(['wallet'], r.wallet)
      toast.success(`Delivered! +🪙 ${Math.floor(c.offer * ARTIST.share)}`)
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
        title={`Deliver to ${displayName(c.requester)}`}
        description={`Pick the ${KIND[c.kind].toLowerCase()} you made for them. Tip: make it 🔒 private in Create so it's only theirs.`}
      >
        {!ready.length ? (
          <p className="text-[13px] text-fg-muted">
            You don't have an approved {KIND[c.kind].toLowerCase()} yet. Make one in Create (a
            teacher checks it first).
            {waiting.length > 0 && ` ${waiting.length} waiting for review.`}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {ready.map((x) => (
              <label
                key={x.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-[13px]',
                  pick === x.id ? 'border-accent bg-accent-subtle' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="deliver"
                  checked={pick === x.id}
                  onChange={() => setPick(x.id)}
                />
                <span className="font-semibold">{x.name}</span>
                <span className="text-fg-subtle">
                  {x.visibility === 'private' ? '🔒 private' : 'public'}
                </span>
              </label>
            ))}
            <Input
              placeholder="A note for them (optional)"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!pick} onClick={send}>
            Deliver · get 🪙 {Math.floor(c.offer * ARTIST.share)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
