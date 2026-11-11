'use client'
/** WickyChat: "Seen by 23 of 30" under announcements, for teachers. */
import type { UserSummary } from '@quid/shared'
import { Avatar, Popover, PopoverContent, PopoverTrigger } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { get } from '@/lib/api'
import { displayName } from '@/lib/format'
import { useOrgContext } from '../org-context'

type Seen = { seen: (UserSummary & { at: string | null })[]; notSeen: UserSummary[] }

function People({ title, list }: { title: string; list: UserSummary[] }) {
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold text-fg-subtle uppercase">
        {title} · {list.length}
      </p>
      {!list.length ? (
        <p className="text-xs text-fg-subtle">Nobody</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-[13px]">
              <Avatar name={u.name} id={u.id} src={u.avatarUrl} size="xs" />
              <span className="truncate">{displayName(u)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SeenBy({ messageId }: { messageId: string }) {
  const { api, org } = useOrgContext()
  const q = useQuery({
    queryKey: ['seen', org.id, messageId],
    queryFn: ({ signal }) => get<Seen>(`${api}/messages/${messageId}/seen`, signal),
    refetchInterval: 30_000,
  })
  if (!q.data) return null
  const total = q.data.seen.length + q.data.notSeen.length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-muted hover:bg-bg-muted"
        >
          <Eye className="size-3.5" /> Seen by {q.data.seen.length} of {total}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <div className="flex flex-col gap-3">
          <People title="Not seen yet" list={q.data.notSeen} />
          <People title="Seen" list={q.data.seen} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
