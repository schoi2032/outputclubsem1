'use client'
/** WickyChat: messages students reported, for teachers (Settings → Rule breakers). */
import type { MessageReport } from '@quid/shared'
import { Avatar, Button, cn, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { REASON_LABEL } from '@/components/chat/report-dialog'
import { TimeoutMenu } from '@/components/moderation/timeout-menu'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, get, post } from '@/lib/api'
import { displayName, relative } from '@/lib/format'

export function ReportsSection() {
  const { org, api, base } = useOrgContext()
  const qc = useQueryClient()
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const reports = useQuery({
    queryKey: ['reports', org.id, status],
    queryFn: ({ signal }) =>
      get<{ reports: MessageReport[] }>(`${api}/moderation/reports?status=${status}`, signal),
  })
  const close = async (r: MessageReport, outcome: 'resolved' | 'dismissed') => {
    try {
      await post(`${api}/moderation/reports/${r.id}/resolve`, { outcome })
      void qc.invalidateQueries({ queryKey: ['reports', org.id] })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  // One row per message; the newest report shows, with how many people reported it.
  const seen = new Set<string>()
  const list = (reports.data?.reports ?? []).filter((r) => {
    const k = r.messageId ?? r.id
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Flag className="size-4 text-danger" /> Reported messages
          {status === 'open' && !!list.length && (
            <span className="rounded-full bg-danger px-1.5 text-2xs text-white">{list.length}</span>
          )}
        </h2>
        <div className="flex gap-1 rounded-lg border border-border p-0.5" role="tablist">
          {(['open', 'closed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs',
                status === s ? 'bg-bg-muted font-medium text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {s === 'open' ? 'Needs a look' : 'Done'}
            </button>
          ))}
        </div>
      </div>
      {reports.isLoading ? (
        <Skeleton className="h-24" />
      ) : !list.length ? (
        <p className="rounded-lg border border-border px-3 py-4 text-center text-[13px] text-fg-subtle">
          {status === 'open' ? 'No reports to look at. 🎉' : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <Avatar
                name={r.author?.name ?? '?'}
                id={r.author?.id ?? r.id}
                src={r.author?.avatarUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1 text-[13px]">
                <p>
                  <span className="font-medium">
                    {r.author ? displayName(r.author) : 'Someone'}
                  </span>{' '}
                  <span className="text-fg-subtle">
                    in{' '}
                    {r.channel
                      ? r.channel.kind === 'dm' || r.channel.kind === 'group'
                        ? 'a private chat'
                        : `#${r.channel.name}`
                      : 'a deleted chat'}{' '}
                    · {relative(r.createdAt)}
                  </span>
                </p>
                <p className="mt-1 rounded-md bg-bg-subtle px-2 py-1.5 break-words whitespace-pre-wrap">
                  {r.excerpt || <span className="text-fg-subtle">(attachment)</span>}
                </p>
                <p className="mt-1 text-xs">
                  <span className="rounded bg-danger/10 px-1.5 py-0.5 font-medium text-danger">
                    {REASON_LABEL[r.reason]}
                  </span>{' '}
                  <span className="text-fg-muted">
                    reported by {displayName(r.reporter)}
                    {r.reportCount > 1 &&
                      ` and ${r.reportCount - 1} other${r.reportCount > 2 ? 's' : ''}`}
                  </span>
                  {r.messageDeleted && <span className="text-fg-subtle"> · message deleted</span>}
                </p>
                {r.note && <p className="mt-1 text-xs text-fg-muted">“{r.note}”</p>}
                {r.channel && r.messageId && !r.messageDeleted && (
                  <Link
                    href={`${base}/c/${r.channel.id}?m=${r.messageId}`}
                    className="mt-1 inline-block text-xs text-accent-text hover:underline"
                  >
                    Open message
                  </Link>
                )}
              </div>
              {status === 'open' && (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {r.author && <TimeoutMenu userId={r.author.id} name={displayName(r.author)} />}
                  <Button size="sm" variant="primary" onClick={() => close(r, 'resolved')}>
                    Dealt with it
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => close(r, 'dismissed')}>
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
