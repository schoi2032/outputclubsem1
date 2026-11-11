'use client'
/**
 * Realtime client. One WebSocket per tab. Events are applied straight to the
 * React Query cache so every view updates without refetching. On reconnect
 * the cache is invalidated, which resyncs anything missed while offline
 * (Cloud Run closes long-lived requests after 60 minutes, so this is normal).
 */
import type { Call, Channel, ClientEvent, Message, ServerEvent, VoiceRoom } from '@quid/shared'
import { toast } from '@quid/ui'
import type { QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { get } from './api'
import { keys, patchMessage, removeMessage, updateChannelInList, upsertMessage } from './queries'

type Status = 'connecting' | 'open' | 'offline'

interface State {
  status: Status
  /** `${channelId}:${parentId ?? ''}` -> userId -> expiry timestamp */
  typing: Record<string, Record<string, number>>
}

let state: State = { status: 'connecting', typing: {} }
const listeners = new Set<() => void>()
const setState = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useRealtime<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state),
  )
}

/** What the user is looking at, so new messages there don't count as unread. */
export const viewing = { channelId: null as string | null, userId: null as string | null }

let socket: WebSocket | null = null
let qc: QueryClient | null = null
let attempts = 0
let stopped = true
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let everConnected = false
/** Bumped on every connect/stop so stale in-flight connects abandon themselves. */
let generation = 0

export function send(e: ClientEvent) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(e))
}

export function startRealtime(client: QueryClient, userId: string) {
  qc = client
  viewing.userId = userId
  if (!stopped) return
  stopped = false
  void connect()
  window.addEventListener('online', reconnectNow)
  document.addEventListener('visibilitychange', onVisibility)
  for (const evt of ['pointerdown', 'keydown'] as const)
    window.addEventListener(evt, onActivity, { passive: true })
}

export function stopRealtime() {
  stopped = true
  generation++
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (pingTimer) clearInterval(pingTimer)
  socket?.close()
  socket = null
  window.removeEventListener('online', reconnectNow)
  document.removeEventListener('visibilitychange', onVisibility)
}

let lastActivity = 0
function onActivity() {
  const now = Date.now()
  if (now - lastActivity > 60_000) {
    lastActivity = now
    send({ type: 'activity' })
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible') {
    onActivity()
    if (socket?.readyState !== WebSocket.OPEN) reconnectNow()
  }
}

function reconnectNow() {
  attempts = 0
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (socket?.readyState !== WebSocket.OPEN && socket?.readyState !== WebSocket.CONNECTING)
    void connect()
}

async function connect() {
  if (stopped) return
  const gen = ++generation
  setState({ status: everConnected ? 'offline' : 'connecting' })
  let url: string
  try {
    const t = await get<{ ticket: string; url: string }>('/api/realtime/ticket')
    url = `${t.url}?ticket=${encodeURIComponent(t.ticket)}`
  } catch {
    return scheduleReconnect()
  }
  // A newer connect (or a stop) happened while we were fetching the ticket.
  if (stopped || gen !== generation) return
  socket?.close()
  const ws = new WebSocket(url)
  socket = ws
  ws.onmessage = (e) => {
    if (socket !== ws) return
    try {
      handle(JSON.parse(e.data as string) as ServerEvent)
    } catch {
      // ignore malformed frames
    }
  }
  ws.onclose = () => {
    // Superseded sockets close quietly; only the current one triggers a reconnect.
    if (socket !== ws) return
    if (pingTimer) clearInterval(pingTimer)
    socket = null
    if (!stopped) {
      setState({ status: 'offline' })
      scheduleReconnect()
    }
  }
}

function scheduleReconnect() {
  if (stopped) return
  const delay = Math.min(30_000, 500 * 2 ** attempts) + Math.random() * 500
  attempts++
  reconnectTimer = setTimeout(() => void connect(), delay)
}

function typingKey(channelId: string, parentId: string | null) {
  return `${channelId}:${parentId ?? ''}`
}

function clearTyping(channelId: string, parentId: string | null, userId: string) {
  const key = typingKey(channelId, parentId)
  if (!state.typing[key]?.[userId]) return
  const { [userId]: _, ...rest } = state.typing[key]!
  setState({ typing: { ...state.typing, [key]: rest } })
}

function mentionsMe(m: Message, me: string | null) {
  const s = JSON.stringify(m.body)
  return !!me && (s.includes(`"id":"${me}"`) || s.includes('"kind":"here"'))
}

function handle(e: ServerEvent) {
  if (!qc) return
  switch (e.type) {
    case 'hello': {
      const reconnect = everConnected
      everConnected = true
      attempts = 0
      setState({ status: 'open' })
      pingTimer = setInterval(() => send({ type: 'ping' }), 25_000)
      if (viewing.channelId) send({ type: 'subscribe', channelId: viewing.channelId })
      if (reconnect) void qc.invalidateQueries()
      return
    }
    case 'message.created': {
      const m = e.message
      upsertMessage(qc, m)
      clearTyping(m.channelId, m.parentId, m.author.id)
      if (m.parentId) {
        qc.setQueryData<{ root: Message; replies: Message[] }>(keys.thread(m.parentId), (t) =>
          t && !t.replies.some((r) => r.id === m.id || (m.clientId && r.clientId === m.clientId))
            ? { ...t, replies: [...t.replies, m] }
            : t
              ? {
                  ...t,
                  replies: t.replies.map((r) => (m.clientId && r.clientId === m.clientId ? m : r)),
                }
              : t,
        )
        return
      }
      const mine = m.author.id === viewing.userId
      const looking = viewing.channelId === m.channelId && document.visibilityState === 'visible'
      updateChannelInList(
        qc,
        e.orgId,
        (c) => ({
          ...c,
          lastMessageAt: m.createdAt,
          membership:
            c.membership && !mine && !looking && m.kind !== 'system'
              ? {
                  ...c.membership,
                  unreadCount: c.membership.unreadCount + 1,
                  mentionCount: c.membership.mentionCount + (mentionsMe(m, viewing.userId) ? 1 : 0),
                }
              : c.membership,
        }),
        m.channelId,
      )
      return
    }
    case 'message.updated':
      patchMessage(qc, e.message.channelId, e.message.id, (old) => ({
        ...e.message,
        bookmarked: old.bookmarked,
      }))
      // A coinflip was accepted or called off: show it on everyone's card.
      if (e.message.duelId)
        void qc.invalidateQueries({ queryKey: ['duel', e.orgId, e.message.duelId] })
      if (e.message.bountyId)
        void qc.invalidateQueries({ queryKey: ['bounty', e.orgId, e.message.bountyId] })
      return
    case 'message.deleted':
      removeMessage(qc, e.channelId, e.messageId)
      if (e.parentId) {
        qc.setQueryData<{ root: Message; replies: Message[] }>(keys.thread(e.parentId), (t) =>
          t ? { ...t, replies: t.replies.filter((r) => r.id !== e.messageId) } : t,
        )
      }
      return
    case 'thread.updated':
      patchMessage(qc, e.channelId, e.message.id, (old) => ({
        ...old,
        replyCount: e.message.replyCount,
        lastReplyAt: e.message.lastReplyAt,
        replyUsers: e.message.replyUsers,
      }))
      return
    case 'reaction.updated':
      patchMessage(qc, e.channelId, e.messageId, (m) => ({ ...m, reactions: e.reactions }))
      return
    case 'canvas.updated':
      void qc.invalidateQueries({ queryKey: ['canvases', e.channelId] })
      // The open editor decides whether to reload (it may have unsaved edits).
      window.dispatchEvent(new CustomEvent('quid:canvas', { detail: e }))
      return
    case 'board.updated':
      window.dispatchEvent(new CustomEvent('quid:board', { detail: e }))
      return
    case 'board.pointer':
      window.dispatchEvent(new CustomEvent('quid:board-pointer', { detail: e }))
      return
    case 'task.updated':
      void qc.invalidateQueries({ queryKey: ['tasks', e.orgId] })
      return
    case 'pin.updated':
      patchMessage(qc, e.channelId, e.messageId, (m) => ({ ...m, pinned: e.pinned }))
      void qc.invalidateQueries({ queryKey: keys.pins(e.channelId) })
      return
    case 'typing': {
      const key = typingKey(e.channelId, e.parentId)
      setState({
        typing: { ...state.typing, [key]: { ...state.typing[key], [e.userId]: Date.now() + 6000 } },
      })
      return
    }
    case 'presence':
      qc.setQueriesData<Record<string, unknown>>({ queryKey: ['presence'] }, (map) =>
        map ? { ...map, [e.presence.userId]: e.presence } : map,
      )
      return
    case 'channel.updated': {
      const merge = (c: Channel) => ({
        ...e.channel,
        membership: c.membership,
        participants: e.channel.participants ?? c.participants,
      })
      updateChannelInList(qc, e.orgId, merge, e.channel.id)
      qc.setQueryData<Channel>(keys.channel(e.orgId, e.channel.id), (c) => (c ? merge(c) : c))
      return
    }
    case 'channel.joined':
      qc.setQueryData<Channel[]>(keys.channels(e.orgId), (list) =>
        list ? [...list.filter((c) => c.id !== e.channel.id), e.channel] : list,
      )
      qc.setQueryData<Channel>(keys.channel(e.orgId, e.channel.id), e.channel)
      return
    case 'channel.left':
      qc.setQueryData<Channel[]>(keys.channels(e.orgId), (list) =>
        list?.filter((c) => c.id !== e.channelId),
      )
      void qc.invalidateQueries({ queryKey: keys.channel(e.orgId, e.channelId) })
      return
    case 'channel.member_joined':
    case 'channel.member_left':
      void qc.invalidateQueries({ queryKey: keys.channelMembers(e.channelId) })
      return
    case 'read.updated':
      updateChannelInList(
        qc,
        e.orgId,
        (c) =>
          c.membership
            ? {
                ...c,
                membership: {
                  ...c.membership,
                  unreadCount: 0,
                  mentionCount: 0,
                  lastReadMessageId: e.messageId,
                },
              }
            : c,
        e.channelId,
      )
      return
    case 'notification.created':
      void qc.invalidateQueries({ queryKey: ['notifications', e.orgId] })
      qc.setQueryData<{ count: number }>(keys.unread(e.orgId), (c) =>
        c ? { count: c.count + 1 } : c,
      )
      for (const fn of notifyListeners) fn(e)
      return
    case 'org.updated':
      void qc.invalidateQueries({ queryKey: keys.org(e.orgId) })
      void qc.invalidateQueries({ queryKey: keys.me })
      return
    case 'wicky.updated':
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      void qc.invalidateQueries({ queryKey: ['trades', e.orgId] })
      void qc.invalidateQueries({ queryKey: ['auctions', e.orgId] })
      void qc.invalidateQueries({ queryKey: ['achievements'] })
      void qc.invalidateQueries({ queryKey: ['quests'] })
      if (e.text) toast.info(e.text)
      return
    case 'expressions.updated':
      void qc.invalidateQueries({ queryKey: [e.kind === 'emoji' ? 'emojis' : 'sounds', e.orgId] })
      return
    case 'call.ringing':
    case 'call.updated':
      qc.setQueryData<Call[]>(['calls-active', e.orgId], (list) => {
        if (!list) return list
        const ongoing = e.call.status === 'ringing' || e.call.status === 'active'
        const rest = list.filter((c) => c.id !== e.call.id)
        return ongoing ? [...rest, e.call] : rest
      })
      for (const fn of callListeners) fn(e)
      return
    case 'meeting.updated':
      qc.setQueryData(['meeting', e.orgId, e.meeting.code], e.meeting)
      void qc.invalidateQueries({ queryKey: ['meetings', e.orgId] })
      for (const fn of meetingListeners) fn(e)
      return
    case 'voice_room.updated':
      qc.setQueryData<VoiceRoom[]>(['voice-rooms', e.orgId], (list) => {
        if (!list) return list
        const rest = list.filter((r) => r.id !== e.room.id)
        return e.room.participants.length ? [...rest, e.room] : rest
      })
      for (const fn of roomListeners) fn(e)
      return
    case 'resync':
      void qc.invalidateQueries()
      return
    default:
      return
  }
}

type CallEvent = Extract<ServerEvent, { type: 'call.ringing' | 'call.updated' }>
const callListeners = new Set<(e: CallEvent) => void>()
export function onCallEvent(fn: (e: CallEvent) => void) {
  callListeners.add(fn)
  return () => {
    callListeners.delete(fn)
  }
}

type RoomEvent = Extract<ServerEvent, { type: 'voice_room.updated' }>
const roomListeners = new Set<(e: RoomEvent) => void>()
export function onVoiceRoomEvent(fn: (e: RoomEvent) => void) {
  roomListeners.add(fn)
  return () => {
    roomListeners.delete(fn)
  }
}

type MeetingEvent = Extract<ServerEvent, { type: 'meeting.updated' }>
const meetingListeners = new Set<(e: MeetingEvent) => void>()
export function onMeetingEvent(fn: (e: MeetingEvent) => void) {
  meetingListeners.add(fn)
  return () => {
    meetingListeners.delete(fn)
  }
}

const notifyListeners = new Set<
  (e: Extract<ServerEvent, { type: 'notification.created' }>) => void
>()
export function onNotification(
  fn: (e: Extract<ServerEvent, { type: 'notification.created' }>) => void,
) {
  notifyListeners.add(fn)
  return () => {
    notifyListeners.delete(fn)
  }
}

/** Users currently typing in a channel/thread, excluding expired entries. */
export function useTyping(channelId: string, parentId: string | null): string[] {
  const entry = useRealtime((s) => s.typing[typingKey(channelId, parentId)])
  if (!entry) return []
  const now = Date.now()
  return Object.entries(entry)
    .filter(([, exp]) => exp > now)
    .map(([id]) => id)
}

// Sweep expired typing indicators.
if (typeof window !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    let changed = false
    const next: State['typing'] = {}
    for (const [k, users] of Object.entries(state.typing)) {
      const live = Object.fromEntries(Object.entries(users).filter(([, exp]) => exp > now))
      if (Object.keys(live).length !== Object.keys(users).length) changed = true
      if (Object.keys(live).length) next[k] = live
    }
    if (changed) setState({ typing: next })
  }, 2000)
}
