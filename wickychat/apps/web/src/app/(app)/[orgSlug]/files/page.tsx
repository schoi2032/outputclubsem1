'use client'
import type { SearchResults } from '@quid/shared'
import { Button, EmptyState, Input, Skeleton } from '@quid/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import { FolderOpen, Search } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fileIcon } from '@/components/chat/attachments'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { get } from '@/lib/api'
import { channelRef } from '@/lib/channels'
import { displayName, fileSize, relative } from '@/lib/format'
import { useChannels } from '@/lib/queries'

export default function FilesPage() {
  const { org, api, base, me } = useOrgContext()
  const channels = useChannels(org.id)
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300)
    return () => clearTimeout(t)
  }, [input])
  const res = useInfiniteQuery({
    queryKey: ['files', org.id, q],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<SearchResults>(
        `${api}/search?type=files&limit=40&q=${encodeURIComponent(q)}${pageParam ? `&cursor=${pageParam}` : ''}`,
        signal,
      ),
    getNextPageParam: (p) => p.nextCursor,
  })
  const files = res.data?.pages.flatMap((p) => p.files) ?? []
  const where = (id: string | null) => {
    const c = channels.data?.find((x) => x.id === id)
    return c ? channelRef(c, me.id) : null
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Files" icon={<FolderOpen />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-4 md:p-6">
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              className="pl-8"
              placeholder="Filter by file name"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          {res.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : !files.length ? (
            <EmptyState
              emoji="📁"
              title={q ? 'No files match that' : 'No files yet'}
              description="Files shared in conversations you can access appear here. WickyChat Drive will build on this."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-bg-subtle text-left text-xs text-fg-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Shared in</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">By</th>
                    <th className="px-3 py-2 text-right font-medium">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const Icon = fileIcon(f.mime)
                    return (
                      <tr key={f.id} className="border-t border-border hover:bg-bg-subtle">
                        <td className="max-w-0 px-3 py-2">
                          <a
                            href={f.isImage ? `${f.url}?inline=1` : f.url}
                            target={f.isImage ? '_blank' : undefined}
                            rel="noreferrer"
                            className="flex items-center gap-2.5"
                          >
                            {f.isImage && f.thumbnailUrl ? (
                              <img
                                src={f.thumbnailUrl}
                                alt=""
                                className="size-7 rounded object-cover"
                              />
                            ) : (
                              <Icon className="size-5 shrink-0 text-fg-subtle" />
                            )}
                            <span className="truncate font-medium">{f.name}</span>
                          </a>
                        </td>
                        <td className="hidden px-3 py-2 text-fg-muted md:table-cell">
                          {f.channelId && where(f.channelId) ? (
                            <Link
                              href={`${base}/c/${f.channelId}${f.messageId ? `?m=${f.messageId}` : ''}`}
                              className="hover:underline"
                            >
                              {where(f.channelId)}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="hidden px-3 py-2 text-fg-muted sm:table-cell">
                          {displayName(f.uploader)} · {relative(f.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-right text-fg-muted tabular-nums">
                          {fileSize(f.size)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {res.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                size="sm"
                loading={res.isFetchingNextPage}
                onClick={() => res.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
