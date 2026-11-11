'use client'
import type { SearchResults } from '@quid/shared'
import { Avatar, cn, Kbd, Spinner } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import {
  AlarmClock,
  ArrowRight,
  Bell,
  BookOpen,
  FileText,
  Gift,
  Hash,
  Headphones,
  House,
  ListTodo,
  Lock,
  MessageSquareText,
  Moon,
  Palette,
  PenSquare,
  Puzzle,
  Rows3,
  Search,
  Settings,
  Sparkles,
  Video,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Dialog as D } from 'radix-ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get } from '@/lib/api'
import { channelTitle, dmPartner } from '@/lib/channels'
import { displayName, relative } from '@/lib/format'
import { getPreferences, setPreferences } from '@/lib/preferences'
import { useChannels } from '@/lib/queries'
import { useOrgContext } from '../org-context'

/** Opens the palette from anywhere (sidebar button, home page, the tour). */
export const openCommandPalette = () => window.dispatchEvent(new Event('quid:search'))

/** Whether to show ⌘ rather than Ctrl (after hydration, so server and client agree). */
export function useIsMac() {
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), [])
  return mac
}

type Item = {
  id: string
  group: string
  label: React.ReactNode
  detail?: React.ReactNode
  icon: React.ReactNode
  run: () => void
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Highlights from Postgres come back as «match»; show them as <mark>. */
function Highlight({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('«') ? (
          <mark key={i} className="rounded-[3px] bg-accent-subtle px-0.5 text-accent-text">
            {p.slice(1, -1)}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  )
}

/** ⌘K / Ctrl+K: jump to channels and people, and search messages and files. */
export function CommandPalette() {
  const { org, base, api, me } = useOrgContext()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const channels = useChannels(org.id)
  const term = useDebounced(q.trim(), 180)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('quid:search', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('quid:search', onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  const remote = useQuery({
    queryKey: ['quick-search', org.id, term],
    queryFn: ({ signal }) =>
      get<SearchResults>(`${api}/search?q=${encodeURIComponent(term)}&type=all`, signal),
    enabled: open && term.length > 1,
    staleTime: 30_000,
  })

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase()
    const all = (channels.data ?? []).filter((c) => !c.archivedAt)
    const chanIcon = (c: (typeof all)[number]) => {
      if (c.kind === 'dm') {
        const p = dmPartner(c, me.id)
        return p ? <Avatar name={p.name} id={p.id} src={p.avatarUrl} size="xs" /> : <Hash />
      }
      return c.kind === 'private' ? <Lock /> : <Hash />
    }
    const jump = all
      .filter((c) => !needle || channelTitle(c, me.id).toLowerCase().includes(needle))
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
      .slice(0, needle ? 6 : 5)
      .map<Item>((c) => ({
        id: `c:${c.id}`,
        group: needle ? 'Channels and conversations' : 'Recent',
        label: channelTitle(c, me.id),
        detail: c.kind === 'public' || c.kind === 'private' ? c.description : undefined,
        icon: chanIcon(c),
        run: () => go(`${base}/c/${c.id}`),
      }))

    const actions: Item[] = [
      { id: 'a:home', label: 'Home', icon: <House />, href: `${base}/home` },
      { id: 'a:meet', label: 'Start a meeting', icon: <Video />, href: `${base}/meet` },
      { id: 'a:voice', label: 'Voice rooms', icon: <Headphones />, href: `${base}/voice` },
      { id: 'a:activity', label: 'Activity', icon: <Bell />, href: `${base}/activity` },
      { id: 'a:files', label: 'All files', icon: <FileText />, href: `${base}/files` },
      { id: 'a:tasks', label: 'My tasks', icon: <ListTodo />, href: `${base}/tasks` },
      {
        id: 'a:later',
        label: 'Later: saved and reminders',
        icon: <AlarmClock />,
        href: `${base}/saved`,
      },
      { id: 'a:workflows', label: 'Workflows', icon: <Zap />, href: `${base}/workflows` },
      { id: 'a:plugins', label: 'Plugins', icon: <Puzzle />, href: `${base}/plugins` },
      { id: 'a:settings', label: 'Settings', icon: <Settings />, href: `${base}/settings` },
      {
        id: 'a:prefs',
        label: 'Appearance & preferences',
        icon: <Palette />,
        href: `${base}/settings/preferences`,
      },
      { id: 'a:news', label: 'What’s new', icon: <Gift />, href: `${base}/whats-new` },
      { id: 'a:docs', label: 'Plugin developer docs', icon: <BookOpen />, href: '/developers' },
    ]
      .filter((a) => !needle || a.label.toLowerCase().includes(needle))
      .map((a) => ({ ...a, group: 'Go to', run: () => go(a.href) }))
    const compose: Item[] =
      !needle || 'new message'.includes(needle)
        ? [
            {
              id: 'a:dm',
              group: 'Go to',
              label: 'New message',
              icon: <PenSquare />,
              run: () => {
                setOpen(false)
                window.dispatchEvent(new Event('quid:compose'))
              },
            },
          ]
        : []
    const tour: Item[] =
      !needle || 'take the tour tutorial'.includes(needle)
        ? [
            {
              id: 'a:tour',
              group: 'Go to',
              label: 'Take the tour',
              icon: <Sparkles />,
              run: () => {
                setOpen(false)
                window.dispatchEvent(new Event('quid:tour'))
              },
            },
          ]
        : []

    const toggles: Item[] = [
      {
        id: 't:dark',
        label: 'Toggle dark mode',
        keywords: 'toggle dark light mode theme',
        icon: <Moon />,
        run: () =>
          setPreferences({
            theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark',
          }),
      },
      {
        id: 't:density',
        label: 'Toggle compact mode',
        keywords: 'toggle compact comfortable density',
        icon: <Rows3 />,
        run: () =>
          setPreferences({
            density: getPreferences().density === 'compact' ? 'comfortable' : 'compact',
          }),
      },
    ]
      .filter((t) => !needle || t.keywords.includes(needle))
      .map(({ keywords: _, run, ...t }) => ({
        ...t,
        group: 'Go to',
        run: () => {
          setOpen(false)
          run()
        },
      }))

    const r = term.length > 1 && term === q.trim() ? remote.data : undefined
    const known = new Set(jump.map((j) => j.id))
    const people: Item[] = (r?.people ?? []).slice(0, 4).map((p) => ({
      id: `p:${p.id}`,
      group: 'People',
      label: displayName(p),
      detail: p.title || undefined,
      icon: <Avatar name={p.name} id={p.id} src={p.avatarUrl} size="xs" />,
      run: () => go(`${base}/people?user=${p.id}`),
    }))
    const remoteChannels: Item[] = (r?.channels ?? [])
      .filter((c) => !known.has(`c:${c.id}`))
      .slice(0, 3)
      .map((c) => ({
        id: `c:${c.id}`,
        group: 'Channels and conversations',
        label: c.name,
        detail: c.description,
        icon: c.kind === 'private' ? <Lock /> : <Hash />,
        run: () => go(`${base}/c/${c.id}`),
      }))
    const messages: Item[] = (r?.messages ?? []).slice(0, 5).map((m) => ({
      id: `m:${m.id}`,
      group: 'Messages',
      label: (
        <span className="line-clamp-2">
          <Highlight text={m.highlight} />
        </span>
      ),
      detail: `${displayName(m.author)}${m.channelName ? ` in #${m.channelName}` : ''} · ${relative(m.createdAt)}`,
      icon: <MessageSquareText />,
      run: () =>
        go(
          `${base}/c/${m.channelId}${m.parentId ? `?thread=${m.parentId}&m=${m.id}` : `?m=${m.id}`}`,
        ),
    }))
    const files: Item[] = (r?.files ?? []).slice(0, 4).map((f) => ({
      id: `f:${f.id}`,
      group: 'Files',
      label: f.name,
      detail: `${displayName(f.uploader)} · ${relative(f.createdAt)}`,
      icon: f.thumbnailUrl ? (
        <img src={f.thumbnailUrl} alt="" className="size-5 rounded object-cover" />
      ) : (
        <FileText />
      ),
      run: () =>
        f.channelId && f.messageId
          ? go(`${base}/c/${f.channelId}?m=${f.messageId}`)
          : window.open(f.url, '_blank', 'noopener'),
    }))
    const everything: Item[] = needle
      ? [
          {
            id: 'search-all',
            group: 'Search',
            label: (
              <>
                Search everything for <span className="font-semibold">“{q.trim()}”</span>
              </>
            ),
            icon: <Search />,
            run: () => go(`${base}/search?q=${encodeURIComponent(q.trim())}&type=all`),
          },
        ]
      : []
    return [
      ...jump,
      ...remoteChannels,
      ...people,
      ...messages,
      ...files,
      ...compose,
      ...actions,
      ...tour,
      ...toggles,
      ...everything,
    ]
  }, [q, term, channels.data, remote.data, me.id, base, go])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const groups: { name: string; items: (Item & { index: number })[] }[] = []
  items.forEach((it, index) => {
    const g = groups.find((x) => x.name === it.group)
    if (g) g.items.push({ ...it, index })
    else groups.push({ name: it.group, items: [{ ...it, index }] })
  })
  const searching = remote.isFetching && term.length > 1

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-overlay bg-black/40 backdrop-blur-[2px]" />
        <D.Content
          aria-label="Search and jump"
          className="fixed top-[10vh] left-1/2 z-50 flex max-h-[72vh] w-[calc(100vw-2rem)] max-w-[640px] -translate-x-1/2 animate-in flex-col overflow-hidden rounded-2xl border border-border bg-bg-overlay shadow-dialog outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(items.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              items[active]?.run()
            }
          }}
        >
          <D.Title className="sr-only">Search {org.name}</D.Title>
          <D.Description className="sr-only">
            Jump to a channel or person, or search messages and files.
          </D.Description>
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
            {searching ? (
              <Spinner className="size-4 text-fg-subtle" />
            ) : (
              <Search className="size-4 text-fg-subtle" />
            )}
            <input
              autoFocus
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="command-results"
              aria-activedescendant={items[active] ? `cmd-${active}` : undefined}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              placeholder={`Search messages, files, people and channels in ${org.name}`}
              className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-subtle"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div
            ref={list}
            id="command-results"
            role="listbox"
            className="min-h-0 flex-1 overflow-y-auto p-2"
          >
            {groups.map((g) => (
              <div key={g.name} className="mb-1">
                <p className="px-2.5 pt-2 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                  {g.name}
                </p>
                {g.items.map((it) => (
                  <div
                    key={it.id}
                    id={`cmd-${it.index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={active === it.index}
                    data-index={it.index}
                    onMouseMove={() => setActive(it.index)}
                    onClick={it.run}
                    onKeyDown={() => {}}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px]',
                      active === it.index ? 'bg-bg-emphasis text-fg' : 'text-fg-muted',
                    )}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center text-fg-subtle [&>svg]:size-4">
                      {it.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-fg">{it.label}</span>
                      {it.detail && (
                        <span className="block truncate text-xs text-fg-subtle">{it.detail}</span>
                      )}
                    </span>
                    {active === it.index && (
                      <ArrowRight className="size-3.5 shrink-0 text-fg-subtle" />
                    )}
                  </div>
                ))}
              </div>
            ))}
            {term.length > 1 &&
              remote.isSuccess &&
              !remote.data.messages.length &&
              !remote.data.files.length &&
              !remote.data.people.length &&
              !items.some((i) => i.id.startsWith('c:')) && (
                <p className="px-3 py-2 text-[13px] text-fg-subtle">
                  No messages, files or people match “{term}”.
                </p>
              )}
          </div>
          <div className="flex shrink-0 items-center gap-4 border-t border-border bg-bg-subtle px-4 py-2 text-xs text-fg-subtle">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> to open
            </span>
            <span className="ml-auto hidden sm:inline">
              Tip: <code className="font-mono">from:@ada</code>{' '}
              <code className="font-mono">in:#general</code>{' '}
              <code className="font-mono">has:file</code>
            </span>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
