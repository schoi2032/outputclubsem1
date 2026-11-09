import { describe, expect, it } from 'vitest'
import {
  assignableRoles,
  type ChannelAccessContext,
  can,
  canActOnMember,
  canInChannel,
} from './permissions'

const base: ChannelAccessContext = {
  orgRole: 'member',
  kind: 'public',
  channelRole: null,
  archived: false,
  postingPolicy: 'everyone',
  membersCanInvite: true,
}

describe('org permissions', () => {
  it('only admins manage members', () => {
    expect(can('member', 'members.change_role')).toBe(false)
    expect(can('admin', 'members.change_role')).toBe(true)
    expect(can('guest', 'channels.create')).toBe(false)
  })
  it('limits role assignment', () => {
    expect(assignableRoles('admin')).not.toContain('admin')
    expect(assignableRoles('owner')).toContain('owner')
    expect(canActOnMember('admin', 'admin')).toBe(false)
    expect(canActOnMember('admin', 'member')).toBe(true)
  })
})

describe('channel permissions', () => {
  it('guests cannot see public channels they are not in', () => {
    expect(canInChannel({ ...base, orgRole: 'guest' }, 'read')).toBe(false)
    expect(canInChannel(base, 'read')).toBe(true)
  })
  it('private channels require membership', () => {
    expect(canInChannel({ ...base, kind: 'private' }, 'read')).toBe(false)
    expect(canInChannel({ ...base, kind: 'private', orgRole: 'admin' }, 'read')).toBe(false)
  })
  it('announcement channels restrict posting', () => {
    const ctx = { ...base, channelRole: 'member' as const, postingPolicy: 'admins' as const }
    expect(canInChannel(ctx, 'post')).toBe(false)
    expect(canInChannel({ ...ctx, channelRole: 'admin' }, 'post')).toBe(true)
  })
  it('archived channels are read-only', () => {
    expect(canInChannel({ ...base, channelRole: 'owner', archived: true }, 'post')).toBe(false)
  })
})
