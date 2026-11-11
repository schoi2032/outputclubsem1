'use client'
import type { Channel, ChannelRole, OrgRole, PresenceStatus, UserSummary } from '@quid/shared'
import { canInChannel } from '@quid/shared'
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { del, errorMessage, get, patch, post } from '@/lib/api'
import { channelTitle, isDirect } from '@/lib/channels'
import { displayName } from '@/lib/format'
import { keys } from '@/lib/queries'
import { PeoplePicker } from '../dialogs/people-picker'
import { useOrgContext } from '../org-context'

type ChannelMember = UserSummary & {
  channelRole: ChannelRole
  orgRole: OrgRole | null
  title: string | null
  presence: PresenceStatus
}

export function useChannelPermissions(channel: Channel | undefined) {
  const { org } = useOrgContext()
  if (!channel)
    return {
      canPost: false,
      canManage: false,
      canAdd: false,
      canRemove: false,
      canArchive: false,
      canDelete: false,
      canJoin: false,
    }
  const ctx = {
    orgRole: org.role,
    kind: channel.kind,
    channelRole: channel.membership?.role ?? null,
    archived: !!channel.archivedAt,
    postingPolicy: channel.postingPolicy,
    membersCanInvite: channel.membersCanInvite,
  }
  return {
    canPost: canInChannel(ctx, 'post'),
    canManage: canInChannel(ctx, 'manage'),
    canAdd: canInChannel(ctx, 'add_members'),
    canRemove: canInChannel(ctx, 'remove_members'),
    canArchive: canInChannel({ ...ctx, archived: false }, 'archive'),
    canDelete: canInChannel(ctx, 'delete'),
    canJoin: canInChannel(ctx, 'join'),
  }
}

export function ChannelDetails({
  channel,
  open,
  onOpenChange,
  tab,
  onTabChange,
}: {
  channel: Channel
  open: boolean
  onOpenChange: (o: boolean) => void
  tab: string
  onTabChange: (t: string) => void
}) {
  const { api, org, me, base } = useOrgContext()
  const qc = useQueryClient()
  const router = useRouter()
  const perms = useChannelPermissions(channel)
  const direct = isDirect(channel)

  const members = useQuery({
    queryKey: keys.channelMembers(channel.id),
    queryFn: ({ signal }) => get<ChannelMember[]>(`${api}/channels/${channel.id}/members`, signal),
    enabled: open,
  })

  const [name, setName] = useState(channel.name ?? '')
  const [topic, setTopic] = useState(channel.topic)
  const [description, setDescription] = useState(channel.description)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState<string[]>([])
  const [confirm, setConfirm] = useState<null | 'leave' | 'archive' | 'delete'>(null)

  useEffect(() => {
    if (!open) return
    setName(channel.name ?? '')
    setTopic(channel.topic)
    setDescription(channel.description)
  }, [open, channel])

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: keys.channel(org.id, channel.id) })
    await qc.invalidateQueries({ queryKey: keys.channels(org.id) })
  }

  const save = async () => {
    setSaving(true)
    try {
      if (direct) await patch(`${api}/conversations/${channel.id}`, { name })
      else await patch(`${api}/channels/${channel.id}`, { name, topic, description })
      await refresh()
      toast.success('Saved')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const setPref = async (body: { muted?: boolean; notifyLevel?: string }) => {
    try {
      await patch(`${api}/channels/${channel.id}/prefs`, body)
      await refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const doConfirm = async () => {
    const action = confirm
    setConfirm(null)
    try {
      if (action === 'leave') await post(`${api}/channels/${channel.id}/leave`)
      if (action === 'archive')
        await post(`${api}/channels/${channel.id}/${channel.archivedAt ? 'unarchive' : 'archive'}`)
      if (action === 'delete') await del(`${api}/channels/${channel.id}`)
      await refresh()
      if (action !== 'archive') {
        onOpenChange(false)
        router.push(base)
      }
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const title = direct ? channelTitle(channel, me.id) : `#${channel.name}`
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title={title} wide>
          <Tabs value={tab} onValueChange={onTabChange}>
            <TabsList>
              <TabsTrigger value="about">About</TabsTrigger>
              <TabsTrigger value="members">
                Members {members.data ? `· ${members.data.length}` : ''}
              </TabsTrigger>
              {channel.membership && <TabsTrigger value="settings">Settings</TabsTrigger>}
            </TabsList>

            <TabsContent value="about" className="pt-4">
              {channel.kind === 'dm' ? (
                <p className="text-[13px] text-fg-muted">
                  Direct messages are private between the two of you.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  <Field label={direct ? 'Conversation name' : 'Name'}>
                    {(p) => (
                      <Input
                        {...p}
                        value={name}
                        disabled={!perms.canManage}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={direct ? 'Optional' : undefined}
                      />
                    )}
                  </Field>
                  {!direct && (
                    <>
                      <Field label="Topic" hint="Shown in the channel header.">
                        {(p) => (
                          <Input
                            {...p}
                            value={topic}
                            maxLength={250}
                            disabled={!perms.canManage}
                            onChange={(e) => setTopic(e.target.value)}
                          />
                        )}
                      </Field>
                      <Field label="Description">
                        {(p) => (
                          <Textarea
                            {...p}
                            value={description}
                            maxLength={500}
                            disabled={!perms.canManage}
                            onChange={(e) => setDescription(e.target.value)}
                          />
                        )}
                      </Field>
                    </>
                  )}
                  <p className="text-xs text-fg-subtle">
                    Created{' '}
                    {new Date(channel.createdAt).toLocaleDateString(undefined, {
                      dateStyle: 'long',
                    })}
                    {channel.kind === 'private' && ' · Private channel'}
                    {channel.postingPolicy === 'admins' && ' · Only admins can post'}
                  </p>
                  {perms.canManage && (
                    <div className="flex justify-end">
                      <Button variant="primary" loading={saving} onClick={save}>
                        Save changes
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="members" className="pt-4">
              {perms.canAdd && (
                <div className="mb-4 flex flex-col gap-2">
                  <PeoplePicker
                    value={adding}
                    onChange={setAdding}
                    exclude={members.data?.map((m) => m.id) ?? []}
                  />
                  {adding.length > 0 && (
                    <Button
                      variant="primary"
                      className="self-end"
                      onClick={async () => {
                        try {
                          await post(`${api}/channels/${channel.id}/members`, { userIds: adding })
                          setAdding([])
                          void members.refetch()
                          void refresh()
                        } catch (e) {
                          toast.error(errorMessage(e))
                        }
                      }}
                    >
                      <UserPlus /> Add {adding.length}
                    </Button>
                  )}
                </div>
              )}
              <ul className="flex flex-col">
                {members.data?.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-bg-subtle"
                  >
                    <Avatar
                      name={m.name}
                      id={m.id}
                      src={m.avatarUrl}
                      decoration={m.decoration}
                      size="md"
                      presence={m.isBot ? undefined : m.presence}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {displayName(m)}{' '}
                        {m.id === me.id && (
                          <span className="font-normal text-fg-subtle">(you)</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-fg-subtle">
                        {m.isBot ? 'Bot' : m.title || (m.orgRole === 'guest' ? 'Guest' : '')}
                      </p>
                    </div>
                    {!direct && m.channelRole !== 'member' && (
                      <span className="text-xs text-fg-subtle capitalize">
                        Channel {m.channelRole}
                      </span>
                    )}
                    {m.id !== me.id && (perms.canRemove || (perms.canManage && !direct)) && (
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton label={`Manage ${m.name}`} size="sm">
                            <MoreHorizontal />
                          </IconButton>
                        </MenuTrigger>
                        <MenuContent align="end">
                          {perms.canManage &&
                            !direct &&
                            (['admin', 'member'] as const)
                              .filter((r) => r !== m.channelRole)
                              .map((r) => (
                                <MenuItem
                                  key={r}
                                  onSelect={async () => {
                                    try {
                                      await patch(`${api}/channels/${channel.id}/members/${m.id}`, {
                                        role: r,
                                      })
                                      void members.refetch()
                                    } catch (e) {
                                      toast.error(errorMessage(e))
                                    }
                                  }}
                                >
                                  Make channel {r}
                                </MenuItem>
                              ))}
                          {perms.canRemove && (
                            <MenuItem
                              danger
                              onSelect={async () => {
                                try {
                                  await del(`${api}/channels/${channel.id}/members/${m.id}`)
                                  void members.refetch()
                                } catch (e) {
                                  toast.error(errorMessage(e))
                                }
                              }}
                            >
                              Remove from {direct ? 'conversation' : 'channel'}
                            </MenuItem>
                          )}
                        </MenuContent>
                      </Menu>
                    )}
                  </li>
                ))}
              </ul>
            </TabsContent>

            {channel.membership && (
              <TabsContent value="settings" className="flex flex-col gap-5 pt-4">
                <section>
                  <h3 className="text-[13px] font-semibold">Notifications</h3>
                  <div className="mt-2 flex items-center justify-between gap-4 text-[13px]">
                    <span>Notify me about</span>
                    <Select
                      className="w-48"
                      value={channel.membership.notifyLevel}
                      onChange={(e) => void setPref({ notifyLevel: e.target.value })}
                    >
                      <option value="all">All new messages</option>
                      <option value="mentions">Mentions and threads</option>
                      <option value="none">Nothing</option>
                    </Select>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-4 text-[13px]">
                    <span>
                      Mute
                      <span className="block text-xs text-fg-subtle">
                        Muted conversations don't show unread badges.
                      </span>
                    </span>
                    <Switch
                      checked={channel.membership.muted}
                      onCheckedChange={(v) => void setPref({ muted: v })}
                      label="Mute"
                    />
                  </div>
                </section>

                {perms.canManage && !direct && (
                  <section>
                    <h3 className="text-[13px] font-semibold">Permissions</h3>
                    <div className="mt-2 flex items-center justify-between gap-4 text-[13px]">
                      <span>Who can post</span>
                      <Select
                        className="w-48"
                        value={channel.postingPolicy}
                        onChange={async (e) => {
                          try {
                            await patch(`${api}/channels/${channel.id}`, {
                              postingPolicy: e.target.value,
                            })
                            void refresh()
                          } catch (err) {
                            toast.error(errorMessage(err))
                          }
                        }}
                      >
                        <option value="everyone">Everyone</option>
                        <option value="admins">Channel admins only</option>
                      </Select>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-4 text-[13px]">
                      <span>Members can add people</span>
                      <Switch
                        checked={channel.membersCanInvite}
                        label="Members can add people"
                        onCheckedChange={async (v) => {
                          try {
                            await patch(`${api}/channels/${channel.id}`, { membersCanInvite: v })
                            void refresh()
                          } catch (err) {
                            toast.error(errorMessage(err))
                          }
                        }}
                      />
                    </div>
                  </section>
                )}

                <section className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button onClick={() => setConfirm('leave')}>
                    {channel.kind === 'dm'
                      ? 'Close conversation'
                      : `Leave ${direct ? 'conversation' : 'channel'}`}
                  </Button>
                  {perms.canArchive && (
                    <Button onClick={() => setConfirm('archive')}>
                      {channel.archivedAt ? 'Unarchive' : 'Archive channel'}
                    </Button>
                  )}
                  {perms.canDelete && (
                    <Button variant="danger-ghost" onClick={() => setConfirm('delete')}>
                      Delete channel
                    </Button>
                  )}
                </section>
              </TabsContent>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent
          title={
            confirm === 'delete'
              ? `Delete ${title}?`
              : confirm === 'archive'
                ? channel.archivedAt
                  ? `Unarchive ${title}?`
                  : `Archive ${title}?`
                : `Leave ${title}?`
          }
          description={
            confirm === 'delete'
              ? 'All messages and files in this channel will be permanently deleted. This cannot be undone.'
              : confirm === 'archive'
                ? channel.archivedAt
                  ? 'Members will be able to post again.'
                  : 'The channel becomes read-only. Members keep its history and you can unarchive it later.'
                : channel.kind === 'private'
                  ? "You'll need to be added back to rejoin."
                  : channel.kind === 'dm'
                    ? "It'll reappear when someone sends a new message."
                    : 'You can rejoin at any time.'
          }
        >
          <DialogFooter>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === 'delete' ? 'danger' : 'primary'} onClick={doConfirm}>
              {confirm === 'delete'
                ? 'Delete'
                : confirm === 'archive'
                  ? channel.archivedAt
                    ? 'Unarchive'
                    : 'Archive'
                  : 'Leave'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
