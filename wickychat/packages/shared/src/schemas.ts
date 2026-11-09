/** Request schemas shared by the API (validation) and the web app (forms). */
import { z } from 'zod'
import { CHANNEL_ROLES, ORG_ROLES, POSTING_POLICIES } from './permissions'

export const id = z.uuid()
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)

export const email = z
  .email('Enter a valid email address')
  .max(254)
  .transform((v) => v.trim().toLowerCase())
export const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'Password is too long')

// --- Auth -------------------------------------------------------------------
export const registerSchema = z.object({
  name: trimmed(1, 80),
  email,
  password,
  /** Must be true: the Terms of Service, Privacy Policy and Refund Policy were accepted. */
  acceptTerms: z.literal(true, {
    error: 'Please agree to the Terms of Service, Privacy Policy and Refund Policy.',
  }),
})
export const loginSchema = z.object({ email, password: z.string().min(1).max(200) })
export const forgotPasswordSchema = z.object({ email })
export const resetPasswordSchema = z.object({ token: z.string().min(16).max(200), password })
export const verifyEmailSchema = z.object({ token: z.string().min(16).max(200) })
export const changePasswordSchema = z.object({
  /** Not needed when the account has no password yet (signed up with Google). */
  currentPassword: z.string().max(200).optional(),
  newPassword: password,
})
export const updateProfileSchema = z.object({
  name: trimmed(1, 80).optional(),
  displayName: trimmed(0, 80).optional(),
  timezone: z.string().max(64).optional(),
  avatarFileId: id.nullable().optional(),
})

// --- Organizations ----------------------------------------------------------
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers and dashes')

export const RESERVED_SLUGS = new Set([
  'api',
  'app',
  'auth',
  'login',
  'logout',
  'register',
  'signup',
  'settings',
  'admin',
  'invite',
  'verify',
  'reset',
  'forgot',
  'new',
  'static',
  'assets',
  'public',
  '_next',
  'docs',
  'help',
  // Public pages.
  'developers',
  'pricing',
  'terms',
  'privacy',
  'refunds',
  'changelog',
  'welcome',
  'join',
])

export const createOrgSchema = z.object({
  name: trimmed(2, 80),
  slug: slug.refine((s) => !RESERVED_SLUGS.has(s), 'This URL is reserved'),
})
export const updateOrgSchema = z.object({
  name: trimmed(2, 80).optional(),
  description: trimmed(0, 500).optional(),
  allowedEmailDomains: z.array(z.string().trim().toLowerCase().max(253)).max(20).optional(),
})
export const inviteSchema = z.object({
  emails: z.array(email).min(1).max(50),
  role: z.enum(ORG_ROLES).default('member'),
  departmentId: id.nullable().optional(),
})
export const updateMemberSchema = z.object({
  role: z.enum(ORG_ROLES).optional(),
  title: trimmed(0, 80).optional(),
  departmentId: id.nullable().optional(),
})
export const departmentSchema = z.object({
  name: trimmed(1, 80),
  description: trimmed(0, 500).default(''),
})
export const teamSchema = z.object({
  name: trimmed(1, 80),
  description: trimmed(0, 500).default(''),
  departmentId: id.nullable().default(null),
})
export const teamMemberSchema = z.object({ userId: id, isManager: z.boolean().default(false) })
export const announcementSchema = z.object({ title: trimmed(1, 120), body: trimmed(1, 4000) })

// --- Channels & conversations -------------------------------------------------
export const channelName = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .transform((v) => v.replace(/\s+/g, '-'))
  .refine((v) => /^[\p{L}\p{N}_-]+$/u.test(v), 'Use letters, numbers, dashes and underscores')

export const createChannelSchema = z.object({
  name: channelName,
  kind: z.enum(['public', 'private']).default('public'),
  description: trimmed(0, 500).default(''),
  departmentId: id.nullable().default(null),
  teamId: id.nullable().default(null),
  postingPolicy: z.enum(POSTING_POLICIES).default('everyone'),
  memberIds: z.array(id).max(500).default([]),
})
export const updateChannelSchema = z.object({
  name: channelName.optional(),
  topic: trimmed(0, 250).optional(),
  description: trimmed(0, 500).optional(),
  postingPolicy: z.enum(POSTING_POLICIES).optional(),
  membersCanInvite: z.boolean().optional(),
  departmentId: id.nullable().optional(),
  teamId: id.nullable().optional(),
})
export const createConversationSchema = z.object({
  userIds: z.array(id).min(1).max(50),
  name: trimmed(1, 80).optional(),
})
export const updateConversationSchema = z.object({
  name: trimmed(0, 80).optional(),
  avatarFileId: id.nullable().optional(),
})
export const addMembersSchema = z.object({ userIds: z.array(id).min(1).max(500) })
export const updateChannelMemberSchema = z.object({ role: z.enum(CHANNEL_ROLES) })
export const channelPrefsSchema = z.object({
  muted: z.boolean().optional(),
  notifyLevel: z.enum(['all', 'mentions', 'none']).optional(),
})

// --- Messages -------------------------------------------------------------------
/** Rich-text body; structure is validated server-side by `sanitizeDoc`. */
export const docSchema = z.object({ type: z.literal('doc'), content: z.array(z.unknown()) }).loose()

export const sendMessageSchema = z.object({
  body: docSchema,
  parentId: id.nullable().optional(),
  fileIds: z.array(id).max(10).default([]),
  /** Client-generated id echoed back so optimistic messages can be reconciled. */
  clientId: z.string().max(64).optional(),
})
export const editMessageSchema = z.object({ body: docSchema })
export const forwardMessageSchema = z.object({
  targetChannelId: id,
  comment: docSchema.optional(),
})
export const reactionSchema = z.object({ emoji: z.string().min(1).max(64) })
export const draftSchema = z.object({ body: docSchema, parentId: id.nullable().default(null) })
export const scheduleMessageSchema = z.object({
  channelId: id,
  parentId: id.nullable().default(null),
  body: docSchema,
  sendAt: z.iso.datetime({ offset: true }),
})
export const markReadSchema = z.object({ messageId: id })

export const historyQuerySchema = z.object({
  before: id.optional(),
  after: id.optional(),
  around: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

// --- Presence -------------------------------------------------------------------
export const PRESENCE_STATUSES = ['active', 'away', 'dnd'] as const
export const setPresenceSchema = z.object({
  status: z.enum(PRESENCE_STATUSES).optional(),
  statusText: trimmed(0, 100).optional(),
  statusEmoji: z.string().max(64).optional(),
  statusExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
})

// --- Search -------------------------------------------------------------------
export const searchQuerySchema = z.object({
  q: z.string().max(500).default(''),
  type: z.enum(['all', 'messages', 'channels', 'people', 'files']).default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

// --- Notifications ----------------------------------------------------------------
export const notificationPrefsSchema = z.object({
  directMessages: z.boolean().optional(),
  mentions: z.boolean().optional(),
  threadReplies: z.boolean().optional(),
  channelActivity: z.boolean().optional(),
  announcements: z.boolean().optional(),
  emailDigest: z.boolean().optional(),
  emailOffline: z.boolean().optional(),
  muteAll: z.boolean().optional(),
})

// --- Integrations -------------------------------------------------------------------
export const WEBHOOK_EVENTS = [
  'message.created',
  'message.updated',
  'message.deleted',
  'channel.created',
  'member.joined',
] as const
export const createIncomingWebhookSchema = z.object({
  name: trimmed(1, 80),
  channelId: id,
})
export const createOutgoingWebhookSchema = z.object({
  name: trimmed(1, 80),
  url: z
    .url()
    .max(2048)
    .refine(
      (u) => u.startsWith('https://') || u.startsWith('http://localhost'),
      'Use an https URL',
    ),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  channelIds: z.array(id).max(100).default([]),
})
export const incomingWebhookPayloadSchema = z.object({
  text: z.string().min(1).max(40_000),
  username: trimmed(1, 80).optional(),
})
export const AI_PROVIDERS = ['anthropic', 'openai'] as const
export const aiProviderSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: trimmed(1, 100),
  apiKey: z.string().min(8).max(500),
  dataAccessConsent: z.literal(true, {
    error: 'An administrator must explicitly authorize data access',
  }),
})

/** Catch me up: a channel since a message (or the last N hours), or one thread. */
export const summarizeSchema = z.object({
  channelId: z.uuid(),
  threadId: z.uuid().optional(),
  afterMessageId: z.uuid().optional(),
  hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .optional(),
})

// --- Meetings -------------------------------------------------------------------
export const createMeetingSchema = z.object({
  title: trimmed(1, 120).default('Instant meeting'),
  description: trimmed(0, 2000).default(''),
  /** Omit for an instant meeting. */
  scheduledFor: z.iso.datetime({ offset: true }).nullable().default(null),
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(30),
  waitingRoom: z.boolean().default(true),
  guestAccess: z.boolean().default(false),
  channelId: id.nullable().default(null),
  inviteeIds: z.array(id).max(200).default([]),
})
export const updateMeetingSchema = z.object({
  title: trimmed(1, 120).optional(),
  description: trimmed(0, 2000).optional(),
  scheduledFor: z.iso.datetime({ offset: true }).nullable().optional(),
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
  waitingRoom: z.boolean().optional(),
  guestAccess: z.boolean().optional(),
})
export const meetingUserSchema = z.object({ userId: id })
export const meetingRoleSchema = z.object({ userId: id, role: z.enum(['co_host', 'participant']) })
export const meetingInviteSchema = z.object({ userIds: z.array(id).min(1).max(200) })

// --- Voice rooms -------------------------------------------------------------------
export const voiceRoomUpdateSchema = z.object({ mode: z.enum(['open', 'stage']) })
export const voiceRoomRoleSchema = z.object({ userId: id, role: z.enum(['speaker', 'listener']) })
export const voiceRoomHandSchema = z.object({ raised: z.boolean() })
export const guestRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name')
    .max(60)
    .refine((v) => !/[<>]/.test(v), 'Use letters and numbers'),
})
export const transcriptUploadSchema = z.object({
  segments: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(1000),
        spokenAt: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(50),
})
