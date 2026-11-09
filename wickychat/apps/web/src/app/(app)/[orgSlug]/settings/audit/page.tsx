'use client'
import type { AuditEntry } from '@quid/shared'
import { Avatar, Button, EmptyState, Input, Skeleton } from '@quid/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsTitle } from '@/components/settings-ui'
import { get } from '@/lib/api'
import { displayName, formatFull } from '@/lib/format'

export default function AuditSettings() {
  const { org, api } = useOrgContext()
  const [input, setInput] = useState('')
  const [action, setAction] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAction(input.trim()), 300)
    return () => clearTimeout(t)
  }, [input])
  const q = useInfiniteQuery({
    queryKey: ['audit', org.id, action],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      get<{ entries: AuditEntry[]; nextCursor: string | null }>(
        `${api}/audit?limit=50${action ? `&action=${encodeURIComponent(action)}` : ''}${pageParam ? `&before=${pageParam}` : ''}`,
        signal,
      ),
    getNextPageParam: (p) => p.nextCursor,
  })
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? []

  return (
    <>
      <SettingsTitle
        title="Audit log"
        description="Sensitive administrative actions: role changes, invitations, channel archiving and deletion, integrations and credentials."
      />
      <Input
        className="mb-4 max-w-xs"
        placeholder="Filter by action, e.g. member."
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {q.isLoading ? (
        <Skeleton className="h-60" />
      ) : !entries.length ? (
        <EmptyState icon={<ScrollText />} title="No matching events" />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 p-3">
              {e.actor ? (
                <Avatar name={e.actor.name} id={e.actor.id} src={e.actor.avatarUrl} size="sm" />
              ) : (
                <span className="size-6" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">
                  <span className="font-medium">{e.actor ? displayName(e.actor) : 'System'}</span>{' '}
                  <code className="rounded bg-bg-muted px-1 text-xs">{e.action}</code>
                </p>
                {Object.keys(e.metadata).length > 0 && (
                  <p className="mt-0.5 truncate font-mono text-2xs text-fg-subtle">
                    {JSON.stringify(e.metadata)}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-right text-xs text-fg-subtle">
                {formatFull(e.createdAt)}
                {e.ip && <span className="block">{e.ip}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </>
  )
}
