'use client'
import type { Channel } from '@quid/shared'
import { can } from '@quid/shared'
import {
  Avatar,
  Count,
  cn,
  IconButton,
  Kbd,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  PresenceDot,
  Skeleton,
  Tooltip,
} from '@quid/ui'
import {
  Bookmark,
  Building2,
  ChevronDown,
  ChevronRight,
  Hash,
  Headphones,
  ListTodo,
  Lock,
  Megaphone,
  PenSquare,
  Plus,
  Search,
  SendHorizontal,
  Settings,
  Users,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { channelTitle, dmPartner, isDirect } from '@/lib/channels'
import { usePreference } from '@/lib/preferences'
import { useReminders, useTasks } from '@/lib/productivity'
import { useChannels, useDepartments, useDrafts, usePresence, useTeams } from '@/lib/queries'
import { CreateChannelDialog } from '../dialogs/create-channel-dialog'
import { NewMessageDialog } from '../dialogs/new-message-dialog'
import { useOrgContext } from '../org-context'
import { PluginsSidebarItems } from '../plugins/sidebar-section'
import { useVoiceRooms } from '../voice-rooms/voice-room-provider'
import { openCommandPalette, useIsMac } from './command-palette'
import { UserMenu } from './user-menu'

function useCollapsed(key: string): [boolean, () => void] {
  const [v, setV] = useState(false)
  useEffect(() => {
    try {
      setV(localStorage.getItem(`quid-collapsed:${key}`) === '1')
    } catch {}
  }, [key])
  return [
    v,
    () =>
      setV((x) => {
        try {
          localStorage.setItem(`quid-collapsed:${key}`, x ? '0' : '1')
        } catch {}
        return !x
      }),
  ]
}

function Section({
  id,
  title,
  icon,
  children,
  action,
  empty,
  tour,
}: {
  id: string
  tour?: string
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
  empty?: boolean
}) {
  const [collapsed, toggle] = useCollapsed(id)
  return (
    <section className="mt-3" data-tour={tour}>
      <div className="group flex h-7 items-center pr-2 pl-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-[12px] font-medium text-fg-subtle transition-colors duration-150 hover:text-fg"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          {icon}
          <span className="truncate">{title}</span>
        </button>
        <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {action}
        </span>
      </div>
      {!collapsed && !empty && <ul className="mt-0.5 flex flex-col gap-px px-2">{children}</ul>}
    </section>
  )
}

/** Decorative, so section names stay plain for screen readers and tests. */
function SectionEmoji({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="text-[11px] leading-none">
      {children}
    </span>
  )
}

function ChannelRow({ c }: { c: Channel }) {
  const { base, me, org } = useOrgContext()
  const pathname = usePathname()
  const presence = usePresence(org.id)
  const active = pathname.startsWith(`${base}/c/${c.id}`)
  const m = c.membership
  const unread = !!m && m.unreadCount > 0 && !m.muted
  const mentions = m?.mentionCount ?? 0
  const partner = c.kind === 'dm' ? dmPartner(c, me.id) : undefined
  const voice = useVoiceRooms().activeRooms.find((r) => r.channelId === c.id)
  const compact = usePreference('density') === 'compact'

  let icon: React.ReactNode
  if (c.kind === 'dm' && partner) {
    icon = (
      <span className="relative">
        <Avatar name={partner.name} id={partner.id} src={partner.avatarUrl} size="xs" />
        {!partner.isBot && (
          <PresenceDot
            state={presence.data?.[partner.id]?.status ?? 'offline'}
            className={cn(
              'absolute -right-0.5 -bottom-0.5 size-2 ring-[1.5px]',
              active
                ? '[--presence-ring:var(--q-bg-emphasis)]'
                : '[--presence-ring:var(--q-bg-subtle)]',
            )}
          />
        )}
      </span>
    )
  } else if (c.kind === 'group') {
    icon = (
      <span className="flex size-5 items-center justify-center rounded-[5px] bg-bg-emphasis text-2xs font-semibold text-fg-muted">
        {c.participants?.length ?? c.memberCount}
      </span>
    )
  } else {
    const Icon = c.kind === 'private' ? Lock : c.postingPolicy === 'admins' ? Megaphone : Hash
    icon = <Icon className="size-4 text-fg-subtle" strokeWidth={2} />
  }

  return (
    <li>
      <Link
        href={`${base}/c/${c.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'q-nav flex items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-muted hover:bg-bg-muted',
          compact ? 'h-[26px]' : 'h-[30px]',
          active && 'bg-bg-emphasis text-fg hover:bg-bg-emphasis',
          (unread || mentions > 0) && 'font-semibold text-fg',
          m?.muted && !active && 'opacity-55',
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{channelTitle(c, me.id)}</span>
        {voice && voice.participants.length > 0 && (
          <span
            className="flex items-center gap-0.5 text-2xs font-semibold text-success"
            title={`${voice.participants.length} in the voice room`}
          >
            <Headphones className="size-3" />
            {voice.participants.length}
          </span>
        )}
        {mentions > 0 ? (
          <Count n={mentions} />
        ) : isDirect(c) && unread ? (
          <Count n={m!.unreadCount} />
        ) : null}
      </Link>
    </li>
  )
}

export function Sidebar() {
  const { org, base, me } = useOrgContext()
  const pathname = usePathname()
  const channels = useChannels(org.id)
  const departments = useDepartments(org.id)
  const teams = useTeams(org.id, org.role !== 'guest')
  const drafts = useDrafts(org.id)
  const [createOpen, setCreateOpen] = useState(false)
  const [dmOpen, setDmOpen] = useState(false)
  // WickyChat: only admins (teachers) make channels; everyone joins the school automatically.
  const canCreate = can(org.role, 'channels.create')
  const isAdmin = org.role === 'owner' || org.role === 'admin'
  const isMac = useIsMac()
  const sort = usePreference('sidebarSort')
  const unreadOnly = usePreference('sidebarUnreadOnly')
  const hideMuted = usePreference('sidebarHideMuted')
  const showShortcuts = usePreference('sidebarShortcuts')

  // The command palette's "New message".
  useEffect(() => {
    const open = () => setDmOpen(true)
    window.addEventListener('quid:compose', open)
    return () => window.removeEventListener('quid:compose', open)
  }, [])

  const groups = useMemo(() => {
    const visible = (c: Channel) => {
      // The open conversation always stays visible.
      if (pathname.includes(c.id)) return true
      if (c.archivedAt) return false
      const m = c.membership
      if (hideMuted && m?.muted) return false
      if (unreadOnly) return !!m && ((m.unreadCount > 0 && !m.muted) || m.mentionCount > 0)
      return true
    }
    const list = (channels.data ?? []).filter(visible)
    const byRecent = (a: Channel, b: Channel) =>
      (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
    const byName =
      sort === 'recent'
        ? byRecent
        : (a: Channel, b: Channel) => channelTitle(a, me.id).localeCompare(channelTitle(b, me.id))
    const direct = list.filter(isDirect).sort(byRecent)
    const channelsOnly = list.filter((c) => !isDirect(c))
    const dept = new Map<string, Channel[]>()
    const team = new Map<string, Channel[]>()
    const general: Channel[] = []
    for (const c of channelsOnly) {
      if (c.teamId) team.set(c.teamId, [...(team.get(c.teamId) ?? []), c])
      else if (c.departmentId) dept.set(c.departmentId, [...(dept.get(c.departmentId) ?? []), c])
      else general.push(c)
    }
    return {
      general: general.sort(byName),
      dept: [...dept.entries()].map(([id, cs]) => ({
        id,
        name: departments.data?.find((d) => d.id === id)?.name ?? 'Department',
        channels: cs.sort(byName),
      })),
      team: [...team.entries()].map(([id, cs]) => ({
        id,
        name: teams.data?.find((t) => t.id === id)?.name ?? 'Team',
        channels: cs.sort(byName),
      })),
      direct,
    }
  }, [channels.data, departments.data, teams.data, me.id, pathname, sort, unreadOnly, hideMuted])

  const myTasks = useTasks({ mine: 'assigned' })
  const openTasks = (myTasks.data ?? []).filter((t) => t.status !== 'done').length
  const reminders = useReminders()
  const dueReminders = (reminders.data ?? []).filter((r) => r.sentAt && !r.doneAt).length
  const quick = [
    { href: `${base}/saved`, label: 'Later', icon: Bookmark, count: dueReminders },
    { href: `${base}/tasks`, label: 'My tasks', icon: ListTodo, count: openTasks },
    ...(org.role !== 'guest' ? [{ href: `${base}/workflows`, label: 'Workflows', icon: Zap }] : []),
    {
      href: `${base}/drafts`,
      label: 'Drafts & scheduled',
      icon: SendHorizontal,
      count: drafts.data?.length ?? 0,
    },
    ...(org.role !== 'guest' ? [{ href: `${base}/people`, label: 'People', icon: Users }] : []),
  ]

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
        <Menu>
          <MenuTrigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none transition-colors duration-150 hover:bg-bg-muted">
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">
              {org.name}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
          </MenuTrigger>
          <MenuContent align="start" className="w-60">
            <MenuLabel>{org.name}</MenuLabel>
            {org.role !== 'guest' && (
              <MenuItem icon={<Users />} asChild>
                <Link href={`${base}/people`}>People directory</Link>
              </MenuItem>
            )}
            <MenuItem icon={<Settings />} asChild>
              <Link href={isAdmin ? `${base}/settings/org` : `${base}/settings/profile`}>
                {isAdmin ? 'Organization settings' : 'Settings'}
              </Link>
            </MenuItem>
          </MenuContent>
        </Menu>
        <Tooltip content="New message">
          <IconButton label="New message" onClick={() => setDmOpen(true)}>
            <PenSquare />
          </IconButton>
        </Tooltip>
        <span className="md:hidden">
          <UserMenu side="bottom" />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <button
          type="button"
          data-tour="search"
          onClick={openCommandPalette}
          className="mx-3 mt-3 flex h-8 w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-border bg-bg px-2.5 text-[13px] text-fg-subtle shadow-[0_1px_1px_rgb(0_0_0/0.02)] transition-[border-color,color,box-shadow] duration-150 hover:border-border-strong hover:text-fg-muted hover:shadow-[0_2px_6px_-2px_hsl(var(--q-shadow-color)/0.14)]"
        >
          <Search className="size-3.5" />
          <span className="flex-1 truncate text-left">Search {org.name}</span>
          <span className="hidden items-center gap-0.5 md:flex">
            <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        {showShortcuts && (
          <ul className="mt-2 flex flex-col gap-px px-2">
            {quick.map((q) => (
              <li key={q.href}>
                <Link
                  href={q.href}
                  aria-current={pathname === q.href ? 'page' : undefined}
                  className={cn(
                    'q-nav flex h-[30px] items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-muted hover:bg-bg-muted',
                    pathname === q.href && 'bg-bg-emphasis text-fg',
                  )}
                >
                  <q.icon className="size-4 text-fg-subtle" />
                  <span className="flex-1">{q.label}</span>
                  {q.count ? <Count n={q.count} tone="muted" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {channels.isLoading ? (
          <div className="mt-5 flex flex-col gap-2 px-4">
            {[70, 55, 80, 60, 45].map((w) => (
              <Skeleton key={w} className="h-4" />
            ))}
          </div>
        ) : channels.isError ? (
          <p className="mt-6 px-4 text-[13px] text-fg-muted">
            Couldn't load channels.{' '}
            <button
              type="button"
              className="font-medium text-accent-text hover:underline"
              onClick={() => channels.refetch()}
            >
              Retry
            </button>
          </p>
        ) : (
          <>
            <Section
              id={`${org.id}:channels`}
              tour="channels"
              title="Channels"
              icon={<SectionEmoji>💬</SectionEmoji>}
              action={
                org.role !== 'guest' && (
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton label="Add channels" size="sm">
                        <Plus />
                      </IconButton>
                    </MenuTrigger>
                    <MenuContent align="end">
                      {canCreate && (
                        <MenuItem icon={<Plus />} onSelect={() => setCreateOpen(true)}>
                          Create a channel
                        </MenuItem>
                      )}
                      <MenuItem icon={<Hash />} asChild>
                        <Link href={`${base}/browse`}>Browse channels</Link>
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )
              }
            >
              {groups.general.map((c) => (
                <ChannelRow key={c.id} c={c} />
              ))}
              {canCreate ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="q-nav flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
                  >
                    <span className="flex size-5 items-center justify-center rounded-[5px] bg-bg-muted">
                      <Plus className="size-3.5" />
                    </span>
                    Add channel
                  </button>
                </li>
              ) : (
                org.role !== 'guest' && (
                  <li>
                    <Link
                      href={`${base}/browse`}
                      className="q-nav flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
                    >
                      <span className="flex size-5 items-center justify-center rounded-[5px] bg-bg-muted">
                        <Hash className="size-3.5" />
                      </span>
                      Browse channels
                    </Link>
                  </li>
                )
              )}
            </Section>
            {groups.dept.map((g) => (
              <Section
                key={g.id}
                id={`${org.id}:dept:${g.id}`}
                title={g.name}
                icon={<Building2 className="size-3" />}
              >
                {g.channels.map((c) => (
                  <ChannelRow key={c.id} c={c} />
                ))}
              </Section>
            ))}
            {groups.team.map((g) => (
              <Section
                key={g.id}
                id={`${org.id}:team:${g.id}`}
                title={g.name}
                icon={<Users className="size-3" />}
              >
                {g.channels.map((c) => (
                  <ChannelRow key={c.id} c={c} />
                ))}
              </Section>
            ))}
            <Section
              id={`${org.id}:plugins`}
              tour="plugins"
              title="Plugins"
              icon={<SectionEmoji>🧩</SectionEmoji>}
            >
              <PluginsSidebarItems />
            </Section>
            <Section
              id={`${org.id}:dms`}
              title="Direct messages"
              icon={<SectionEmoji>👋</SectionEmoji>}
              action={
                <IconButton label="New message" size="sm" onClick={() => setDmOpen(true)}>
                  <Plus />
                </IconButton>
              }
            >
              {groups.direct.map((c) => (
                <ChannelRow key={c.id} c={c} />
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => setDmOpen(true)}
                  className="q-nav flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
                >
                  <span className="flex size-5 items-center justify-center rounded-[5px] bg-bg-muted">
                    <Plus className="size-3.5" />
                  </span>
                  New message
                </button>
              </li>
            </Section>
          </>
        )}
      </div>

      <CreateChannelDialog open={createOpen} onOpenChange={setCreateOpen} />
      <NewMessageDialog open={dmOpen} onOpenChange={setDmOpen} />
    </>
  )
}
