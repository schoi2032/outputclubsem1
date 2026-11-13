'use client'
import type { Channel, Message, MessagePage } from '@quid/shared'
import { Avatar, Button, Skeleton, Spinner } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, Hash, Lock, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LocalMessage } from '@/lib/actions'
import { get, post } from '@/lib/api'
import { channelTitle, dmPartner, isDirect } from '@/lib/channels'
import { dayLabel, displayName, sameDay } from '@/lib/format'
import { usePreference } from '@/lib/preferences'
import { keys, useMessages } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import type { SummaryRequest } from './catch-up'
import { MessageItem } from './message-item'

const GROUP_WINDOW_MS = 5 * 60_000

function shouldGroup(prev: Message | undefined, m: Message) {
  if (!prev || prev.kind === 'system' || m.kind === 'system' || prev.deletedAt || m.deletedAt)
    return false
  if (prev.author.id !== m.author.id || prev.replyCount > 0 || m.forwardedFrom) return false
  if (!sameDay(prev.createdAt, m.createdAt)) return false
  return new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="sticky top-0 z-[5] flex items-center justify-center py-2">
      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <span className="relative rounded-full border border-border bg-bg px-3 py-0.5 text-xs font-medium text-fg-muted shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
        {dayLabel(iso)}
      </span>
    </div>
  )
}

function NewDivider() {
  return (
    <div className="relative my-1 flex items-center px-4 md:px-5" data-new-divider>
      <div className="h-px flex-1 bg-danger/60" />
      <span className="ml-2 text-2xs font-semibold text-danger uppercase">New</span>
    </div>
  )
}

function ChannelIntro({ channel }: { channel: Channel }) {
  const { me } = useOrgContext()
  if (isDirect(channel)) {
    const partner = dmPartner(channel, me.id)
    return (
      <div className="px-4 pt-10 pb-4 md:px-5">
        {channel.kind === 'dm' && partner && (
          <Avatar
            name={partner.name}
            id={partner.id}
            src={partner.avatarUrl}
            decoration={partner.decoration}
            size="xl"
          />
        )}
        <h2 className="mt-3 text-lg font-semibold">{channelTitle(channel, me.id)}</h2>
        <p className="mt-1 text-[13px] text-fg-muted">
          {channel.kind === 'dm'
            ? partner?.id === me.id
              ? 'This is your space. Draft messages, keep notes, or save links for later.'
              : `This is the beginning of your direct messages with ${partner ? displayName(partner) : 'this person'}.`
            : `This is the beginning of a group conversation with ${(channel.participants ?? [])
                .filter((p) => p.id !== me.id)
                .map((p) => displayName(p))
                .join(', ')}.`}
        </p>
      </div>
    )
  }
  const Icon = channel.kind === 'private' ? Lock : Hash
  return (
    <div className="px-4 pt-10 pb-4 md:px-5">
      <span className="flex size-12 items-center justify-center rounded-xl bg-bg-muted text-fg-muted">
        <Icon className="size-6" />
      </span>
      <h2 className="mt-3 text-lg font-semibold">Welcome to #{channel.name}</h2>
      <p className="mt-1 max-w-xl text-[13px] text-fg-muted">
        {channel.description ||
          `This is the very beginning of the ${channel.kind === 'private' ? 'private ' : ''}#${channel.name} channel.`}
      </p>
    </div>
  )
}

interface Props {
  channel: Channel
  around?: string | null
  canModerate: boolean
  canPost: boolean
  onOpenThread: (m: Message) => void
  onForward: (m: Message) => void
  onJumpToPresent: () => void
  /** Set when Claude is available: offers a summary of what came in while away. */
  onCatchUp?: (r: SummaryRequest) => void
}

/** Fewer unread messages than this are quicker to read than to summarize. */
const CATCH_UP_MIN_UNREAD = 5

export function MessageList({
  channel,
  around,
  canModerate,
  canPost,
  onOpenThread,
  onForward,
  onJumpToPresent,
  onCatchUp,
}: Props) {
  const { org, api } = useOrgContext()
  const groupMessages = usePreference('groupMessages')
  const live = useMessages(org.id, channel.id)
  const aroundQuery = useQuery({
    queryKey: keys.around(channel.id, around ?? ''),
    queryFn: ({ signal }) =>
      get<MessagePage>(`${api}/channels/${channel.id}/messages?around=${around}&limit=50`, signal),
    enabled: !!around,
  })
  const mode = around ? 'around' : 'live'

  const messages: LocalMessage[] = useMemo(() => {
    if (mode === 'around') return aroundQuery.data?.messages ?? []
    return [...(live.data?.pages ?? [])].reverse().flatMap((p) => p.messages)
  }, [mode, aroundQuery.data, live.data])

  const hasOlder = mode === 'live' ? live.hasNextPage : false
  const loading = mode === 'live' ? live.isLoading : aroundQuery.isLoading
  const error = mode === 'live' ? live.error : aroundQuery.error

  // Where the "New" divider goes: captured once when the channel opens.
  const [newAfter] = useState(() => channel.membership?.lastReadMessageId ?? null)
  const firstUnreadIdx = useMemo(() => {
    if (!channel.membership || !newAfter || mode !== 'live') return -1
    const idx = messages.findIndex((m) => m.id > newAfter && m.kind !== 'system' && !m._status)
    return idx
  }, [messages, newAfter, channel.membership, mode])
  const [unreadAtOpen] = useState(() => channel.membership?.unreadCount ?? 0)
  const hadUnread = (channel.membership?.unreadCount ?? 0) > 0
  const [offerCatchUp, setOfferCatchUp] = useState(
    () => mode === 'live' && unreadAtOpen >= CATCH_UP_MIN_UNREAD,
  )

  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const didInitialScroll = useRef(false)
  const prevHeight = useRef<number | null>(null)
  const [showJump, setShowJump] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const lastCount = useRef(messages.length)

  // Initial position: the "New" divider, a linked message, or the bottom.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || didInitialScroll.current || loading || messages.length === 0) return
    didInitialScroll.current = true
    if (around) {
      document.getElementById(`m-${around}`)?.scrollIntoView({ block: 'center' })
      return
    }
    const divider = hadUnread && firstUnreadIdx > 0 ? el.querySelector('[data-new-divider]') : null
    if (divider) {
      ;(divider as HTMLElement).scrollIntoView({ block: 'center' })
    } else el.scrollTop = el.scrollHeight
  }, [loading, messages.length, around, firstUnreadIdx, hadUnread])

  // Keep scroll anchored when older pages are prepended; follow new messages when at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current
      prevHeight.current = null
    } else if (messages.length > lastCount.current) {
      const last = messages[messages.length - 1]
      if (atBottom.current || last?._status === 'sending') el.scrollTop = el.scrollHeight
      else setUnseen((n) => n + (messages.length - lastCount.current))
    }
    lastCount.current = messages.length
  }, [messages])

  const loadOlder = useCallback(async () => {
    if (!live.hasNextPage || live.isFetchingNextPage || mode !== 'live') return
    prevHeight.current = scroller.current?.scrollHeight ?? null
    await live.fetchNextPage()
  }, [live, mode])

  // Mark as read when the newest message is visible.
  const lastId = messages.findLast((m) => !m._status)?.id
  const lastMarked = useRef<string | null>(null)
  const markRead = useCallback(() => {
    if (!lastId || !channel.membership || mode !== 'live' || document.visibilityState !== 'visible')
      return
    if (!atBottom.current || lastMarked.current === lastId) return
    if (
      channel.membership.lastReadMessageId &&
      channel.membership.lastReadMessageId >= lastId &&
      channel.membership.unreadCount === 0
    )
      return
    lastMarked.current = lastId
    void post(`${api}/channels/${channel.id}/read`, { messageId: lastId }).catch(() => {
      lastMarked.current = null
    })
    void post(`${api}/notifications/read`, { channelId: channel.id, upTo: lastId }).catch(() => {})
  }, [lastId, channel.membership, channel.id, api, mode])

  useEffect(() => {
    const t = setTimeout(markRead, 600)
    const onVis = () => markRead()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [markRead])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    atBottom.current = distance < 80
    setShowJump(distance > 600 || mode === 'around')
    if (atBottom.current) {
      setUnseen(0)
      markRead()
    }
    if (el.scrollTop < 400) void loadOlder()
  }

  if (loading) {
    return (
      <div
        className="flex flex-1 flex-col justify-end gap-5 overflow-hidden px-5 pb-4"
        role="status"
        aria-busy="true"
        aria-label="Loading messages"
      >
        {[0.7, 0.45, 0.85, 0.6, 0.35].map((w, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3.5" style={{ width: `${w * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-fg-muted">
        Couldn't load messages.
        <Button
          size="sm"
          onClick={() => (mode === 'live' ? live.refetch() : aroundQuery.refetch())}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto pb-3"
        role="log"
        aria-live="polite"
        aria-label="Messages"
      >
        {hasOlder ? (
          <div className="flex justify-center py-4 text-fg-subtle">
            {live.isFetchingNextPage ? (
              <Spinner />
            ) : (
              <button
                type="button"
                className="text-xs hover:text-fg"
                onClick={() => void loadOlder()}
              >
                Load older messages
              </button>
            )}
          </div>
        ) : mode === 'live' ? (
          <ChannelIntro channel={channel} />
        ) : null}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt)
          return (
            <div key={m.clientId || m.id}>
              {newDay && <DayDivider iso={m.createdAt} />}
              {i === firstUnreadIdx && hadUnread && <NewDivider />}
              <MessageItem
                m={m}
                channel={channel}
                grouped={groupMessages && !newDay && i !== firstUnreadIdx && shouldGroup(prev, m)}
                highlighted={m.id === around}
                canModerate={canModerate}
                canPost={canPost}
                onOpenThread={onOpenThread}
                onForward={onForward}
              />
            </div>
          )
        })}
        {mode === 'around' && aroundQuery.data?.hasMoreAfter && (
          <div className="flex justify-center py-4">
            <Button size="sm" onClick={onJumpToPresent}>
              Jump to the latest messages
            </Button>
          </div>
        )}
      </div>
      {offerCatchUp && onCatchUp && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="pointer-events-auto flex animate-in items-center rounded-full border border-border bg-bg-overlay text-xs font-medium shadow-pop">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-l-full py-1.5 pr-2 pl-3 hover:bg-bg-muted"
              onClick={() => {
                setOfferCatchUp(false)
                onCatchUp({
                  channelId: channel.id,
                  ...(newAfter ? { afterMessageId: newAfter } : { hours: 24 * 7 }),
                  label: `${unreadAtOpen} new messages`,
                })
              }}
            >
              <Sparkles className="size-3.5 text-accent" />
              {unreadAtOpen} new · Catch me up
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              className="rounded-r-full border-l border-border py-1.5 pr-2.5 pl-2 text-fg-subtle hover:bg-bg-muted hover:text-fg"
              onClick={() => setOfferCatchUp(false)}
            >
              ×
            </button>
          </span>
        </div>
      )}
      {(showJump || unseen > 0) && (
        <button
          type="button"
          onClick={() => {
            if (mode === 'around') return onJumpToPresent()
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-in items-center gap-1.5 rounded-full border border-border bg-bg-overlay px-3 py-1.5 text-xs font-medium shadow-pop hover:bg-bg-muted"
        >
          <ArrowDown className="size-3.5" />
          {unseen > 0 ? `${unseen} new message${unseen === 1 ? '' : 's'}` : 'Jump to latest'}
        </button>
      )}
    </div>
  )
}
