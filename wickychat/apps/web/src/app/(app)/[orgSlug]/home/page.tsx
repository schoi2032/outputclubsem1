'use client'
import type { Meeting, Notification } from '@quid/shared'
import {
  Avatar,
  Button,
  Count,
  Kbd,
  Mascot,
  type MascotKind,
  type MascotMood,
  Skeleton,
  Sparkles,
  toast,
} from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import {
  AtSign,
  CalendarDays,
  Hash,
  Headphones,
  House,
  Lightbulb,
  Lock,
  MessageSquarePlus,
  Search,
  Video,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { NewMessageDialog } from '@/components/dialogs/new-message-dialog'
import { GetStarted } from '@/components/onboarding/get-started'
import { HomeWelcome } from '@/components/org/welcome-card'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { openCommandPalette, useIsMac } from '@/components/shell/command-palette'
import { useVoiceRooms } from '@/components/voice-rooms/voice-room-provider'
import { errorMessage, get, post } from '@/lib/api'
import { displayName, formatTime, relative } from '@/lib/format'
import { keys, useChannels } from '@/lib/queries'

type Lists = { live: Meeting[]; upcoming: Meeting[]; past: Meeting[] }
type NotificationPage = { notifications: Notification[]; nextCursor: string | null }

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 5
    ? 'Good evening'
    : h < 12
      ? 'Good morning'
      : h < 18
        ? 'Good afternoon'
        : 'Good evening'
}

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border bg-bg">
      <header className="flex h-11 items-center gap-2 border-b border-border px-4 text-[13px] font-semibold [&>svg]:size-4 [&>svg]:text-fg-subtle">
        {icon}
        {title}
        <span className="ml-auto font-normal">{action}</span>
      </header>
      <div className="min-h-0 flex-1 p-2">{children}</div>
    </section>
  )
}

function Empty({
  kind,
  mood,
  children,
}: {
  kind: MascotKind
  mood: MascotMood
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-5 text-center">
      <Mascot kind={kind} mood={mood} className="size-12" />
      <p className="text-[13px] text-fg-muted">{children}</p>
    </div>
  )
}

/** Small, true tips about things people often miss. */
function tips(mod: string): { emoji: string; text: React.ReactNode }[] {
  const code = (t: string) => (
    <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] text-fg">{t}</code>
  )
  return [
    {
      emoji: '⏰',
      text: (
        <>
          Type {code('/remind tomorrow 9am review the deck')} in any conversation and WickyChat will
          nudge you.
        </>
      ),
    },
    {
      emoji: '✅',
      text: (
        <>Type {code('/todo Write the launch email')} to add a task to the channel’s Tasks tab.</>
      ),
    },
    {
      emoji: '🔍',
      text: (
        <>Press {code(`${mod}K`)} from anywhere to jump to a message, file, person or channel.</>
      ),
    },
    {
      emoji: '🕰️',
      text: (
        <>
          Writing late at night? Use the arrow next to Send to schedule the message for the morning.
        </>
      ),
    },
    { emoji: '🔖', text: <>Bookmark a message to keep it in Later, where only you can see it.</> },
    {
      emoji: '📌',
      text: <>Pin the important stuff from a message’s menu so the whole channel can find it.</>,
    },
    {
      emoji: '🎨',
      text: (
        <>Pick your accent color, font and density in Settings under Appearance & preferences.</>
      ),
    },
    {
      emoji: '🎧',
      text: (
        <>Every channel has an always-on voice room. Drop in for a quick chat, no meeting needed.</>
      ),
    },
  ]
}

function TipCard() {
  const isMac = useIsMac()
  const list = tips(isMac ? '⌘' : 'Ctrl+')
  const [i, setI] = useState(() => Math.floor(Date.now() / 86_400_000) % list.length)
  const tip = list[i % list.length]!
  return (
    <section className="mt-4 flex items-center gap-4 rounded-xl border border-border bg-bg p-4">
      <span
        aria-hidden="true"
        className="q-sketch flex size-11 shrink-0 items-center justify-center border-2 border-dashed border-accent/35 bg-accent-subtle text-xl leading-none"
      >
        {tip.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-text">
          <Lightbulb className="size-3.5" /> Did you know?
        </p>
        <p key={i} className="mt-0.5 animate-in text-[13.5px] text-fg-muted">
          {tip.text}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setI((n) => n + 1)}>
        Another tip
      </Button>
    </section>
  )
}

/** Your starting point: what needs you, what's on today, and who's around. */
export default function HomePage() {
  const { org, api, base, me } = useOrgContext()
  const router = useRouter()
  const channels = useChannels(org.id)
  const { activeRooms } = useVoiceRooms()
  const [dmOpen, setDmOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const isMac = useIsMac()
  const mentions = useQuery({
    queryKey: keys.notifications(org.id, 'unread-home'),
    queryFn: ({ signal }) =>
      get<NotificationPage>(`${api}/notifications?kind=all&unread=true&limit=8`, signal),
  })
  const meetings = useQuery({
    queryKey: ['meetings', org.id],
    queryFn: ({ signal }) => get<Lists>(`${api}/meetings`, signal),
  })

  const unreadChannels = (channels.data ?? [])
    .filter(
      (c) =>
        c.membership &&
        !c.membership.muted &&
        !c.archivedAt &&
        (c.membership.unreadCount > 0 || c.membership.mentionCount > 0),
    )
    .sort(
      (a, b) =>
        b.membership!.mentionCount - a.membership!.mentionCount ||
        (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''),
    )
    .slice(0, 8)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const today = [
    ...(meetings.data?.live ?? []),
    ...(meetings.data?.upcoming ?? []).filter(
      (m) => m.scheduledFor && new Date(m.scheduledFor) <= endOfToday,
    ),
  ]
  const later = (meetings.data?.upcoming ?? [])
    .filter((m) => m.scheduledFor && new Date(m.scheduledFor) > endOfToday)
    .slice(0, 3)
  const rooms = activeRooms.filter((r) => r.participants.length > 0)
  const unreadItems = (mentions.data?.notifications ?? []).filter((n) => !n.readAt)

  const linkFor = (n: Notification) =>
    n.link ??
    (n.channelId
      ? `${base}/c/${n.channelId}${n.threadId ? `?thread=${n.threadId}` : n.messageId ? `?m=${n.messageId}` : ''}`
      : `${base}/activity`)

  const startMeeting = async () => {
    setStarting(true)
    try {
      const m = await post<Meeting>(`${api}/meetings`, { title: `${displayName(me)}'s meeting` })
      router.push(`${base}/meet/${m.code}`)
    } catch (e) {
      toast.error(errorMessage(e))
      setStarting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Home" icon={<House />} />
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg-subtle">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#fbe3da_0%,#fbe2ea_45%,#e6eef0_75%,#e3efe5_100%)] px-5 py-6 sm:px-7 dark:bg-[linear-gradient(120deg,#3a231b_0%,#3a2230_45%,#252b33_75%,#1f2d24_100%)]">
            <div className="relative z-10 max-w-[70%]">
              <h2 className="text-2xl font-semibold tracking-[-0.025em]">
                {greeting()}, {(me.displayName || me.name).split(' ')[0]}
              </h2>
              <p className="mt-1 text-[13px] text-fg-muted">
                {new Date().toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}{' '}
                · {org.name}
              </p>
            </div>
            <div className="absolute top-1/2 right-3 hidden h-28 w-44 -translate-y-1/2 sm:block">
              <Sparkles />
              <div className="relative flex h-full items-center justify-center">
                <Mascot kind="sprout" mood="sleepy" float className="size-14" />
                <Mascot
                  kind="bubble"
                  mood="happy"
                  float
                  className="-ml-2 size-20"
                  style={{ animationDelay: '-1.4s' }}
                />
              </div>
            </div>
            <Mascot
              kind="bubble"
              mood="happy"
              className="absolute right-4 bottom-3 size-12 sm:hidden"
            />
          </div>

          <HomeWelcome />

          <button
            type="button"
            onClick={openCommandPalette}
            className="mt-5 flex h-11 w-full max-w-xl items-center gap-3 rounded-xl border border-border bg-bg px-4 text-left text-[14px] text-fg-subtle shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-[0_3px_10px_-4px_hsl(var(--q-shadow-color)/0.18)]"
          >
            <Search className="size-4" />
            <span className="flex-1 truncate">Search messages, files, people and channels</span>
            <span className="hidden items-center gap-0.5 sm:flex">
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setDmOpen(true)}>
              <MessageSquarePlus /> New message
            </Button>
            <Button onClick={startMeeting} loading={starting}>
              <Video /> Start a meeting
            </Button>
            <Button asChild>
              <Link href={`${base}/browse`}>
                <Hash /> Browse channels
              </Link>
            </Button>
          </div>

          <TipCard />

          <GetStarted
            hadMeeting={
              !!meetings.data && (meetings.data.past.length > 0 || meetings.data.live.length > 0)
            }
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card
              title="Waiting for you"
              icon={<AtSign />}
              action={
                <Link
                  href={`${base}/activity`}
                  className="text-xs text-accent-text hover:underline"
                >
                  All activity
                </Link>
              }
            >
              {mentions.isLoading ? (
                <Skeleton className="h-40" />
              ) : !unreadItems.length ? (
                <Empty kind="pebble" mood="sleepy">
                  You’re all caught up. Maybe grab a coffee? ☕
                </Empty>
              ) : (
                <ul>
                  {unreadItems.map((n) => (
                    <li key={n.id}>
                      <Link
                        href={linkFor(n)}
                        className="flex gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-bg-subtle"
                      >
                        {n.actor ? (
                          <Avatar
                            name={displayName(n.actor)}
                            id={n.actor.id}
                            src={n.actor.avatarUrl}
                            size="sm"
                          />
                        ) : (
                          <AtSign className="mt-1 size-4 text-fg-subtle" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex gap-2 text-[13px]">
                            <span className="truncate font-medium">{n.title}</span>
                            <span className="ml-auto shrink-0 text-xs text-fg-subtle">
                              {relative(n.createdAt)}
                            </span>
                          </span>
                          {n.preview && (
                            <span className="block truncate text-[13px] text-fg-muted">
                              {n.preview}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Coming up"
              icon={<CalendarDays />}
              action={
                <Link href={`${base}/meet`} className="text-xs text-accent-text hover:underline">
                  Meet
                </Link>
              }
            >
              {meetings.isLoading ? (
                <Skeleton className="h-40" />
              ) : !today.length && !later.length ? (
                <Empty kind="sprout" mood="wink">
                  No meetings coming up. Hello, focus time!
                </Empty>
              ) : (
                <ul>
                  {[...today, ...later].map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`${base}/meet/${m.code}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-bg-subtle"
                      >
                        <span className="w-16 shrink-0 text-xs text-fg-subtle tabular-nums">
                          {m.status === 'live' ? (
                            <span className="font-semibold text-success">Live now</span>
                          ) : m.scheduledFor && new Date(m.scheduledFor) > endOfToday ? (
                            new Date(m.scheduledFor).toLocaleDateString(undefined, {
                              weekday: 'short',
                              day: 'numeric',
                            })
                          ) : (
                            formatTime(m.scheduledFor ?? m.createdAt)
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {m.title}
                        </span>
                        {m.status === 'live' && (
                          <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-fg">
                            Join
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Unread conversations" icon={<Hash />}>
              {channels.isLoading ? (
                <Skeleton className="h-32" />
              ) : !unreadChannels.length ? (
                <Empty kind="bubble" mood="happy">
                  Nothing unread. Inbox zero, nice.
                </Empty>
              ) : (
                <ul>
                  {unreadChannels.map((c) => {
                    const label = c.name ?? (c.participants ?? []).map(displayName).join(', ')
                    return (
                      <li key={c.id}>
                        <Link
                          href={`${base}/c/${c.id}`}
                          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors duration-150 hover:bg-bg-subtle"
                        >
                          {c.kind === 'private' ? (
                            <Lock className="size-4 text-fg-subtle" />
                          ) : c.name ? (
                            <Hash className="size-4 text-fg-subtle" />
                          ) : (
                            <AtSign className="size-4 text-fg-subtle" />
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                          {c.membership!.mentionCount > 0 ? (
                            <Count n={c.membership!.mentionCount} />
                          ) : (
                            <span className="text-xs text-fg-subtle">
                              {c.membership!.unreadCount >= 100 ? '99+' : c.membership!.unreadCount}{' '}
                              new
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            <Card
              title="Talking now"
              icon={<Headphones />}
              action={
                <Link href={`${base}/voice`} className="text-xs text-accent-text hover:underline">
                  Voice
                </Link>
              }
            >
              {!rooms.length ? (
                <Empty kind="pebble" mood="wow">
                  It’s quiet. Hop into a channel’s voice room and say hi!
                </Empty>
              ) : (
                <ul>
                  {rooms.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`${base}/c/${r.channelId}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-bg-subtle"
                      >
                        <Headphones className="size-4 text-success" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          #{r.name}
                        </span>
                        <span className="flex -space-x-1.5">
                          {r.participants.slice(0, 4).map((p) => (
                            <Avatar
                              key={p.user.id}
                              name={displayName(p.user)}
                              id={p.user.id}
                              src={p.user.avatarUrl}
                              size="xs"
                              className="ring-2 ring-bg"
                            />
                          ))}
                        </span>
                        {r.participants.length > 4 && (
                          <span className="text-xs text-fg-subtle">
                            +{r.participants.length - 4}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
      <NewMessageDialog open={dmOpen} onOpenChange={setDmOpen} />
    </div>
  )
}
