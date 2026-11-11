/** Realtime protocol between the API gateway and clients over WebSocket. */
import type {
  Call,
  Channel,
  Meeting,
  Message,
  Notification,
  Presence,
  ReactionGroup,
  VoiceRoom,
} from './types'

export type ServerEvent =
  | { type: 'hello'; userId: string; connectionId: string }
  | { type: 'message.created'; orgId: string; message: Message }
  | { type: 'message.updated'; orgId: string; message: Message }
  | {
      type: 'message.deleted'
      orgId: string
      channelId: string
      messageId: string
      parentId: string | null
    }
  | { type: 'thread.updated'; orgId: string; channelId: string; message: Message }
  | {
      type: 'reaction.updated'
      orgId: string
      channelId: string
      messageId: string
      reactions: ReactionGroup[]
    }
  | { type: 'pin.updated'; orgId: string; channelId: string; messageId: string; pinned: boolean }
  | { type: 'typing'; orgId: string; channelId: string; parentId: string | null; userId: string }
  | { type: 'presence'; presence: Presence }
  | { type: 'channel.updated'; orgId: string; channel: Channel }
  | { type: 'channel.joined'; orgId: string; channel: Channel }
  | { type: 'channel.left'; orgId: string; channelId: string }
  | { type: 'channel.member_joined'; orgId: string; channelId: string; userId: string }
  | { type: 'channel.member_left'; orgId: string; channelId: string; userId: string }
  | { type: 'read.updated'; orgId: string; channelId: string; messageId: string }
  | { type: 'notification.created'; orgId: string; notification: Notification }
  | { type: 'org.updated'; orgId: string }
  /** Custom emoji or soundboard sounds were added or removed. */
  | { type: 'expressions.updated'; orgId: string; kind: 'emoji' | 'sound' }
  /** Sent to each invitee's user topic when a call starts ringing for them. */
  | { type: 'call.ringing'; orgId: string; call: Call }
  /** Sent to every participant whenever a call's state or participants change. */
  | { type: 'call.updated'; orgId: string; call: Call }
  /** Meeting state changed (participants, waiting room, ended). Sent to everyone involved. */
  | { type: 'meeting.updated'; orgId: string; meeting: Meeting }
  /** A channel's voice room changed (joins, leaves, roles, mode). Moderators recompute `canModerate` client-side. */
  | { type: 'voice_room.updated'; orgId: string; room: VoiceRoom }
  /** A canvas in this channel was created, saved or deleted. */
  | {
      type: 'canvas.updated'
      orgId: string
      channelId: string
      canvasId: string
      version: number
      updatedBy: string | null
      deleted?: boolean
    }
  /** Whiteboard elements someone changed (only the ones that won the merge). */
  | {
      type: 'board.updated'
      orgId: string
      channelId: string
      canvasId: string
      userId: string
      elements: Record<string, unknown>[]
    }
  /** Where someone's pointer is on a whiteboard (live cursors). */
  | {
      type: 'board.pointer'
      channelId: string
      canvasId: string
      userId: string
      x: number
      y: number
      button: 'up' | 'down'
      gone?: boolean
    }
  /** A task in this channel changed (or was deleted). Also sent to the assignee. */
  | { type: 'task.updated'; orgId: string; channelId: string; taskId: string; deleted?: boolean }
  | { type: 'resync' }
  | { type: 'pong' }
  | { type: 'error'; message: string }

export type ClientEvent =
  | { type: 'typing'; channelId: string; parentId?: string | null }
  | { type: 'subscribe'; channelId: string }
  | { type: 'unsubscribe'; channelId: string }
  | {
      type: 'board.pointer'
      channelId: string
      canvasId: string
      x: number
      y: number
      button: 'up' | 'down'
      gone?: boolean
    }
  | { type: 'activity' }
  | { type: 'ping' }

/** Topic naming used by the event bus. */
export const topics = {
  user: (userId: string) => `user:${userId}`,
  channel: (channelId: string) => `channel:${channelId}`,
  org: (orgId: string) => `org:${orgId}`,
}
