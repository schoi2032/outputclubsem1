'use client'
import type {
  Channel,
  Department,
  Draft,
  Me,
  Member,
  Message,
  MessagePage,
  Notification,
  Org,
  OrgSummary,
  Presence,
  ScheduledMessage,
  Team,
  UserSummary,
} from '@quid/shared'
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import { ApiError, get } from './api'

export const keys = {
  me: ['me'] as const,
  org: (orgId: string) => ['org', orgId] as const,
  channels: (orgId: string) => ['channels', orgId] as const,
  channel: (orgId: string, id: string) => ['channel', orgId, id] as const,
  messages: (channelId: string) => ['messages', channelId] as const,
  around: (channelId: string, id: string) => ['messages-around', channelId, id] as const,
  thread: (rootId: string) => ['thread', rootId] as const,
  members: (orgId: string) => ['members', orgId] as const,
  channelMembers: (channelId: string) => ['channel-members', channelId] as const,
  presence: (orgId: string) => ['presence', orgId] as const,
  notifications: (orgId: string, kind: string) => ['notifications', orgId, kind] as const,
  unread: (orgId: string) => ['unread-count', orgId] as const,
  drafts: (orgId: string) => ['drafts', orgId] as const,
  scheduled: (orgId: string) => ['scheduled', orgId] as const,
  bookmarks: (orgId: string) => ['bookmarks', orgId] as const,
  aiStatus: (orgId: string) => ['ai-status', orgId] as const,
  pins: (channelId: string) => ['pins', channelId] as const,
  channelFiles: (channelId: string) => ['channel-files', channelId] as const,
  departments: (orgId: string) => ['departments', orgId] as const,
  teams: (orgId: string) => ['teams', orgId] as const,
}

export type MeData = { user: Me; orgs: OrgSummary[] }

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) =>
      get<MeData>('/api/me', signal).catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }),
    staleTime: 60_000,
  })
}

export function useOrg(orgId: string | undefined) {
  return useQuery({
    queryKey: keys.org(orgId ?? ''),
    queryFn: ({ signal }) => get<Org>(`/api/orgs/${orgId}`, signal),
    enabled: !!orgId,
  })
}

export function useChannels(orgId: string | undefined) {
  return useQuery({
    queryKey: keys.channels(orgId ?? ''),
    queryFn: ({ signal }) => get<Channel[]>(`/api/orgs/${orgId}/channels/mine`, signal),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}

export function useChannel(orgId: string, channelId: string) {
  return useQuery({
    queryKey: keys.channel(orgId, channelId),
    queryFn: ({ signal }) => get<Channel>(`/api/orgs/${orgId}/channels/${channelId}`, signal),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  })
}

export function useMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: keys.members(orgId ?? ''),
    queryFn: ({ signal }) => get<Member[]>(`/api/orgs/${orgId}/members`, signal),
    enabled: !!orgId,
    staleTime: 60_000,
  })
}

export function usePresence(orgId: string | undefined) {
  return useQuery({
    queryKey: keys.presence(orgId ?? ''),
    queryFn: async ({ signal }) => {
      const list = await get<Presence[]>(`/api/orgs/${orgId}/presence`, signal)
      return Object.fromEntries(list.map((p) => [p.userId, p])) as Record<string, Presence>
    },
    enabled: !!orgId,
    staleTime: 60_000,
  })
}

export function useMessages(orgId: string, channelId: string) {
  return useInfiniteQuery({
    queryKey: keys.messages(channelId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<MessagePage>(
        `/api/orgs/${orgId}/channels/${channelId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
        signal,
      ),
    getNextPageParam: (last) =>
      last.hasMoreBefore && last.messages[0] ? last.messages[0].id : null,
    staleTime: 15_000,
  })
}

export function useDepartments(orgId: string | undefined) {
  return useQuery({
    queryKey: keys.departments(orgId ?? ''),
    queryFn: ({ signal }) => get<Department[]>(`/api/orgs/${orgId}/departments`, signal),
    enabled: !!orgId,
  })
}

export function useTeams(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.teams(orgId ?? ''),
    queryFn: ({ signal }) => get<Team[]>(`/api/orgs/${orgId}/teams`, signal),
    enabled: !!orgId && enabled,
  })
}

export function useDrafts(orgId: string) {
  return useQuery({
    queryKey: keys.drafts(orgId),
    queryFn: ({ signal }) => get<Draft[]>(`/api/orgs/${orgId}/drafts`, signal),
  })
}

export function useScheduled(orgId: string) {
  return useQuery({
    queryKey: keys.scheduled(orgId),
    queryFn: ({ signal }) => get<ScheduledMessage[]>(`/api/orgs/${orgId}/scheduled`, signal),
  })
}

export function useUnreadCount(orgId: string | undefined) {
  return useQuery({
    queryKey: keys.unread(orgId ?? ''),
    queryFn: ({ signal }) =>
      get<{ count: number }>(`/api/orgs/${orgId}/notifications/unread-count`, signal),
    enabled: !!orgId,
  })
}

export type NotificationPage = { notifications: Notification[]; nextCursor: string | null }

// ---------------------------------------------------------------------------
// Cache helpers used by mutations and realtime events
// ---------------------------------------------------------------------------

type Pages = InfiniteData<MessagePage, string | null>

export function upsertMessage(qc: QueryClient, m: Message) {
  qc.setQueryData<Pages>(keys.messages(m.channelId), (data) => {
    if (!data || data.pages.length === 0) return data
    let found = false
    const pages = data.pages.map((p) => {
      const idx = p.messages.findIndex(
        (x) => x.id === m.id || (m.clientId && x.clientId === m.clientId),
      )
      if (idx === -1) return p
      found = true
      const messages = [...p.messages]
      const prev = messages[idx]!
      // A confirmed server copy replaces the optimistic one entirely (dropping local
      // fields like _status), but keeps the viewer's bookmark flag, which broadcasts omit.
      messages[idx] = { ...m, bookmarked: m.bookmarked || (prev.id === m.id && prev.bookmarked) }
      return { ...p, messages }
    })
    if (!found && !m.parentId) {
      const first = pages[0]!
      pages[0] = { ...first, messages: [...first.messages, m] }
    }
    return { ...data, pages }
  })
}

export function patchMessage(
  qc: QueryClient,
  channelId: string,
  id: string,
  fn: (m: Message) => Message,
) {
  qc.setQueryData<Pages>(keys.messages(channelId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            messages: p.messages.map((m) => (m.id === id ? fn(m) : m)),
          })),
        }
      : data,
  )
  qc.setQueriesData<{ root: Message; replies: Message[] }>({ queryKey: ['thread'] }, (t) =>
    t
      ? {
          root: t.root.id === id ? fn(t.root) : t.root,
          replies: t.replies.map((m) => (m.id === id ? fn(m) : m)),
        }
      : t,
  )
}

export function removeMessage(qc: QueryClient, channelId: string, id: string) {
  qc.setQueryData<Pages>(keys.messages(channelId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            messages: p.messages.flatMap((m) => {
              if (m.id !== id) return [m]
              // Keep thread roots that still have replies, as a tombstone.
              return m.replyCount > 0
                ? [
                    {
                      ...m,
                      deletedAt: new Date().toISOString(),
                      text: '',
                      body: { type: 'doc' as const, content: [] },
                      reactions: [],
                      attachments: [],
                    },
                  ]
                : []
            }),
          })),
        }
      : data,
  )
}

export function updateChannelInList(
  qc: QueryClient,
  orgId: string,
  fn: (c: Channel) => Channel,
  id: string,
) {
  qc.setQueryData<Channel[]>(keys.channels(orgId), (list) =>
    list?.map((c) => (c.id === id ? fn(c) : c)),
  )
}

/** Whether the org has Claude set up, and its bot user for @mentions and DMs. */
export function useAiStatus(orgId: string) {
  const q = useQuery({
    queryKey: keys.aiStatus(orgId),
    queryFn: ({ signal }) =>
      get<{ available: boolean; assistant: UserSummary | null }>(
        `/api/orgs/${orgId}/ai/status`,
        signal,
      ),
    staleTime: 5 * 60_000,
  })
  return {
    available: q.data?.available ?? false,
    assistant: q.data?.available ? q.data.assistant : null,
  }
}

export function useAiAvailable(orgId: string) {
  return useAiStatus(orgId).available
}
