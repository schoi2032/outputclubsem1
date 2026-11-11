/** Response shapes returned by the API. Dates are ISO strings. */

import type { OrgCustomization } from './customization'
import type { ChannelKind, ChannelRole, OrgRole, PostingPolicy } from './permissions'
import type { Preferences } from './preferences'
import type { DocNode } from './richtext'

export type PresenceStatus = 'active' | 'away' | 'dnd' | 'offline'

export interface UserSummary {
  id: string
  name: string
  displayName: string | null
  avatarUrl: string | null
  isBot: boolean
  /** WickyChat: equipped avatar decoration (a DECORATIONS id, or `u:…` for a student-made one). */
  decoration?: string | null
  /** WickyChat: font and colour(s) for this person's name. */
  nameStyle?: { font?: string; colors?: string[] } | null
}

/** WickyChat profile card details. */
export interface ProfileExtras {
  bio: string
  pronouns: string
  bannerColor: string | null
  /** Uploaded banner image, shown instead of the colour. */
  bannerUrl: string | null
  profileStyle: import('./wicky').ProfileStyle
}

export interface Me extends UserSummary, ProfileExtras {
  /** Wicky Coins balance. */
  coins: number
  /** The app theme they have on (from the Wicky Shop), ready to load. */
  appTheme: { id: string; name: string; css: string; dark: boolean | null } | null
  email: string
  emailVerified: boolean
  timezone: string | null
  createdAt: string
  /** False for accounts created with Google that never set a password. */
  hasPassword: boolean
  /** Sign-in providers linked to the account. */
  linkedProviders: string[]
  /** How the current session signed in. */
  authMethod: 'password' | 'google'
  /** WickyChat staff who review plugins. */
  platformAdmin: boolean
  /** Personal preferences, defaults filled in. */
  preferences: Preferences
}

export interface OrgSummary {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  role: OrgRole
  /** Enterprise+ workspaces can require Google sign-in. */
  requireGoogle?: boolean
  /** When the caller joined this org. */
  joinedAt?: string
  customization: OrgCustomization
}

export interface Org extends OrgSummary {
  description: string
  allowedEmailDomains: string[]
  createdAt: string
  memberCount: number
}

export interface Member extends UserSummary, ProfileExtras {
  email: string
  role: OrgRole
  title: string | null
  departmentId: string | null
  joinedAt: string
  deactivated: boolean
  presence: PresenceStatus
  statusText: string | null
  statusEmoji: string | null
  lastActiveAt: string | null
  /** Answers to the org's custom profile fields, keyed by field id. */
  profile: Record<string, string>
}

export interface Invitation {
  id: string
  email: string
  role: OrgRole
  invitedBy: UserSummary | null
  createdAt: string
  expiresAt: string
}

export interface InvitationPreview {
  orgName: string
  orgSlug: string
  email: string
  role: OrgRole
  invitedByName: string | null
  expired: boolean
  accepted: boolean
}

export interface Department {
  id: string
  name: string
  description: string
  memberCount: number
}

export interface Team {
  id: string
  name: string
  description: string
  departmentId: string | null
  members: { userId: string; isManager: boolean }[]
}

export interface Channel {
  id: string
  kind: ChannelKind
  name: string | null
  /** Everyone joins it and can't leave (e.g. #general). */
  isDefault?: boolean
  topic: string
  description: string
  departmentId: string | null
  teamId: string | null
  postingPolicy: PostingPolicy
  membersCanInvite: boolean
  archivedAt: string | null
  createdAt: string
  createdBy: string | null
  memberCount: number
  avatarUrl: string | null
  /** For DMs and groups: the other participants (excluding the viewer for DMs). */
  participants?: UserSummary[]
  /** Present when the viewer is a member. */
  membership: ChannelMembership | null
  lastMessageAt: string | null
}

export interface ChannelMembership {
  role: ChannelRole
  muted: boolean
  notifyLevel: 'all' | 'mentions' | 'none'
  lastReadMessageId: string | null
  unreadCount: number
  mentionCount: number
}

export interface Attachment {
  id: string
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  url: string
  thumbnailUrl: string | null
  isImage: boolean
}

export interface ReactionGroup {
  emoji: string
  count: number
  userIds: string[]
}

export interface Message {
  id: string
  channelId: string
  parentId: string | null
  author: UserSummary
  body: DocNode
  text: string
  kind: 'user' | 'system' | 'bot'
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  reactions: ReactionGroup[]
  attachments: Attachment[]
  replyCount: number
  lastReplyAt: string | null
  replyUsers: UserSummary[]
  pinned: boolean
  bookmarked: boolean
  forwardedFrom: {
    id: string
    channelId: string
    author: UserSummary
    text: string
    createdAt: string
  } | null
  clientId?: string
}

export interface MessagePage {
  messages: Message[]
  /** True when older messages exist before the first item. */
  hasMoreBefore: boolean
  hasMoreAfter: boolean
}

export interface Draft {
  channelId: string
  parentId: string | null
  body: DocNode
  updatedAt: string
}

export interface ScheduledMessage {
  id: string
  channelId: string
  parentId: string | null
  body: DocNode
  text: string
  sendAt: string
  status: 'pending' | 'sent' | 'failed' | 'canceled'
}

export interface Presence {
  userId: string
  status: PresenceStatus
  statusText: string | null
  statusEmoji: string | null
  statusExpiresAt: string | null
  lastActiveAt: string | null
}

export type NotificationKind =
  | 'mention'
  | 'direct_message'
  | 'thread_reply'
  | 'channel_activity'
  | 'announcement'
  | 'invitation'
  | 'incoming_call'
  | 'missed_call'
  | 'meeting_invite'
  | 'task_assigned'
  | 'task_due'
  | 'reminder'

export interface Notification {
  id: string
  kind: NotificationKind
  actor: UserSummary | null
  channelId: string | null
  channelName: string | null
  messageId: string | null
  threadId: string | null
  title: string
  preview: string
  groupKey: string
  /** In-app path to open, when it isn't a channel message (e.g. a meeting). */
  link: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationPrefs {
  directMessages: boolean
  mentions: boolean
  threadReplies: boolean
  channelActivity: boolean
  announcements: boolean
  emailDigest: boolean
  emailOffline: boolean
  muteAll: boolean
}

export interface SearchResults {
  messages: (Message & { channelName: string | null; highlight: string })[]
  channels: Channel[]
  people: Member[]
  files: (Attachment & {
    channelId: string | null
    messageId: string | null
    uploader: UserSummary
    createdAt: string
  })[]
  nextCursor: string | null
}

export interface AuditEntry {
  id: string
  action: string
  actor: UserSummary | null
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown>
  ip: string | null
  createdAt: string
}

/** WickyChat: one time the swear filter caught someone (Settings → Rule breakers). */
export interface ModerationEvent {
  id: string
  user: UserSummary & { email: string }
  channel: { id: string; name: string; kind: string } | null
  messageId: string | null
  kind: 'swear'
  source: 'message' | 'edit' | 'scheduled'
  words: string[]
  original: string
  createdAt: string
}

/** WickyChat: one person's rule-breaking totals. */
export interface ModerationOffender {
  user: UserSummary & { email: string }
  incidents: number
  words: number
  topWords: string[]
  lastAt: string
}

export interface Integration {
  id: string
  kind: 'incoming_webhook' | 'outgoing_webhook' | 'github' | 'bot' | 'plugin'
  name: string
  enabled: boolean
  channelId: string | null
  config: Record<string, unknown>
  createdAt: string
  createdBy: UserSummary | null
  /** Shown exactly once, right after creation. */
  secretUrl?: string
  signingSecret?: string
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'rejected'
export type CallParticipantStatus = 'invited' | 'joined' | 'left' | 'declined'

export interface CallParticipant {
  user: UserSummary
  status: CallParticipantStatus
  joinedAt: string | null
  leftAt: string | null
}

export interface Call {
  id: string
  channelId: string | null
  kind: 'direct' | 'group'
  status: CallStatus
  startedBy: UserSummary | null
  participants: CallParticipant[]
  createdAt: string
  answeredAt: string | null
  endedAt: string | null
}

export interface CallJoinInfo {
  call: Call
  url: string
  token: string
}

export interface MediaStatus {
  provider: string
  configured: boolean
  voice: { available: boolean }
  meet: { available: boolean }
}

export type MeetingRole = 'host' | 'co_host' | 'participant'
export type MeetingParticipantStatus =
  | 'invited'
  | 'waiting'
  | 'joined'
  | 'left'
  | 'removed'
  | 'denied'

export interface MeetingParticipant {
  user: UserSummary
  role: MeetingRole
  status: MeetingParticipantStatus
  joinedAt: string | null
  leftAt: string | null
}

export interface Meeting {
  id: string
  code: string
  title: string
  description: string
  host: UserSummary | null
  channelId: string | null
  waitingRoom: boolean
  guestAccess: boolean
  scheduledFor: string | null
  durationMinutes: number
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  status: 'scheduled' | 'live' | 'ended'
  participants: MeetingParticipant[]
  /** People without a WickyChat account (guest link). */
  guests: MeetingGuest[]
  /** Number of saved transcript lines (from live captions). */
  transcriptLines: number
  /** The viewer's role, if they have one. */
  myRole: MeetingRole | null
}

export interface MeetingGuest {
  id: string
  name: string
  status: 'waiting' | 'admitted' | 'joined' | 'left' | 'denied' | 'removed'
  joinedAt: string | null
}

/** What someone without an account sees on a meeting's guest link. */
export interface PublicMeetingPreview {
  title: string
  orgName: string
  hostName: string | null
  status: 'scheduled' | 'live' | 'ended'
  scheduledFor: string | null
}

export type GuestJoinResult =
  | { status: 'waiting' | 'denied' | 'removed' | 'ended' }
  | { status: 'joined'; url: string; token: string }

export type MeetingJoinResult =
  | { status: 'joined'; meeting: Meeting; url: string; token: string }
  | { status: 'waiting'; meeting: Meeting }

export interface VoiceRoomParticipant {
  user: UserSummary
  role: 'speaker' | 'listener'
  handRaised: boolean
  joinedAt: string
}

export interface VoiceRoom {
  id: string
  channelId: string
  name: string
  mode: 'open' | 'stage'
  moderatorIds: string[]
  participants: VoiceRoomParticipant[]
  /** Whether the viewer may moderate (mute, remove, change speakers, change mode). */
  canModerate: boolean
}

export interface VoiceRoomJoinInfo {
  room: VoiceRoom
  url: string
  token: string
}

export interface TranscriptSegment {
  id: string
  speakerId: string | null
  speakerName: string
  text: string
  spokenAt: string
}

// ---------------------------------------------------------------------------
// Productivity
// ---------------------------------------------------------------------------

export interface CanvasSummary {
  id: string
  channelId: string
  kind: 'doc' | 'whiteboard'
  title: string
  preview: string
  version: number
  updatedAt: string
  updatedBy: UserSummary | null
}

export interface Canvas extends CanvasSummary {
  body: DocNode
  /** Whiteboards: Excalidraw elements (including deleted ones, which merging needs). */
  scene: Record<string, unknown>[] | null
  createdAt: string
  createdBy: UserSummary | null
}

export type TaskStatus = 'todo' | 'doing' | 'done'

export interface Task {
  id: string
  channelId: string
  channelName: string | null
  messageId: string | null
  title: string
  notes: string
  status: TaskStatus
  assignee: UserSummary | null
  dueAt: string | null
  createdBy: UserSummary | null
  createdAt: string
  completedAt: string | null
}

export interface Reminder {
  id: string
  text: string
  dueAt: string
  sentAt: string | null
  doneAt: string | null
  message: Message | null
  channelId: string | null
  createdAt: string
}
