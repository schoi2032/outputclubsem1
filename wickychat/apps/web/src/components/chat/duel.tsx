'use client'
/**
 * WickyChat: coinflip duels in chat. DuelCard shows under the message; DuelButton opens the
 * dialog to start one (or type `/coinflip 50 heads`).
 */
import { type Channel, DUEL, type Duel, type Wallet } from '@quid/shared'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  IconButton,
  Input,
  Tooltip,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Coins } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PeoplePicker } from '@/components/dialogs/people-picker'
import { errorMessage, get, patch, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { keys } from '@/lib/queries'
import { useOrgContext } from '../org-context'

function Coin({ face, spinning }: { face: 'heads' | 'tails' | null; spinning: boolean }) {
  return (
    <div
      className={cn(
        'flex size-14 shrink-0 items-center justify-center rounded-full border-4 border-[#c99a12] bg-gradient-to-br from-[#ffe17a] to-[#e3a91a] text-[22px] font-black text-[#7a5200] shadow-[inset_0_-3px_0_rgb(0_0_0/0.15)]',
        spinning && 'q-coin-spin',
      )}
      aria-hidden="true"
    >
      {spinning ? '' : face === 'tails' ? 'T' : 'H'}
    </div>
  )
}

export function DuelCard({ duelId }: { duelId: string }) {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const key = ['duel', org.id, duelId]
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<Duel>(`${api}/duels/${duelId}`, signal),
    refetchInterval: (query) => (query.state.data?.status === 'open' ? 10_000 : false),
  })
  const [busy, setBusy] = useState(false)
  // Spin for a moment when the result first shows up.
  const [spin, setSpin] = useState(false)
  const status = q.data?.status
  const [seen, setSeen] = useState(status)
  useEffect(() => {
    if (seen === 'open' && status === 'done') {
      setSpin(true)
      const t = setTimeout(() => setSpin(false), 1600)
      return () => clearTimeout(t)
    }
    setSeen(status)
  }, [status, seen])
  useEffect(() => {
    if (!spin) setSeen(status)
  }, [spin, status])

  const d = q.data
  if (!d) return <div className="mt-2 h-20 max-w-sm animate-pulse rounded-lg bg-bg-muted" />
  const mine = d.challenger.id === me.id
  const canAccept = d.status === 'open' && !mine && (!d.opponent || d.opponent.id === me.id)
  const won = d.winnerId === me.id
  const played = mine || d.acceptedBy?.id === me.id

  const act = async (what: 'accept' | 'cancel') => {
    setBusy(true)
    try {
      if (what === 'accept') {
        const r = await post<{ duel: Duel; wallet: Wallet }>(`${api}/duels/${d.id}/accept`, {})
        setSeen('open')
        qc.setQueryData(key, r.duel)
        qc.setQueryData(['wallet'], r.wallet)
        setTimeout(
          () =>
            r.duel.winnerId === me.id
              ? toast.success(`You won 🪙 ${r.duel.amount * 2}! 🎉`)
              : toast.info(`It landed ${r.duel.result}. Better luck next time!`),
          1600,
        )
      } else {
        qc.setQueryData(key, await post<Duel>(`${api}/duels/${d.id}/cancel`, {}))
        void qc.invalidateQueries({ queryKey: ['wallet'] })
      }
    } catch (e) {
      toast.error(errorMessage(e))
      void q.refetch()
    } finally {
      setBusy(false)
    }
  }

  const winner = d.winnerId === d.challenger.id ? d.challenger : d.acceptedBy
  return (
    <div
      className={cn(
        'mt-2 flex max-w-sm items-center gap-3 rounded-xl border p-3',
        d.status === 'done' && !spin && played
          ? won
            ? 'border-success/50 bg-success/10'
            : 'border-danger/40 bg-danger/5'
          : 'border-border bg-bg-subtle',
      )}
    >
      <Coin face={d.result ?? d.side} spinning={spin} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">🪙 {d.amount} coinflip</p>
        <p className="text-xs text-fg-muted">
          {displayName(d.challenger)} calls {d.side}
          {d.opponent ? ` vs ${displayName(d.opponent)}` : ''}
        </p>
        {d.status === 'done' && !spin && (
          <p className="mt-0.5 text-xs font-semibold">
            Landed {d.result}! {winner ? `${displayName(winner)} wins 🪙 ${d.amount * 2}` : ''}
          </p>
        )}
        {d.status === 'expired' && (
          <p className="mt-0.5 text-xs text-fg-subtle">Nobody took it. Coins went back.</p>
        )}
        {d.status === 'cancelled' && (
          <p className="mt-0.5 text-xs text-fg-subtle">Called off. Coins went back.</p>
        )}
      </div>
      {canAccept && (
        <Button size="sm" variant="primary" loading={busy} onClick={() => act('accept')}>
          Accept
        </Button>
      )}
      {d.status === 'open' && mine && (
        <Button size="sm" loading={busy} onClick={() => act('cancel')}>
          Call off
        </Button>
      )}
      {d.status === 'open' && !canAccept && !mine && (
        <span className="text-2xs text-fg-subtle">Waiting…</span>
      )}
    </div>
  )
}

export function DuelButton({ channel }: { channel: Channel }) {
  const { api, me, org } = useOrgContext()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(20)
  const [side, setSide] = useState<'heads' | 'tails'>('heads')
  const [to, setTo] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const teacher = org.role === 'owner' || org.role === 'admin'
  const on = org.customization?.duels !== false
  if (!on && !teacher) return null
  const toggle = async () => {
    try {
      await patch(`${api}/customization`, { duels: !on })
      void qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: keys.org(org.id) })
      toast.success(on ? 'Coinflip duels are off for everyone.' : 'Coinflip duels are back on.')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const dmWith = channel.kind === 'dm' ? channel.participants?.find((p) => p.id !== me.id) : null

  const submit = async () => {
    setBusy(true)
    try {
      await post(`${api}/channels/${channel.id}/duels`, {
        amount,
        side,
        opponentId: dmWith?.id ?? to[0] ?? null,
      })
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      setOpen(false)
      setTo([])
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Tooltip content="Coinflip duel">
        <IconButton label="Coinflip duel" size="sm" onClick={() => setOpen(true)}>
          <Coins />
        </IconButton>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="🪙 Coinflip duel"
          description="You both put in the same coins. The winner takes it all. Nobody accepts in 10 minutes? You get yours back."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {[10, 25, 50, 100].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={amount === n ? 'primary' : 'secondary'}
                  onClick={() => setAmount(n)}
                >
                  {n}
                </Button>
              ))}
              <Input
                type="number"
                aria-label="Coins"
                min={DUEL.min}
                max={DUEL.max}
                value={amount}
                onChange={(e) =>
                  setAmount(Math.max(DUEL.min, Math.min(DUEL.max, Number(e.target.value) || 1)))
                }
                className="w-24"
              />
            </div>
            <div className="flex gap-2">
              {(['heads', 'tails'] as const).map((s) => (
                <Button
                  key={s}
                  className="flex-1"
                  variant={side === s ? 'primary' : 'secondary'}
                  onClick={() => setSide(s)}
                >
                  {s === 'heads' ? '🙂 Heads' : '🪙 Tails'}
                </Button>
              ))}
            </div>
            {dmWith ? (
              <p className="text-[13px] text-fg-muted">Against {displayName(dmWith)}</p>
            ) : (
              <div>
                <p className="mb-1 text-[13px] text-fg-muted">
                  Against someone (leave empty for anyone here)
                </p>
                <PeoplePicker
                  value={to}
                  onChange={(ids) => setTo(ids.slice(-1))}
                  exclude={[me.id]}
                />
              </div>
            )}
          </div>
          {teacher && (
            <label className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
              <input type="checkbox" checked={on} onChange={toggle} />🍎 Allow coinflip duels at
              this school
            </label>
          )}
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!on} onClick={submit}>
              Post duel · 🪙 {amount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
