'use client'
/** WickyChat: send some of your own Wicky Coins to someone. */
import { COIN_GIFT, type Wallet } from '@quid/shared'
import { Button, Dialog, DialogContent, DialogFooter, Input, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Coins } from 'lucide-react'
import { useState } from 'react'
import { PeoplePicker } from '@/components/dialogs/people-picker'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, get, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { useMembers } from '@/lib/queries'

export function SendCoinsDialog({ presetTo, onClose }: { presetTo?: string; onClose: () => void }) {
  const { me, org, api } = useOrgContext()
  const qc = useQueryClient()
  const members = useMembers(org.id)
  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: ({ signal }) => get<Wallet>('/api/me/wallet', signal),
  })
  const [to, setTo] = useState<string[]>(presetTo ? [presetTo] : [])
  const [amount, setAmount] = useState(10)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const person = members.data?.find((m) => m.id === to[0])
  const left = Math.max(0, COIN_GIFT.dailyMax - (wallet.data?.coinsSentToday ?? 0))
  const max = Math.min(COIN_GIFT.max, left, wallet.data?.coins ?? 0)

  const send = async () => {
    if (!to[0]) return
    setBusy(true)
    try {
      const w = await post<Wallet>(`${api}/members/${to[0]}/send-coins`, {
        amount,
        note: note || undefined,
      })
      qc.setQueryData(['wallet'], w)
      toast.success(`Sent 🪙 ${amount} to ${person ? displayName(person) : 'them'}`)
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
        title={person ? `Send coins to ${displayName(person)}` : 'Send coins'}
        description={`From your own balance. Up to ${COIN_GIFT.max} at a time and ${COIN_GIFT.dailyMax} a day (${left} left today).`}
      >
        {!presetTo && (
          <PeoplePicker
            value={to}
            onChange={(ids) => setTo(ids.slice(-1))}
            exclude={[me.id]}
            autoFocus
          />
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[10, 25, 50, 100].map((n) => (
            <Button key={n} size="sm" disabled={n > max} onClick={() => setAmount(n)}>
              {n}
            </Button>
          ))}
          <Input
            type="number"
            aria-label="Coins to send"
            min={1}
            max={max}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
            className="w-24"
          />
        </div>
        <Input
          className="mt-3"
          placeholder="Say why (optional)"
          maxLength={80}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!to[0] || amount < 1 || amount > max}
            loading={busy}
            onClick={send}
          >
            <Coins /> Send 🪙 {amount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
