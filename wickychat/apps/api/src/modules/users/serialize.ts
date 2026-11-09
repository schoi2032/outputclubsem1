import { users } from '@quid/db'
import type { UserSummary } from '@quid/shared'

type UserRow = Pick<
  typeof users.$inferSelect,
  'id' | 'name' | 'displayName' | 'avatarKey' | 'avatarAnimated' | 'isBot'
>

/** Columns needed for `toUserSummary`, for use in `select()`. */
export const userCols = {
  id: users.id,
  name: users.name,
  displayName: users.displayName,
  avatarKey: users.avatarKey,
  avatarAnimated: users.avatarAnimated,
  isBot: users.isBot,
}

/**
 * `anim=1` marks an animated image: clients show its still thumbnail
 * (`&thumb=1`) and swap in the original to play it.
 */
export function avatarUrl(fileId: string | null, animated = false): string | null {
  return fileId ? `/api/files/${fileId}/content?inline=1${animated ? '&anim=1' : ''}` : null
}

export function toUserSummary(u: UserRow): UserSummary {
  return {
    id: u.id,
    name: u.name,
    displayName: u.displayName,
    avatarUrl: avatarUrl(u.avatarKey, u.avatarAnimated),
    isBot: u.isBot,
  }
}

export const deletedUser: UserSummary = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'Deleted user',
  displayName: null,
  avatarUrl: null,
  isBot: false,
}
