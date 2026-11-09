'use client'
import type { Call } from '@quid/shared'
import { Avatar } from '@quid/ui'
import { Phone, PhoneOff } from 'lucide-react'
import { channelTitle } from '@/lib/channels'
import { displayName } from '@/lib/format'
import { useChannels } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { useCalls } from './call-provider'

export function IncomingCall({ call }: { call: Call }) {
  const { org, me } = useOrgContext()
  const { join, decline } = useCalls()
  const channels = useChannels(org.id)
  const caller = call.startedBy
  const channel = channels.data?.find((c) => c.id === call.channelId)
  const where = channel && channel.kind !== 'dm' ? channelTitle(channel, me.id) : null

  return (
    <div
      role="alertdialog"
      aria-label={`Incoming call from ${caller ? displayName(caller) : 'someone'}`}
      className="fixed top-4 right-4 left-4 z-[65] mx-auto flex max-w-sm animate-in items-center gap-3 rounded-xl border border-border bg-bg-overlay p-3 shadow-dialog md:left-auto"
    >
      <span className="relative">
        <span className="absolute inset-0 animate-ping rounded-lg bg-success/30" />
        {caller && (
          <Avatar
            name={caller.name}
            id={caller.id}
            src={caller.avatarUrl}
            size="lg"
            className="relative"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">
          {caller ? displayName(caller) : 'Someone'}
        </p>
        <p className="truncate text-xs text-fg-muted">
          Incoming voice call{where ? ` · ${where}` : ''}
        </p>
      </div>
      <button
        type="button"
        aria-label="Decline"
        title="Decline"
        onClick={() => void decline(call.id)}
        className="flex size-10 items-center justify-center rounded-full bg-danger text-white transition-opacity hover:opacity-90"
      >
        <PhoneOff className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Accept"
        title="Accept"
        autoFocus
        onClick={() => void join(call.id)}
        className="flex size-10 items-center justify-center rounded-full bg-success text-white transition-opacity hover:opacity-90"
      >
        <Phone className="size-4" />
      </button>
    </div>
  )
}
