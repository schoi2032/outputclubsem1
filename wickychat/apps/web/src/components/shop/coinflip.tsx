'use client'
/** WickyChat solo coinflip: pick heads or tails, bet, flip. */
import { flipPayout, SOLO_FLIP, type SoloFlip, type Wallet } from '@quid/shared'
import { Button, cn, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, get, post } from '@/lib/api'
import { QtyPicker } from './qty-picker'

const BETS = [10, 50, 100, 500, 1000]

export function CoinflipView({ wallet }: { wallet: Wallet | undefined }) {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const today = useQuery({
    queryKey: ['coinflip', org.id],
    queryFn: ({ signal }) => get<{ flipsToday: number }>(`${api}/coinflip`, signal),
  })
  const [bet, setBet] = useState(10)
  const [side, setSide] = useState<'heads' | 'tails'>('heads')
  const [spinning, setSpinning] = useState(false)
  const [last, setLast] = useState<SoloFlip | null>(null)
  const [history, setHistory] = useState<SoloFlip[]>([])
  const off = org.customization?.duels === false
  const used = last?.flipsToday ?? today.data?.flipsToday ?? 0

  const flip = async () => {
    setSpinning(true)
    setLast(null)
    const started = Date.now()
    try {
      const r = await post<{ flip: SoloFlip; wallet: Wallet }>(`${api}/coinflip`, { bet, side })
      // Let the coin spin for a moment before showing how it landed.
      await new Promise((ok) => setTimeout(ok, Math.max(0, 1400 - (Date.now() - started))))
      setLast(r.flip)
      setHistory((h) => [r.flip, ...h].slice(0, 12))
      qc.setQueryData(['wallet'], r.wallet)
      if (r.flip.won) toast.success(`${r.flip.result}! +🪙 ${r.flip.payout - r.flip.bet} 🎉`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSpinning(false)
    }
  }

  const face = last?.result ?? side
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-4 text-center">
      <div>
        <p className="text-[18px] font-bold">🪙 Coinflip</p>
        <p className="mt-1 text-[13px] text-fg-muted">
          Call it, bet, flip. Win and you get 🪙 {flipPayout(bet)} back on a 🪙 {bet} bet. No
          limits: bet as much as you have. {used} flips today.
        </p>
      </div>

      <div
        className={cn(
          'flex size-36 items-center justify-center rounded-full border-[6px] border-[#c99a12] bg-gradient-to-br from-[#ffe17a] to-[#e3a91a] text-[54px] font-black text-[#7a5200] shadow-[inset_0_-6px_0_rgb(0_0_0/0.15),0_10px_30px_-10px_rgb(201_154_18/0.8)]',
          spinning && 'q-coin-spin-long',
          last && !spinning && (last.won ? 'ring-4 ring-success/60' : 'ring-4 ring-danger/50'),
        )}
        role="img"
        aria-label={last ? `It landed ${last.result}. You ${last.won ? 'won' : 'lost'}.` : 'Coin'}
      >
        {spinning ? '' : face === 'heads' ? 'H' : 'T'}
      </div>
      <p className="h-5 text-[14px] font-semibold" aria-live="polite">
        {last &&
          !spinning &&
          (last.won
            ? `${last.result[0]!.toUpperCase()}${last.result.slice(1)}! You won 🪙 ${last.payout - last.bet}`
            : `${last.result[0]!.toUpperCase()}${last.result.slice(1)}. You lost 🪙 ${last.bet}`)}
      </p>

      <div className="flex w-full gap-2">
        {(['heads', 'tails'] as const).map((s) => (
          <Button
            key={s}
            className="flex-1"
            variant={side === s ? 'primary' : 'secondary'}
            onClick={() => setSide(s)}
            disabled={spinning}
          >
            {s === 'heads' ? '🙂 Heads' : '🪙 Tails'}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-1.5">
        {BETS.map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={bet === b}
            onClick={() => setBet(b)}
            disabled={spinning}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-semibold tabular-nums',
              bet === b ? 'bg-accent text-accent-fg' : 'bg-bg-muted text-fg-muted hover:text-fg',
            )}
          >
            🪙 {b}
          </button>
        ))}
      </div>
      <Button
        size="sm"
        disabled={spinning || (wallet?.coins ?? 0) < SOLO_FLIP.min}
        onClick={() => setBet(Math.max(SOLO_FLIP.min, wallet?.coins ?? 0))}
      >
        All in (🪙 {(wallet?.coins ?? 0).toLocaleString()})
      </Button>
      <QtyPicker
        value={bet}
        onChange={(n) => setBet(Math.max(SOLO_FLIP.min, n))}
        max={Math.max(SOLO_FLIP.min, wallet?.coins ?? SOLO_FLIP.min)}
        label="Custom bet"
      />

      <Button
        variant="primary"
        className="w-full text-[15px]"
        loading={spinning}
        disabled={off || (wallet?.coins ?? 0) < bet}
        onClick={flip}
      >
        {off ? 'Coin games are off at this school' : `Flip for 🪙 ${bet.toLocaleString()}`}
      </Button>

      {history.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {history.map((h, i) => (
            <span
              key={i}
              title={`${h.result}, ${h.won ? 'won' : 'lost'} ${h.won ? h.payout - h.bet : h.bet}`}
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-2xs font-bold',
                h.won ? 'bg-success/20 text-success' : 'bg-danger/15 text-danger',
              )}
            >
              {h.result === 'heads' ? 'H' : 'T'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
