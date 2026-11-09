import type { Channel, UserSummary } from '@quid/shared'
import { displayName } from './format'

export function channelTitle(c: Channel, meId: string): string {
  if (c.kind === 'public' || c.kind === 'private') return c.name ?? 'channel'
  const others = (c.participants ?? []).filter((p) => p.id !== meId)
  if (c.kind === 'dm') return others[0] ? displayName(others[0]) : 'Note to self'
  if (c.name) return c.name
  return others.map((p) => displayName(p).split(' ')[0]).join(', ') || 'Group'
}

export function dmPartner(c: Channel, meId: string): UserSummary | undefined {
  return (c.participants ?? []).find((p) => p.id !== meId) ?? c.participants?.[0]
}

export const isDirect = (c: Channel) => c.kind === 'dm' || c.kind === 'group'

/** Prefix used in composer placeholders, headers and search results. */
export function channelRef(c: Channel, meId: string) {
  return isDirect(c) ? channelTitle(c, meId) : `#${c.name}`
}
