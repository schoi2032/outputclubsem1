/**
 * WickyChat database schema.
 *
 * Conventions
 * - Primary keys are UUIDv7 (time-ordered), so `id` doubles as a stable sort key
 *   for keyset pagination.
 * - Every tenant-owned row carries `org_id`. Repositories always filter on it.
 * - Timestamps are `timestamptz`.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

const pk = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7())
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const createdAt = () => ts('created_at').notNull().defaultNow()
const orgRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' })

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    displayName: text('display_name'),
    avatarKey: text('avatar_key'),
    /** The avatar is a GIF or animated WebP: shown still, and played on hover. */
    avatarAnimated: boolean('avatar_animated').notNull().default(false),
    passwordHash: text('password_hash'),
    emailVerifiedAt: ts('email_verified_at'),
    timezone: text('timezone'),
    isBot: boolean('is_bot').notNull().default(false),
    /** Bots belong to exactly one org; humans to none (they join via memberships). */
    botOrgId: uuid('bot_org_id'),
    /** When the person agreed to the Terms of Service, Privacy Policy and Refund Policy. */
    termsAcceptedAt: ts('terms_accepted_at'),
    /** Personal preferences (appearance, messages, composer, sidebar). See @quid/shared. */
    preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    index('users_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
)

/** External identities (future OIDC / SAML / SCIM). */
export const identities = pgTable(
  'identities',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    orgId: uuid('org_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('identities_provider_subject_uq').on(t.provider, t.subject)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** How this session signed in; workspaces can require Google. */
    method: text('method').$type<'password' | 'google'>().notNull().default('password'),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
)

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['verify_email', 'reset_password'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('email_tokens_hash_uq').on(t.tokenHash)],
)

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: pk(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    logoKey: text('logo_key'),
    allowedEmailDomains: text('allowed_email_domains').array().notNull().default(sql`'{}'::text[]`),
    /** Reserved for retention / residency settings. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    isDemo: boolean('is_demo').notNull().default(false),
    /** The "Claude" bot user that answers @mentions, created when AI is set up. */
    assistantBotId: uuid('assistant_bot_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('organizations_slug_uq').on(t.slug)],
)

export const orgMemberships = pgTable(
  'org_memberships',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['owner', 'admin', 'dept_admin', 'team_manager', 'member', 'guest'],
    }).notNull(),
    title: text('title'),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    /** Answers to the org's custom profile fields, keyed by field id. */
    profile: jsonb('profile').$type<Record<string, string>>().notNull().default({}),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    deactivatedAt: ts('deactivated_at'),
  },
  (t) => [
    uniqueIndex('org_memberships_org_user_uq').on(t.orgId, t.userId),
    index('org_memberships_user_idx').on(t.userId),
  ],
)

export const invitations = pgTable(
  'invitations',
  {
    id: pk(),
    orgId: orgRef(),
    email: text('email').notNull(),
    role: text('role', {
      enum: ['owner', 'admin', 'dept_admin', 'team_manager', 'member', 'guest'],
    }).notNull(),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('invitations_token_uq').on(t.tokenHash),
    index('invitations_org_email_idx').on(t.orgId, sql`lower(${t.email})`),
  ],
)

export const departments = pgTable(
  'departments',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('departments_org_name_uq').on(t.orgId, sql`lower(${t.name})`)],
)

export const teams = pgTable(
  'teams',
  {
    id: pk(),
    orgId: orgRef(),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('teams_org_name_uq').on(t.orgId, sql`lower(${t.name})`)],
)

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    isManager: boolean('is_manager').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index('team_members_user_idx').on(t.userId),
  ],
)

// ---------------------------------------------------------------------------
// Channels and conversations
//
// Public/private channels, DMs and group conversations share one table
// (`kind`), so membership, read state, messages and search work uniformly.
// ---------------------------------------------------------------------------

export const channels = pgTable(
  'channels',
  {
    id: pk(),
    orgId: orgRef(),
    kind: text('kind', { enum: ['public', 'private', 'dm', 'group'] }).notNull(),
    name: text('name'),
    topic: text('topic').notNull().default(''),
    description: text('description').notNull().default(''),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    postingPolicy: text('posting_policy', { enum: ['everyone', 'admins'] })
      .notNull()
      .default('everyone'),
    membersCanInvite: boolean('members_can_invite').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    /** For DMs: sorted participant ids, so a pair maps to exactly one DM. */
    dmKey: text('dm_key'),
    avatarKey: text('avatar_key'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    archivedAt: ts('archived_at'),
    lastMessageAt: ts('last_message_at'),
  },
  (t) => [
    uniqueIndex('channels_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.kind} in ('public','private')`),
    uniqueIndex('channels_dm_key_uq').on(t.orgId, t.dmKey).where(sql`${t.dmKey} is not null`),
    index('channels_org_kind_idx').on(t.orgId, t.kind),
    index('channels_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
)

export const channelMembers = pgTable(
  'channel_members',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    role: text('role', { enum: ['owner', 'admin', 'member'] })
      .notNull()
      .default('member'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    lastReadMessageId: uuid('last_read_message_id'),
    lastReadAt: ts('last_read_at'),
    muted: boolean('muted').notNull().default(false),
    notifyLevel: text('notify_level', { enum: ['all', 'mentions', 'none'] })
      .notNull()
      .default('all'),
    /** DMs/groups can be hidden from the sidebar until a new message arrives. */
    hidden: boolean('hidden').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index('channel_members_user_idx').on(t.userId, t.orgId),
  ],
)

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const messages = pgTable(
  'messages',
  {
    id: pk(),
    orgId: orgRef(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    /** Thread root; null for top-level messages. */
    parentId: uuid('parent_id'),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['user', 'system', 'bot'] })
      .notNull()
      .default('user'),
    bodyJson: jsonb('body_json').notNull(),
    bodyText: text('body_text').notNull().default(''),
    search: tsvector('search').generatedAlwaysAs(sql`to_tsvector('english', body_text)`),
    forwardedFromId: uuid('forwarded_from_id'),
    /**
     * Copy of the forwarded message taken at forward time, so readers of the
     * target channel never need access to the source channel.
     */
    forwardSnapshot: jsonb('forward_snapshot').$type<{
      channelId: string
      authorId: string | null
      bodyText: string
      createdAt: string
    }>(),
    replyCount: integer('reply_count').notNull().default(0),
    lastReplyAt: ts('last_reply_at'),
    replyUserIds: uuid('reply_user_ids').array().notNull().default(sql`'{}'::uuid[]`),
    clientId: text('client_id'),
    createdAt: createdAt(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('messages_channel_top_idx')
      .on(t.channelId, t.id.desc())
      .where(sql`${t.parentId} is null`),
    index('messages_parent_idx').on(t.parentId, t.id).where(sql`${t.parentId} is not null`),
    index('messages_search_idx').using('gin', t.search),
    index('messages_org_author_idx').on(t.orgId, t.authorId, t.id.desc()),
  ],
)

export const reactions = pgTable(
  'reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
)

export const mentions = pgTable(
  'mentions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    channelId: uuid('channel_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('mentions_user_idx').on(t.userId, t.orgId, t.messageId.desc()),
  ],
)

export const files = pgTable(
  'files',
  {
    id: pk(),
    orgId: orgRef(),
    uploaderId: uuid('uploader_id').references(() => users.id, { onDelete: 'set null' }),
    storageKey: text('storage_key').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** An image with more than one frame (GIF or WebP). */
    animated: boolean('animated').notNull().default(false),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    purpose: text('purpose', { enum: ['attachment', 'avatar', 'logo', 'emoji', 'sound'] })
      .notNull()
      .default('attachment'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('files_channel_idx').on(t.channelId, t.id.desc()),
    index('files_message_idx').on(t.messageId),
    index('files_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
)

// ---------------------------------------------------------------------------
// Expressions: custom emoji and soundboard sounds, shared across an org
// ---------------------------------------------------------------------------

/** An org's own emoji, used as `:name:` in messages and reactions. */
export const customEmojis = pgTable(
  'custom_emojis',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    animated: boolean('animated').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('custom_emojis_name_uq').on(t.orgId, t.name)],
)

/** A short clip anyone in a voice room can play for everyone. */
export const soundboardSounds = pgTable(
  'soundboard_sounds',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    emoji: text('emoji'),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    /** 0–100, applied on playback. */
    volume: integer('volume').notNull().default(100),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('soundboard_sounds_org_idx').on(t.orgId, t.id)],
)

export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.messageId] }),
    index('bookmarks_user_idx').on(t.userId, t.orgId),
  ],
)

export const pins = pgTable(
  'pins',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    pinnedBy: uuid('pinned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.messageId] })],
)

export const drafts = pgTable(
  'drafts',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    bodyJson: jsonb('body_json').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('drafts_target_uq').on(
      t.userId,
      t.channelId,
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
)

export const scheduledMessages = pgTable(
  'scheduled_messages',
  {
    id: pk(),
    orgId: orgRef(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bodyJson: jsonb('body_json').notNull(),
    sendAt: ts('send_at').notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'canceled'] })
      .notNull()
      .default('pending'),
    sentMessageId: uuid('sent_message_id'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('scheduled_due_idx').on(t.sendAt).where(sql`${t.status} = 'pending'`),
    index('scheduled_author_idx').on(t.authorId, t.orgId),
  ],
)

// ---------------------------------------------------------------------------
// Presence and notifications
// ---------------------------------------------------------------------------

export const presence = pgTable('presence', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Manually chosen status. Online/offline is derived from live connections. */
  status: text('status', { enum: ['active', 'away', 'dnd'] })
    .notNull()
    .default('active'),
  statusText: text('status_text'),
  statusEmoji: text('status_emoji'),
  statusExpiresAt: ts('status_expires_at'),
  lastActiveAt: ts('last_active_at'),
})

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id'),
    title: text('title').notNull(),
    preview: text('preview').notNull().default(''),
    groupKey: text('group_key').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.orgId, t.id.desc()),
    index('notifications_unread_idx').on(t.userId, t.orgId).where(sql`${t.readAt} is null`),
  ],
)

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    directMessages: boolean('direct_messages').notNull().default(true),
    mentions: boolean('mentions').notNull().default(true),
    threadReplies: boolean('thread_replies').notNull().default(true),
    channelActivity: boolean('channel_activity').notNull().default(false),
    announcements: boolean('announcements').notNull().default(true),
    emailDigest: boolean('email_digest').notNull().default(false),
    /** Email a summary of mentions, DMs and replies that arrive while you're offline. */
    emailOffline: boolean('email_offline').notNull().default(true),
    lastOfflineEmailAt: ts('last_offline_email_at'),
    lastDigestAt: ts('last_digest_at'),
    muteAll: boolean('mute_all').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
)

// ---------------------------------------------------------------------------
// Voice & Meet (schema only in this stage; see docs/ARCHITECTURE.md)
// ---------------------------------------------------------------------------

export const calls = pgTable(
  'calls',
  {
    id: pk(),
    orgId: orgRef(),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['direct', 'group'] }).notNull(),
    status: text('status', {
      enum: ['ringing', 'active', 'ended', 'missed', 'rejected'],
    }).notNull(),
    providerRoom: text('provider_room').notNull(),
    startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    answeredAt: ts('answered_at'),
    endedAt: ts('ended_at'),
  },
  (t) => [index('calls_org_idx').on(t.orgId, t.id.desc())],
)

export const callParticipants = pgTable(
  'call_participants',
  {
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    status: text('status', { enum: ['invited', 'joined', 'left', 'declined'] }).notNull(),
    joinedAt: ts('joined_at'),
    leftAt: ts('left_at'),
  },
  (t) => [primaryKey({ columns: [t.callId, t.userId] })],
)

/** One persistent voice room per channel. People drop in and out; nobody is rung. */
export const voiceRooms = pgTable(
  'voice_rooms',
  {
    id: pk(),
    orgId: orgRef(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    providerRoom: text('provider_room').notNull(),
    /** `open`: everyone can talk. `stage`: only speakers talk; listeners raise a hand. */
    mode: text('mode', { enum: ['open', 'stage'] })
      .notNull()
      .default('open'),
    /** Extra moderators besides channel owners/admins and org admins. */
    moderatorIds: uuid('moderator_ids').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('voice_rooms_channel_uq').on(t.channelId)],
)

export const voiceRoomParticipants = pgTable(
  'voice_room_participants',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => voiceRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    role: text('role', { enum: ['speaker', 'listener'] }).notNull(),
    handRaised: boolean('hand_raised').notNull().default(false),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    index('voice_room_participants_user_idx').on(t.userId),
  ],
)

export const meetings = pgTable(
  'meetings',
  {
    id: pk(),
    orgId: orgRef(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    hostId: uuid('host_id').references(() => users.id, { onDelete: 'set null' }),
    coHostIds: uuid('co_host_ids').array().notNull().default(sql`'{}'::uuid[]`),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    waitingRoom: boolean('waiting_room').notNull().default(true),
    /** Lets people without a WickyChat account ask to join through the meeting's guest link. */
    guestAccess: boolean('guest_access').notNull().default(false),
    scheduledFor: ts('scheduled_for'),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    providerRoom: text('provider_room').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('meetings_code_uq').on(t.code),
    index('meetings_org_idx').on(t.orgId, t.id.desc()),
  ],
)

export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    role: text('role', { enum: ['host', 'co_host', 'participant'] }).notNull(),
    status: text('status', {
      enum: ['invited', 'waiting', 'joined', 'left', 'removed', 'denied'],
    }).notNull(),
    joinedAt: ts('joined_at'),
    leftAt: ts('left_at'),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.userId] })],
)

/**
 * Meeting transcript, built from live captions. Each speaker's own browser
 * transcribes only their voice, and only after they turn captions on.
 */
export const meetingTranscriptSegments = pgTable(
  'meeting_transcript_segments',
  {
    id: pk(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    speakerId: uuid('speaker_id').references(() => users.id, { onDelete: 'set null' }),
    speakerName: text('speaker_name').notNull(),
    text: text('text').notNull(),
    spokenAt: ts('spoken_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('meeting_transcript_meeting_idx').on(t.meetingId, t.spokenAt)],
)

/** Claude's notes for a meeting, written from its transcript. Readable by attendees. */
export const meetingNotes = pgTable('meeting_notes', {
  meetingId: uuid('meeting_id')
    .primaryKey()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  orgId: orgRef(),
  summary: text('summary').notNull(),
  /** Transcript lines the notes were written from, to tell when they're out of date. */
  transcriptLines: integer('transcript_lines').notNull(),
  /** Who asked for them; null when written automatically after the meeting ended. */
  generatedBy: uuid('generated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

/** People without a WickyChat account who asked to join a meeting through its guest link. */
export const meetingGuests = pgTable(
  'meeting_guests',
  {
    id: pk(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    name: text('name').notNull(),
    status: text('status', { enum: ['waiting', 'admitted', 'joined', 'left', 'denied', 'removed'] })
      .notNull()
      .default('waiting'),
    createdAt: createdAt(),
    joinedAt: ts('joined_at'),
    leftAt: ts('left_at'),
  },
  (t) => [index('meeting_guests_meeting_idx').on(t.meetingId)],
)

// ---------------------------------------------------------------------------
// Integrations, bots and AI
// ---------------------------------------------------------------------------

export const integrations = pgTable(
  'integrations',
  {
    id: pk(),
    orgId: orgRef(),
    kind: text('kind', {
      enum: ['incoming_webhook', 'outgoing_webhook', 'github', 'bot', 'plugin'],
    }).notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
    botUserId: uuid('bot_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Non-secret configuration (event list, target URL, channel filter...). */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** Hash of the incoming-webhook URL token, for lookup without storing the token. */
    tokenHash: text('token_hash'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('integrations_org_idx').on(t.orgId),
    uniqueIndex('integrations_token_uq').on(t.tokenHash).where(sql`${t.tokenHash} is not null`),
  ],
)

/** Secrets encrypted with AES-256-GCM. The key never touches the database. */
export const integrationCredentials = pgTable('integration_credentials', {
  id: pk(),
  orgId: orgRef(),
  integrationId: uuid('integration_id').references(() => integrations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  rotatedAt: ts('rotated_at'),
})

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    orgId: orgRef(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['pending', 'delivered', 'failed'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    createdAt: createdAt(),
    deliveredAt: ts('delivered_at'),
  },
  (t) => [index('webhook_deliveries_integration_idx').on(t.integrationId, t.id.desc())],
)

export const aiProviders = pgTable('ai_providers', {
  id: pk(),
  orgId: orgRef(),
  provider: text('provider', { enum: ['anthropic', 'openai'] }).notNull(),
  model: text('model').notNull(),
  credentialId: uuid('credential_id').references(() => integrationCredentials.id, {
    onDelete: 'set null',
  }),
  enabled: boolean('enabled').notNull().default(false),
  /** Explicit admin authorization to send org data to this provider. */
  dataAccessConsentAt: ts('data_access_consent_at'),
  consentedBy: uuid('consented_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})

// ---------------------------------------------------------------------------
// Audit & jobs
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    orgId: orgRef(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_org_idx').on(t.orgId, t.id.desc())],
)

/**
 * WickyChat: every time the swear filter hides words in something a person posts.
 * Only org admins (teachers) can read these, in Settings → Rule breakers.
 */
export const moderationEvents = pgTable(
  'moderation_events',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    /** What was caught. Only `swear` today. */
    kind: text('kind').notNull().default('swear'),
    /** Where it was caught: a new message, an edit, or a scheduled message. */
    source: text('source').notNull(),
    /** The words the filter hid, as typed. */
    words: text('words').array().notNull().default(sql`'{}'::text[]`),
    /** The text before censoring (capped), so teachers can see context. */
    original: text('original').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('moderation_events_org_idx').on(t.orgId, t.id.desc()),
    index('moderation_events_user_idx').on(t.orgId, t.userId, t.id.desc()),
  ],
)

/** Minimal durable job queue, drained by `/internal/cron/tick` and an in-process poller. */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    runAt: ts('run_at').notNull().defaultNow(),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    lockedAt: ts('locked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('jobs_due_idx').on(t.runAt).where(sql`${t.status} = 'pending'`)],
)

// ---------------------------------------------------------------------------
// Connected apps (WickyChat MCP server): OAuth clients, authorization codes and tokens
// ---------------------------------------------------------------------------

/** OAuth clients registered dynamically (RFC 7591), e.g. Claude. Public clients only (PKCE). */
export const oauthClients = pgTable('oauth_clients', {
  id: pk(),
  /** Public client_id handed to the client. */
  clientId: text('client_id').notNull().unique(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: createdAt(),
})

/** Short-lived, single-use authorization codes. */
export const oauthCodes = pgTable('oauth_codes', {
  id: pk(),
  codeHash: text('code_hash').notNull().unique(),
  clientId: text('client_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  orgId: orgRef(),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
})

/**
 * Bearer tokens for the API surface used by connected apps. Each one acts as one
 * person in one organization, limited to its scopes. OAuth grants carry a client
 * id and a refresh token; personal tokens don't.
 */
export const accessTokens = pgTable(
  'access_tokens',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
    clientId: text('client_id'),
    name: text('name').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at'),
    refreshHash: text('refresh_hash').unique(),
    refreshExpiresAt: ts('refresh_expires_at'),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('access_tokens_user_idx').on(t.userId, t.orgId)],
)

// ---------------------------------------------------------------------------
// Billing (Paddle): one row per organization
// ---------------------------------------------------------------------------

export const billingAccounts = pgTable('billing_accounts', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Normalized subscription status; `trialing` without a subscription is WickyChat's own trial. */
  status: text('status')
    .$type<'trialing' | 'active' | 'past_due' | 'paused' | 'canceled'>()
    .notNull()
    .default('trialing'),
  trialEndsAt: ts('trial_ends_at').notNull(),
  /** Which payment provider holds the subscription. */
  provider: text('provider').$type<'paddle' | 'paypal'>(),
  /** The provider's customer (Paddle) or payer (PayPal) ID. */
  customerId: text('customer_id'),
  /** The provider's subscription ID. */
  subscriptionId: text('subscription_id').unique(),
  /** The provider's price (Paddle) or plan (PayPal) ID. */
  priceId: text('price_id'),
  interval: text('interval').$type<'month' | 'year'>(),
  /** Seats the provider is billing for. */
  seats: integer('seats'),
  currentPeriodEnd: ts('current_period_end'),
  /** Set when a cancellation is scheduled for the end of the period. */
  cancelAt: ts('cancel_at'),
  /** occurred_at of the last applied webhook, so out-of-order events don't roll state back. */
  lastEventAt: ts('last_event_at'),
  /** Trial emails to the workspace's owners and admins, so each goes out once. */
  trialStartedEmailAt: ts('trial_started_email_at'),
  trialEndingEmailAt: ts('trial_ending_email_at'),
  trialEndedEmailAt: ts('trial_ended_email_at'),
  /** A promo code an admin applied (e.g. PH10P), used at checkout while it's valid. */
  promoCode: text('promo_code'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Plugins: apps that run on their developer's servers and talk to WickyChat over
// signed HTTPS. Installs are `integrations` rows of kind "plugin".
// ---------------------------------------------------------------------------

export interface PluginManifest {
  /** All WickyChat → plugin calls go to {baseUrl}/quid/{verify,install,command,events}. */
  baseUrl: string
  commands: { name: string; description: string; usage?: string }[]
  events: 'message.created'[]
}

export interface PluginCheck {
  id: string
  label: string
  status: 'passed' | 'failed' | 'skipped'
  detail?: string
}

export const plugins = pgTable(
  'plugins',
  {
    id: pk(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    tagline: text('tagline').notNull(),
    description: text('description').notNull().default(''),
    developerName: text('developer_name').notNull(),
    developerEmail: text('developer_email').notNull(),
    homepageUrl: text('homepage_url'),
    /** Storage key of the icon, copied in (and checked) at submission. */
    iconKey: text('icon_key'),
    manifest: jsonb('manifest').$type<PluginManifest>().notNull(),
    /**
     * pending: checks running or failed · unverified: passed automatic checks (community)
     * · verified: reviewed by the WickyChat team · suspended / rejected: unavailable.
     */
    status: text('status')
      .$type<'pending' | 'unverified' | 'verified' | 'suspended' | 'rejected'>()
      .notNull()
      .default('pending'),
    checks: jsonb('checks').$type<PluginCheck[]>().notNull().default([]),
    /** Set for private plugins: only this workspace can see and install it. */
    privateOrgId: uuid('private_org_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    /** Made and hosted by WickyChat (apps/plugins); listed from OFFICIAL_PLUGINS. */
    official: boolean('official').notNull().default(false),
    /** Signing secret shared with the developer (encrypted). */
    secretCiphertext: text('secret_ciphertext').notNull(),
    secretIv: text('secret_iv').notNull(),
    secretTag: text('secret_tag').notNull(),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('plugins_status_idx').on(t.status),
    index('plugins_private_org_idx').on(t.privateOrgId),
  ],
)

// ---------------------------------------------------------------------------
// Productivity: canvases, tasks, reminders and workflows
// ---------------------------------------------------------------------------

/** A shared document inside a channel (notes, agendas, specs). */
export const canvases = pgTable(
  'canvases',
  {
    id: pk(),
    orgId: orgRef(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** A document (rich text) or a whiteboard (Excalidraw scene). */
    kind: text('kind', { enum: ['doc', 'whiteboard'] })
      .notNull()
      .default('doc'),
    bodyJson: jsonb('body_json').notNull(),
    bodyText: text('body_text').notNull().default(''),
    /** Whiteboards: the scene's elements, merged per element by version. */
    scene: jsonb('scene').$type<Record<string, unknown>[]>(),
    /** Bumped on every save; a save must name the version it edited. */
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('canvases_channel_idx').on(t.channelId).where(sql`${t.deletedAt} is null`)],
)

export const tasks = pgTable(
  'tasks',
  {
    id: pk(),
    orgId: orgRef(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    /** The message it was made from, if any. */
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    status: text('status', { enum: ['todo', 'doing', 'done'] })
      .notNull()
      .default('todo'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: ts('due_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    /** When the "due soon" notification went out. */
    dueNotifiedAt: ts('due_notified_at'),
  },
  (t) => [
    index('tasks_channel_idx').on(t.channelId, t.status),
    index('tasks_assignee_idx').on(t.assigneeId, t.orgId),
  ],
)

/** "Remind me": about a message, or about anything (/remind). */
export const reminders = pgTable(
  'reminders',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull().default(''),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
    dueAt: ts('due_at').notNull(),
    sentAt: ts('sent_at'),
    doneAt: ts('done_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('reminders_due_idx').on(t.dueAt).where(sql`${t.sentAt} is null`),
    index('reminders_user_idx').on(t.userId, t.orgId),
  ],
)

export type WorkflowTrigger =
  | { type: 'shortcut'; channelId: string }
  | { type: 'channel_join'; channelId: string }
  | { type: 'workspace_join' }
  | { type: 'schedule'; channelId: string; time: string; days: number[]; timezone: string }
  | { type: 'keyword'; channelId: string; keyword: string }

export interface WorkflowFormField {
  id: string
  label: string
  kind: 'text' | 'long' | 'select'
  options?: string[]
  required: boolean
}

export type WorkflowStep =
  | { id: string; type: 'message'; channelId: string; text: string }
  | { id: string; type: 'dm'; to: 'trigger_user' | string; text: string }
  | {
      id: string
      type: 'task'
      channelId: string
      title: string
      assignee: 'trigger_user' | string | null
      dueInDays: number | null
    }

/** No-code automations: a trigger, an optional form, and steps. */
export const workflows = pgTable(
  'workflows',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    emoji: text('emoji').notNull().default('⚡'),
    enabled: boolean('enabled').notNull().default(true),
    trigger: jsonb('trigger').$type<WorkflowTrigger>().notNull(),
    form: jsonb('form').$type<WorkflowFormField[]>().notNull().default([]),
    steps: jsonb('steps').$type<WorkflowStep[]>().notNull().default([]),
    /** The bot that posts the workflow's messages, named after it. */
    botUserId: uuid('bot_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: ts('last_run_at'),
    lastError: text('last_error'),
    /** For schedules: the last local date (YYYY-MM-DD) it ran, so it runs once a day. */
    lastScheduledDate: text('last_scheduled_date'),
  },
  (t) => [index('workflows_org_idx').on(t.orgId)],
)
