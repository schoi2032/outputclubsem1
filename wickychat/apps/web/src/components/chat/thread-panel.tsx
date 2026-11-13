'use client'
import type { Channel, Message } from '@quid/shared'
import { IconButton, Skeleton } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type LocalMessage, useMessageActions } from '@/lib/actions'
import { get } from '@/lib/api'
import { channelRef } from '@/lib/channels'
import { usePreference } from '@/lib/preferences'
import { keys, useAiAvailable } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { CatchUpCard } from './catch-up'
import { Composer } from './composer'
import { MessageItem } from './message-item'
import { TypingIndicator } from './typing'

export function ThreadPanel({
  channel,
  rootId,
  canPost,
  canModerate,
  onClose,
  onForward,
}: {
  channel: Channel
  rootId: string
  canPost: boolean
  canModerate: boolean
  onClose: () => void
  onForward: (m: Message) => void
}) {
  const { api, me, org } = useOrgContext()
  const aiAvailable = useAiAvailable(org.id)
  const [summarizing, setSummarizing] = useState(false)
  const groupMessages = usePreference('groupMessages')
  const actions = useMessageActions()
  const thread = useQuery({
    queryKey: keys.thread(rootId),
    queryFn: ({ signal }) =>
      get<{ root: Message; replies: LocalMessage[] }>(`${api}/messages/${rootId}/thread`, signal),
  })
  const scroller = useRef<HTMLDivElement>(null)
  const count = thread.data?.replies.length ?? 0
  useEffect(() => {
    if (count) scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [count])

  // Threads stay open for replies even in announcement channels; only membership and archive block them.
  const replyBlocked = channel.archivedAt
    ? 'This channel is archived.'
    : !channel.membership
      ? 'Join the channel to reply.'
      : null

  return (
    <aside
      className="fixed inset-0 z-40 flex flex-col border-l border-border bg-bg md:static md:z-auto md:w-[min(440px,40vw)] md:shrink-0"
      aria-label="Thread"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Thread</h2>
        </div>
        <span className="mr-auto ml-2 truncate text-xs text-fg-subtle">
          {channelRef(channel, me.id)}
        </span>
        {aiAvailable && count > 1 && (
          <IconButton
            label="Summarize thread"
            active={summarizing}
            onClick={() => setSummarizing((s) => !s)}
          >
            <Sparkles />
          </IconButton>
        )}
        <IconButton label="Close thread" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      {summarizing && (
        <CatchUpCard
          request={{ channelId: channel.id, threadId: rootId, label: `${count} replies` }}
          onClose={() => setSummarizing(false)}
        />
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto py-2">
        {thread.isLoading ? (
          <div className="space-y-3 px-5 pt-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4" />
          </div>
        ) : thread.isError ? (
          <p className="px-5 pt-6 text-[13px] text-fg-muted">
            This thread isn't available. The message may have been deleted.
          </p>
        ) : thread.data ? (
          <>
            <MessageItem
              m={thread.data.root}
              channel={channel}
              grouped={false}
              inThread
              canModerate={canModerate}
              canPost={canPost}
              onForward={onForward}
            />
            <div className="my-2 flex items-center gap-3 px-5 text-xs text-fg-subtle">
              {count} {count === 1 ? 'reply' : 'replies'}
              <div className="h-px flex-1 bg-border" />
            </div>
            {thread.data.replies.map((m, i) => {
              const prev = thread.data!.replies[i - 1]
              const grouped =
                groupMessages &&
                !!prev &&
                prev.author.id === m.author.id &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 300_000
              return (
                <MessageItem
                  key={m.clientId || m.id}
                  m={m}
                  channel={channel}
                  grouped={grouped}
                  inThread
                  canModerate={canModerate}
                  canPost={canPost}
                  onForward={onForward}
                />
              )
            })}
          </>
        ) : null}
      </div>
      <TypingIndicator channelId={channel.id} parentId={rootId} />
      {thread.data && !thread.data.root.deletedAt && (
        <Composer
          key={`thread-${rootId}`}
          channel={channel}
          parentId={rootId}
          compact
          placeholder="Reply…"
          disabledReason={replyBlocked}
          onSubmit={(body, fileIds, files) => actions.send(channel, body, fileIds, files, rootId)}
        />
      )}
    </aside>
  )
}
