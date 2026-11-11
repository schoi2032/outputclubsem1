'use client'
import type { SearchResults } from '@quid/shared'
import { Avatar, Button, cn, EmptyState, Kbd, Skeleton } from '@quid/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Hash, Lock, Search, Users } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { FileCard } from '@/components/chat/attachments'
import { MessageCard } from '@/components/message-card'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { get } from '@/lib/api'
import { displayName, relative } from '@/lib/format'

const TYPES = [
  ['all', 'All'],
  ['messages', 'Messages'],
  ['channels', 'Channels'],
  ['people', 'People'],
  ['files', 'Files'],
] as const
type T = (typeof TYPES)[number][0]

const TIPS = [
  ['from:@ada', 'messages from a person'],
  ['in:#general', 'in a channel'],
  ['after:2026-01-01', 'after a date'],
  ['before:2026-02-01', 'before a date'],
  ['has:file', 'with attachments'],
]

function SearchInner() {
  const { api, base, org } = useOrgContext()
  const router = useRouter()
  const params = useSearchParams()
  const q = params.get('q') ?? ''
  const type = (params.get('type') as T) ?? 'all'
  const [input, setInput] = useState(q)
  useEffect(() => setInput(q), [q])

  const go = (nextQ: string, nextType: T = type) =>
    router.replace(`${base}/search?q=${encodeURIComponent(nextQ)}&type=${nextType}`)

  const res = useInfiniteQuery({
    queryKey: ['search', org.id, q, type],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<SearchResults>(
        `${api}/search?q=${encodeURIComponent(q)}&type=${type}${pageParam ? `&cursor=${pageParam}` : ''}`,
        signal,
      ),
    getNextPageParam: (p) => p.nextCursor,
    enabled: q.trim().length > 0,
  })
  const pages = res.data?.pages ?? []
  const messages = pages.flatMap((p) => p.messages)
  const channels = pages[0]?.channels ?? []
  const people = pages[0]?.people ?? []
  const files = pages.flatMap((p) => p.files)
  const nothing =
    res.isSuccess && !messages.length && !channels.length && !people.length && !files.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Search" icon={<Search />}>
        <form
          className="px-3 pb-3 md:px-6"
          onSubmit={(e) => {
            e.preventDefault()
            go(input.trim())
          }}
        >
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border-strong bg-bg px-3 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
            <Search className="size-4 text-fg-subtle" />
            <input
              autoFocus
              aria-label="Search"
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-subtle"
              placeholder={`Search ${org.name}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <Kbd>Enter</Kbd>
          </div>
          <div className="mt-2 flex gap-1 overflow-x-auto">
            {TYPES.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => go(q, k)}
                className={cn(
                  'h-7 shrink-0 rounded-md px-2.5 text-[13px] font-medium text-fg-muted hover:bg-bg-muted',
                  type === k && 'bg-bg-emphasis text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </form>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-6">
          {!q ? (
            <div className="rounded-xl border border-border p-5">
              <p className="text-sm font-semibold">Search messages, channels, people and files</p>
              <p className="mt-1 text-[13px] text-fg-muted">Narrow results with filters:</p>
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {TIPS.map(([code, desc]) => (
                  <li key={code}>
                    <button
                      type="button"
                      onClick={() => setInput((v) => `${v ? `${v} ` : ''}${code}`)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-bg-muted"
                    >
                      <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {code}
                      </code>
                      <span className="text-fg-muted">{desc}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : res.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : res.isError ? (
            <EmptyState
              emoji="😬"
              title="Search tripped over something"
              description="Give it another go in a sec."
              action={<Button onClick={() => res.refetch()}>Try again</Button>}
            />
          ) : nothing ? (
            <EmptyState
              emoji="🔍"
              title={`Nothing turned up for "${q}"`}
              description="Check the spelling or try fewer words. Private conversations you're not part of are never searched."
            />
          ) : (
            <div className="flex flex-col gap-8">
              {people.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">People</h2>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {people.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={`${base}/people?user=${p.id}`}
                          className="flex items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-bg-subtle"
                        >
                          <Avatar
                            name={p.name}
                            id={p.id}
                            src={p.avatarUrl}
                            decoration={p.decoration}
                            size="md"
                            presence={p.presence}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">
                              {displayName(p)}
                            </span>
                            <span className="block truncate text-xs text-fg-subtle">
                              {p.title || p.email}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {channels.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Channels</h2>
                  <ul className="flex flex-col gap-1">
                    {channels.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`${base}/c/${c.id}`}
                          className="flex items-center gap-2 rounded-md px-2 py-2 text-[13.5px] hover:bg-bg-muted"
                        >
                          {c.kind === 'private' ? (
                            <Lock className="size-4 text-fg-subtle" />
                          ) : (
                            <Hash className="size-4 text-fg-subtle" />
                          )}
                          <span className="font-medium">{c.name}</span>
                          <span className="truncate text-xs text-fg-subtle">{c.description}</span>
                          <span className="ml-auto flex items-center gap-1 text-xs text-fg-subtle">
                            <Users className="size-3" />
                            {c.memberCount}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {messages.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Messages</h2>
                  <div className="flex flex-col gap-2">
                    {messages.map((m) => (
                      <MessageCard key={m.id} m={m} highlight={m.highlight} />
                    ))}
                  </div>
                  {type === 'all' && messages.length >= 8 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => go(q, 'messages')}
                    >
                      See all messages
                    </Button>
                  )}
                </section>
              )}
              {files.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Files</h2>
                  <ul className="flex flex-col gap-2">
                    {files.map((f) => (
                      <li key={f.id} className="flex items-center gap-3">
                        <FileCard a={f} />
                        <span className="hidden text-xs text-fg-subtle sm:inline">
                          {displayName(f.uploader)} · {relative(f.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {res.hasNextPage && (
                <Button
                  className="self-center"
                  size="sm"
                  loading={res.isFetchingNextPage}
                  onClick={() => res.fetchNextPage()}
                >
                  Load more
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchInner />
    </Suspense>
  )
}
