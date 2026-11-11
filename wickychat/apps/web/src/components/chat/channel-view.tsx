'use client'
import type { Attachment, Channel, DocNode, Meeting, Message, UserSummary } from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  IconButton,
  Skeleton,
  Spinner,
  Tooltip,
  toast,
} from '@quid/ui'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BellOff,
  FileText,
  FolderOpen,
  Hash,
  Headphones,
  Info,
  ListTodo,
  Lock,
  Megaphone,
  Phone,
  Pin,
  Users,
  Video,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMessageActions } from '@/lib/actions'
import { ApiError, errorMessage, get, post } from '@/lib/api'
import { channelRef, channelTitle, dmPartner, isDirect } from '@/lib/channels'
import { displayName, relative } from '@/lib/format'
import { keys, useAiAvailable, useChannel, useDrafts, usePresence } from '@/lib/queries'
import { send as sendRealtime, viewing } from '@/lib/realtime'
import { useCalls } from '../calls/call-provider'
import { useOrgContext } from '../org-context'
import { CanvasTab } from '../productivity/canvas-tab'
import { TasksTab } from '../productivity/tasks'
import { WorkflowsButton } from '../productivity/workflow-run'
import { useVoiceRooms } from '../voice-rooms/voice-room-provider'
import { FileCard } from './attachments'
import { CatchUpCard, SummarizeMenu, type SummaryRequest } from './catch-up'
import { ChannelDetails, useChannelPermissions } from './channel-details'
import { Composer, type ComposerHandle } from './composer'
import { ForwardDialog } from './forward-dialog'
import { MessageItem } from './message-item'
import { MessageList } from './message-list'
import { ThreadPanel } from './thread-panel'
import { TypingIndicator } from './typing'

type Tab = 'messages' | 'files' | 'pins' | 'canvases' | 'tasks'
const TABS: Tab[] = ['messages', 'files', 'pins', 'canvases', 'tasks']

function VoiceRoomButton({ channel }: { channel: Channel }) {
  const rooms = useVoiceRooms()
  const calls = useCalls()
  if (channel.kind === 'dm' || !channel.membership || channel.archivedAt) return null
  const room = rooms.activeRooms.find((r) => r.channelId === channel.id)
  const here = rooms.session?.room.channelId === channel.id
  const count = room?.participants.length ?? 0
  return (
    <Tooltip
      content={
        !calls.available
          ? 'Voice rooms are not configured on this server'
          : here
            ? "You're in this voice room"
            : count
              ? `Join the voice room (${count} here)`
              : 'Open the voice room'
      }
    >
      <span>
        <button
          type="button"
          aria-label={count ? `Voice room, ${count} people` : 'Voice room'}
          disabled={!calls.available || here}
          onClick={() => void rooms.join(channel.id)}
          className={cn(
            'flex h-8 items-center gap-1 rounded-md px-2 text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg disabled:opacity-50',
            count > 0 && 'text-success',
          )}
        >
          <Headphones className="size-4" />
          {count > 0 && <span className="text-xs font-semibold tabular-nums">{count}</span>}
        </button>
      </span>
    </Tooltip>
  )
}

function MeetButton({ channel }: { channel: Channel }) {
  const { api, base, me } = useOrgContext()
  const calls = useCalls()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  if (!channel.membership || channel.archivedAt) return null
  return (
    <Tooltip
      content={
        calls.available
          ? 'Start a video meeting here'
          : 'Meetings are not configured on this server'
      }
    >
      <span>
        <IconButton
          label="Start video meeting"
          disabled={!calls.available || busy}
          onClick={async () => {
            setBusy(true)
            try {
              const m = await post<Meeting>(`${api}/meetings`, {
                title: `${channelRef(channel, me.id)} meeting`,
                channelId: channel.id,
                waitingRoom: false,
                inviteeIds:
                  channel.kind === 'dm' || channel.kind === 'group'
                    ? (channel.participants ?? []).map((p) => p.id)
                    : [],
              })
              router.push(`${base}/meet/${m.code}`)
            } catch (e) {
              toast.error(errorMessage(e))
              setBusy(false)
            }
          }}
        >
          <Video />
        </IconButton>
      </span>
    </Tooltip>
  )
}

function CallButton({ channel }: { channel: Channel }) {
  const calls = useCalls()
  const ongoing = calls.activeCalls.find((c) => c.channelId === channel.id)
  const inThis = calls.current?.call.channelId === channel.id
  const disabledReason = !calls.available
    ? 'Voice calls are not configured on this server'
    : !channel.membership
      ? 'Join to start a call'
      : channel.archivedAt
        ? 'This channel is archived'
        : inThis
          ? "You're in this call"
          : null
  return (
    <Tooltip content={disabledReason ?? (ongoing ? 'Join the call' : 'Start a voice call')}>
      <span>
        <IconButton
          label={ongoing ? 'Join call' : 'Start voice call'}
          disabled={!!disabledReason}
          className={cn(ongoing && !inThis && 'text-success')}
          onClick={() => void (ongoing ? calls.join(ongoing.id) : calls.start(channel.id))}
        >
          <Phone />
        </IconButton>
      </span>
    </Tooltip>
  )
}

/** Shown when a call is running in this conversation and you're not in it. */
function CallBanner({ channel }: { channel: Channel }) {
  const calls = useCalls()
  const ongoing = calls.activeCalls.find((c) => c.channelId === channel.id)
  if (!ongoing || calls.current?.call.id === ongoing.id || !channel.membership) return null
  const inCall = ongoing.participants.filter((p) => p.status === 'joined')
  return (
    <div className="flex items-center gap-3 border-b border-border bg-success/10 px-4 py-2 md:px-6">
      <span className="size-2 animate-pulse rounded-full bg-success" />
      <span className="flex -space-x-1">
        {inCall.slice(0, 4).map((p) => (
          <Avatar
            key={p.user.id}
            name={p.user.name}
            id={p.user.id}
            src={p.user.avatarUrl}
            decoration={p.user.decoration}
            size="xs"
            className="ring-2 ring-bg"
          />
        ))}
      </span>
      <p className="min-w-0 flex-1 truncate text-[13px]">
        {ongoing.status === 'ringing'
          ? 'A call is ringing'
          : `Call in progress · ${inCall.length} ${inCall.length === 1 ? 'person' : 'people'}`}
      </p>
      <Button
        size="sm"
        variant="primary"
        className="bg-success hover:bg-success hover:opacity-90"
        onClick={() => void calls.join(ongoing.id)}
      >
        <Phone /> Join
      </Button>
    </div>
  )
}

function Header({
  channel,
  tab,
  setTab,
  onDetails,
  onCatchUp,
}: {
  channel: Channel
  tab: Tab
  setTab: (t: Tab) => void
  onDetails: (t: string) => void
  onCatchUp?: (r: SummaryRequest) => void
}) {
  const { me, org, base } = useOrgContext()
  const presence = usePresence(org.id)
  const partner = channel.kind === 'dm' ? dmPartner(channel, me.id) : undefined
  const partnerPresence = partner ? presence.data?.[partner.id] : undefined
  const Icon =
    channel.kind === 'private' ? Lock : channel.postingPolicy === 'admins' ? Megaphone : Hash

  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex h-12 items-center gap-2 px-3 md:px-5">
        <Link
          href={base}
          className="-ml-1 rounded-md p-1.5 text-fg-muted hover:bg-bg-muted md:hidden"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <button
          type="button"
          onClick={() => onDetails('about')}
          className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-bg-muted"
        >
          {partner ? (
            <Avatar
              name={partner.name}
              id={partner.id}
              src={partner.avatarUrl}
              decoration={partner.decoration}
              size="sm"
              presence={partner.isBot ? undefined : (partnerPresence?.status ?? 'offline')}
            />
          ) : channel.kind === 'group' ? (
            <Users className="size-4 text-fg-muted" />
          ) : (
            <Icon className="size-4 text-fg-muted" />
          )}
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {channelTitle(channel, me.id)}
          </h1>
          {channel.membership?.muted && <BellOff className="size-3.5 text-fg-subtle" />}
        </button>
        {partnerPresence?.statusText && (
          <span className="hidden truncate text-xs text-fg-subtle sm:inline">
            {partnerPresence.statusEmoji} {partnerPresence.statusText}
          </span>
        )}
        {channel.topic && !partner && (
          <span
            className="hidden min-w-0 truncate border-l border-border pl-3 text-[13px] text-fg-muted lg:block"
            title={channel.topic}
          >
            {channel.topic}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <VoiceRoomButton channel={channel} />
          <CallButton channel={channel} />
          <MeetButton channel={channel} />
          <WorkflowsButton channel={channel} />
          {onCatchUp && (
            <SummarizeMenu
              onPick={(hours, label) => {
                setTab('messages')
                onCatchUp({ channelId: channel.id, hours, label })
              }}
            />
          )}
          {channel.kind !== 'dm' && (
            <Tooltip content="Members">
              <button
                type="button"
                onClick={() => onDetails('members')}
                className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium text-fg-muted hover:bg-bg-muted"
              >
                <Users className="size-3.5" />
                {channel.memberCount}
              </button>
            </Tooltip>
          )}
          <Tooltip content="Details">
            <IconButton label="Channel details" onClick={() => onDetails('about')}>
              <Info />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      <nav className="flex gap-4 px-4 md:px-6" aria-label="Channel sections">
        {(
          [
            ['messages', 'Messages', null],
            ['files', 'Files', FolderOpen],
            ['pins', 'Pins', Pin],
            ['canvases', 'Canvases', FileText],
            ['tasks', 'Tasks', ListTodo],
          ] as const
        ).map(([key, label, TabIcon]) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px flex h-8 items-center gap-1.5 border-b-2 border-transparent text-[13px] font-medium text-fg-muted hover:text-fg',
              tab === key && 'border-fg text-fg',
            )}
          >
            {TabIcon && <TabIcon className="size-3.5" />}
            {label}
          </button>
        ))}
      </nav>
    </header>
  )
}

function FilesTab({ channel }: { channel: Channel }) {
  const { api } = useOrgContext()
  const q = useInfiniteQuery({
    queryKey: keys.channelFiles(channel.id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<{
        files: (Attachment & { uploader: UserSummary | null; createdAt: string })[]
        nextCursor: string | null
      }>(
        `${api}/channels/${channel.id}/files?limit=40${pageParam ? `&before=${pageParam}` : ''}`,
        signal,
      ),
    getNextPageParam: (p) => p.nextCursor,
  })
  const files = q.data?.pages.flatMap((p) => p.files) ?? []
  if (q.isLoading)
    return (
      <div className="space-y-2 p-5">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 max-w-sm" />
        ))}
      </div>
    )
  if (!files.length)
    return (
      <EmptyState
        emoji="📎"
        title="No files yet"
        description="Share a file in this conversation and it’ll show up here."
      />
    )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {files.map((f) => (
          <li key={f.id}>
            {f.isImage ? (
              <a
                href={`${f.url}?inline=1`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-bg-subtle"
              >
                <img
                  src={f.thumbnailUrl ?? f.url}
                  alt=""
                  className="size-10 rounded-md object-cover"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{f.name}</span>
                  <span className="block text-xs text-fg-subtle">
                    {f.uploader ? displayName(f.uploader) : 'Unknown'} · {relative(f.createdAt)}
                  </span>
                </span>
              </a>
            ) : (
              <FileCard a={f} />
            )}
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

function PinsTab({
  channel,
  onOpenThread,
  onForward,
  canPost,
  canModerate,
}: {
  channel: Channel
  onOpenThread: (m: Message) => void
  onForward: (m: Message) => void
  canPost: boolean
  canModerate: boolean
}) {
  const { api } = useOrgContext()
  const pins = useQuery({
    queryKey: keys.pins(channel.id),
    queryFn: ({ signal }) => get<Message[]>(`${api}/channels/${channel.id}/pins`, signal),
  })
  if (pins.isLoading)
    return (
      <div className="p-5">
        <Spinner />
      </div>
    )
  if (!pins.data?.length)
    return (
      <EmptyState
        emoji="📌"
        title="Nothing pinned yet"
        description="Pin important messages from the message menu so everyone can find them."
      />
    )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-3">
      {pins.data.map((m) => (
        <div key={m.id} className="border-b border-border pb-2 last:border-0">
          <MessageItem
            m={m}
            channel={channel}
            grouped={false}
            canModerate={canModerate}
            canPost={canPost}
            onOpenThread={onOpenThread}
            onForward={onForward}
          />
        </div>
      ))}
    </div>
  )
}

export function ChannelView({ channelId }: { channelId: string }) {
  const { org, me, api, base } = useOrgContext()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const threadId = params.get('thread')
  const around = params.get('m')
  const qc = useQueryClient()
  const channelQ = useChannel(org.id, channelId)
  const channel = channelQ.data
  const perms = useChannelPermissions(channel)
  const actions = useMessageActions()
  const drafts = useDrafts(org.id)
  const tabParam = params.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(
    tabParam && TABS.includes(tabParam) ? tabParam : 'messages',
  )
  // Links like ?tab=tasks&task=… (from notifications) open that tab.
  useEffect(() => {
    if (tabParam && TABS.includes(tabParam)) setTabState(tabParam)
  }, [tabParam])
  const [details, setDetails] = useState<string | null>(null)
  const [forwarding, setForwarding] = useState<Message | null>(null)
  const [joining, setJoining] = useState(false)
  const [catchUp, setCatchUp] = useState<SummaryRequest | null>(null)
  const aiAvailable = useAiAvailable(org.id)
  const composer = useRef<ComposerHandle>(null)

  useEffect(() => {
    viewing.channelId = channelId
    sendRealtime({ type: 'subscribe', channelId })
    return () => {
      viewing.channelId = null
      sendRealtime({ type: 'unsubscribe', channelId })
    }
  }, [channelId])

  useEffect(() => {
    if (channel) document.title = `${channelRef(channel, me.id)} · ${org.name}`
  }, [channel, me.id, org.name])

  // Optimistically clear unread badges for the open channel.
  useEffect(() => {
    if (!channel?.membership?.unreadCount && !channel?.membership?.mentionCount) return
    qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
      l?.map((c) =>
        c.id === channelId && c.membership
          ? { ...c, membership: { ...c.membership, unreadCount: 0, mentionCount: 0 } }
          : c,
      ),
    )
  }, [channelId, channel?.membership?.unreadCount, channel?.membership?.mentionCount, org.id, qc])

  const setTab = (t: Tab) => {
    setTabState(t)
    if (tabParam) setParam('tab', null)
  }
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (value) next.set(key, value)
      else next.delete(key)
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )
  // Stable across renders so memoized message rows don't re-render when the URL changes.
  const setParamRef = useRef(setParam)
  setParamRef.current = setParam
  const openThread = useCallback((m: Message) => setParamRef.current('thread', m.id), [])
  const jumpToPresent = useCallback(() => setParamRef.current('m', null), [])

  const draft = useMemo(
    () => drafts.data?.find((d) => d.channelId === channelId && !d.parentId)?.body ?? null,
    [drafts.data, channelId],
  )
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onDraftChange = useCallback(
    (body: DocNode | null) => {
      if (draftTimer.current) clearTimeout(draftTimer.current)
      draftTimer.current = setTimeout(() => void actions.saveDraft(channelId, null, body), 900)
    },
    [actions, channelId],
  )
  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current)
    },
    [],
  )

  if (channelQ.isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-12 items-center border-b border-border px-5">
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
    )
  }
  if (channelQ.isError || !channel) {
    const notFound = channelQ.error instanceof ApiError && channelQ.error.status === 404
    return (
      <EmptyState
        className="h-full"
        emoji={notFound ? '🤷' : '😬'}
        title={notFound ? 'This conversation isn’t here' : 'Couldn’t load this conversation'}
        description={
          notFound
            ? "It may have been deleted, or you don't have access to it."
            : errorMessage(channelQ.error)
        }
        action={
          <Button asChild>
            <Link href={base}>Back to {org.name}</Link>
          </Button>
        }
      />
    )
  }

  const isMember = !!channel.membership
  const disabledReason = channel.archivedAt
    ? 'This channel is archived. You can read its history but no new messages can be posted.'
    : !isMember
      ? null
      : !perms.canPost
        ? 'Only channel admins can post here. You can still reply in threads.'
        : null

  return (
    <div className="flex min-h-0 flex-1">
      <section className={cn('flex min-w-0 flex-1 flex-col', threadId && 'hidden md:flex')}>
        <Header
          channel={channel}
          tab={tab}
          setTab={setTab}
          onDetails={setDetails}
          onCatchUp={aiAvailable ? setCatchUp : undefined}
        />
        <CallBanner channel={channel} />
        {tab === 'messages' && (
          <>
            {catchUp && catchUp.channelId === channel.id && (
              <CatchUpCard
                key={JSON.stringify(catchUp)}
                request={catchUp}
                onClose={() => setCatchUp(null)}
              />
            )}
            <MessageList
              key={`${channel.id}:${around ?? ''}`}
              channel={channel}
              around={around}
              canModerate={perms.canManage && !isDirect(channel)}
              canPost={isMember && !channel.archivedAt}
              onOpenThread={openThread}
              onForward={setForwarding}
              onJumpToPresent={jumpToPresent}
              onCatchUp={aiAvailable ? setCatchUp : undefined}
            />
            <TypingIndicator channelId={channel.id} />
            {!isMember && !channel.archivedAt ? (
              <div className="mx-4 mb-4 flex flex-col items-center gap-2 rounded-xl border border-border bg-bg-subtle px-4 py-4 text-center md:mx-5">
                <p className="text-[13px] text-fg-muted">
                  You're previewing <span className="font-semibold text-fg">#{channel.name}</span>
                </p>
                {perms.canJoin && (
                  <Button
                    variant="primary"
                    loading={joining}
                    onClick={async () => {
                      setJoining(true)
                      try {
                        const c = await post<Channel>(`${api}/channels/${channel.id}/join`)
                        qc.setQueryData(keys.channel(org.id, channel.id), c)
                        qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
                          l ? [...l.filter((x) => x.id !== c.id), c] : l,
                        )
                      } catch (e) {
                        toast.error(errorMessage(e))
                      } finally {
                        setJoining(false)
                      }
                    }}
                  >
                    Join channel
                  </Button>
                )}
              </div>
            ) : (
              <Composer
                key={`main-${channel.id}-${drafts.isSuccess}`}
                ref={composer}
                channel={channel}
                placeholder={`Message ${channelRef(channel, me.id)}`}
                disabledReason={disabledReason}
                initial={draft}
                onDraftChange={onDraftChange}
                onSubmit={(body, fileIds, files) => {
                  if (draftTimer.current) clearTimeout(draftTimer.current)
                  if (around) setParam('m', null)
                  return actions.send(channel, body, fileIds, files)
                }}
                onSchedule={(body, at) => actions.schedule(channel.id, null, body, at)}
              />
            )}
          </>
        )}
        {tab === 'files' && <FilesTab channel={channel} />}
        {tab === 'canvases' && (
          <CanvasTab key={channel.id} channel={channel} canEdit={isMember && !channel.archivedAt} />
        )}
        {tab === 'tasks' && (
          <TasksTab
            channel={channel}
            canEdit={isMember && !channel.archivedAt}
            openTaskId={params.get('task')}
          />
        )}
        {tab === 'pins' && (
          <PinsTab
            channel={channel}
            onOpenThread={openThread}
            onForward={setForwarding}
            canPost={isMember}
            canModerate={perms.canManage}
          />
        )}
      </section>
      {threadId && (
        <ThreadPanel
          key={threadId}
          channel={channel}
          rootId={threadId}
          canPost={isMember && !channel.archivedAt}
          canModerate={perms.canManage && !isDirect(channel)}
          onClose={() => setParam('thread', null)}
          onForward={setForwarding}
        />
      )}
      <ChannelDetails
        channel={channel}
        open={!!details}
        onOpenChange={(o) => !o && setDetails(null)}
        tab={details ?? 'about'}
        onTabChange={setDetails}
      />
      <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />
    </div>
  )
}
