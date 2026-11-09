'use client'
import type { Message } from '@quid/shared'
import { Avatar } from '@quid/ui'
import Link from 'next/link'
import { channelRef } from '@/lib/channels'
import { displayName, formatFull } from '@/lib/format'
import { useChannels } from '@/lib/queries'
import { RichText } from './chat/rich-text'
import { useOrgContext } from './org-context'

/** A message shown out of its conversation (saved items, search results). */
export function MessageCard({
  m,
  actions,
  highlight,
}: {
  m: Message
  actions?: React.ReactNode
  highlight?: string
}) {
  const { org, base, me } = useOrgContext()
  const channels = useChannels(org.id)
  const ch = channels.data?.find((c) => c.id === m.channelId)
  const href = m.parentId
    ? `${base}/c/${m.channelId}?thread=${m.parentId}`
    : `${base}/c/${m.channelId}?m=${m.id}`
  return (
    <div className="group relative rounded-lg border border-border bg-bg p-3 transition-colors hover:border-border-strong">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-fg-subtle">
        <span className="font-medium text-fg-muted">
          {ch ? channelRef(ch, me.id) : 'Conversation'}
        </span>
        {m.parentId && <span>· in a thread</span>}
        <span className="ml-auto">{formatFull(m.createdAt)}</span>
      </div>
      <div className="flex gap-2.5">
        <Avatar name={m.author.name} id={m.author.id} src={m.author.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">{displayName(m.author)}</p>
          {highlight ? (
            <p className="text-[14px] text-fg">
              {highlight.split(/(«[^»]*»)/g).map((part, i) =>
                part.startsWith('«') ? (
                  <mark key={i} className="rounded-sm bg-mention px-0.5 text-fg">
                    {part.slice(1, -1)}
                  </mark>
                ) : (
                  part
                ),
              )}
            </p>
          ) : (
            <div className="line-clamp-6 text-[14px]">
              <RichText doc={m.body} />
            </div>
          )}
          {m.attachments.length > 0 && (
            <p className="mt-1 text-xs text-fg-subtle">
              {m.attachments.length} attachment{m.attachments.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {actions}
        <Link href={href} className="text-xs font-medium text-accent-text hover:underline">
          View in conversation
        </Link>
      </div>
    </div>
  )
}
