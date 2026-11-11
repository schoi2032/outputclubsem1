/**
 * Role-based access control. This is the single source of truth for what each
 * organization role may do. The API enforces it; the web app only uses it to
 * decide what to show.
 */

export const ORG_ROLES = [
  'owner',
  'admin',
  'dept_admin',
  'team_manager',
  'member',
  'guest',
] as const
export type OrgRole = (typeof ORG_ROLES)[number]

export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 100,
  admin: 80,
  dept_admin: 60,
  team_manager: 40,
  member: 20,
  guest: 10,
}

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  dept_admin: 'Department admin',
  team_manager: 'Team manager',
  member: 'Member',
  guest: 'Guest',
}

export const ORG_ACTIONS = [
  'org.update',
  'org.delete',
  'org.announce',
  'members.invite',
  'members.invite_guest',
  'members.change_role',
  'members.remove',
  'departments.manage',
  'teams.manage',
  'channels.create',
  'channels.create_private',
  'channels.browse',
  'channels.manage_any',
  'conversations.create',
  'directory.read',
  'audit.read',
  'integrations.manage',
  'ai.manage',
  'expressions.create',
  'expressions.manage_any',
] as const
export type OrgAction = (typeof ORG_ACTIONS)[number]

const atLeast = (min: OrgRole) => (role: OrgRole) => ROLE_RANK[role] >= ROLE_RANK[min]

/**
 * Minimum role required for each org action. Department admins and team
 * managers get extra, scoped powers that are checked against the specific
 * department or team (see `canManageDepartment` / `canManageTeam`).
 */
const ORG_POLICY: Record<OrgAction, (role: OrgRole) => boolean> = {
  'org.update': atLeast('admin'),
  'org.delete': atLeast('owner'),
  'org.announce': atLeast('admin'),
  'members.invite': atLeast('dept_admin'),
  'members.invite_guest': atLeast('team_manager'),
  'members.change_role': atLeast('admin'),
  'members.remove': atLeast('admin'),
  'departments.manage': atLeast('admin'),
  'teams.manage': atLeast('dept_admin'),
  // WickyChat: only admins (teachers) make channels. Students can still start DMs and groups.
  'channels.create': atLeast('admin'),
  'channels.create_private': atLeast('admin'),
  'channels.browse': atLeast('member'),
  'channels.manage_any': atLeast('admin'),
  'conversations.create': atLeast('guest'),
  'directory.read': atLeast('member'),
  'audit.read': atLeast('admin'),
  'integrations.manage': atLeast('admin'),
  'ai.manage': atLeast('admin'),
  'expressions.create': atLeast('member'),
  'expressions.manage_any': atLeast('admin'),
}

export function can(role: OrgRole, action: OrgAction): boolean {
  return ORG_POLICY[action](role)
}

/** Roles an actor may grant. Only owners can create other owners. */
export function assignableRoles(actor: OrgRole): OrgRole[] {
  if (actor === 'owner') return [...ORG_ROLES]
  if (actor === 'admin') return ORG_ROLES.filter((r) => ROLE_RANK[r] < ROLE_RANK.admin)
  if (actor === 'dept_admin') return ['member', 'guest']
  if (actor === 'team_manager') return ['guest']
  return []
}

/** Whether `actor` may change or remove a member currently holding `target`. */
export function canActOnMember(actor: OrgRole, target: OrgRole): boolean {
  if (actor === 'owner') return true
  return ROLE_RANK[actor] > ROLE_RANK[target]
}

// ---------------------------------------------------------------------------
// Channel-level permissions
// ---------------------------------------------------------------------------

export const CHANNEL_ROLES = ['owner', 'admin', 'member'] as const
export type ChannelRole = (typeof CHANNEL_ROLES)[number]

export const CHANNEL_KINDS = ['public', 'private', 'dm', 'group'] as const
export type ChannelKind = (typeof CHANNEL_KINDS)[number]

export const POSTING_POLICIES = ['everyone', 'admins'] as const
export type PostingPolicy = (typeof POSTING_POLICIES)[number]

export type ChannelAction =
  | 'read'
  | 'join'
  | 'post'
  /** Replying in a thread. Allowed in announcement channels too. */
  | 'reply'
  | 'manage'
  | 'add_members'
  | 'remove_members'
  | 'pin'
  | 'archive'
  | 'delete'

export interface ChannelAccessContext {
  orgRole: OrgRole
  kind: ChannelKind
  /** Null when the user is not a member of the channel. */
  channelRole: ChannelRole | null
  archived: boolean
  postingPolicy: PostingPolicy
  membersCanInvite: boolean
}

export function canInChannel(ctx: ChannelAccessContext, action: ChannelAction): boolean {
  const isMember = ctx.channelRole !== null
  const isOrgAdmin = ROLE_RANK[ctx.orgRole] >= ROLE_RANK.admin
  const isChannelAdmin = ctx.channelRole === 'owner' || ctx.channelRole === 'admin'
  const isDirect = ctx.kind === 'dm' || ctx.kind === 'group'

  switch (action) {
    case 'read':
      // Guests only ever see what they were explicitly added to.
      if (isMember) return true
      return ctx.kind === 'public' && ctx.orgRole !== 'guest'
    case 'join':
      return !isMember && !ctx.archived && ctx.kind === 'public' && ctx.orgRole !== 'guest'
    case 'post':
      if (!isMember || ctx.archived) return false
      if (ctx.postingPolicy === 'admins') return isChannelAdmin || isOrgAdmin
      return true
    case 'reply':
      return isMember && !ctx.archived
    case 'pin':
      return isMember && !ctx.archived
    case 'manage':
      if (ctx.kind === 'dm') return false
      if (ctx.kind === 'group') return isMember
      return isChannelAdmin || isOrgAdmin
    case 'add_members':
      if (ctx.archived || ctx.kind === 'dm') return false
      if (ctx.kind === 'group') return isMember
      return (
        isChannelAdmin ||
        isOrgAdmin ||
        (isMember && ctx.membersCanInvite && ctx.orgRole !== 'guest')
      )
    case 'remove_members':
      if (ctx.kind === 'dm') return false
      if (ctx.kind === 'group') return isMember
      return isChannelAdmin || isOrgAdmin
    case 'archive':
      return !isDirect && (isChannelAdmin || isOrgAdmin)
    case 'delete':
      return !isDirect && (ctx.channelRole === 'owner' || isOrgAdmin)
  }
}
