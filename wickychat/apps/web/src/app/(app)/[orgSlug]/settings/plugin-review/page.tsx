'use client'
import { Button, Skeleton, toast } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { type Plugin, PluginIcon, StatusBadge } from '@/components/plugins/shared'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { errorMessage, get, post } from '@/lib/api'

type ReviewItem = Plugin & {
  developerEmail: string
  baseUrl: string
  submittedBy: string | null
  installs: number
}
const FILTERS = ['unverified', 'pending', 'verified', 'suspended', 'rejected'] as const

/** WickyChat staff only: review community plugins and mark them verified, or remove them. */
export default function PluginReview() {
  const { me } = useOrgContext()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('unverified')
  const q = useQuery({
    queryKey: ['platform-plugins', filter],
    queryFn: ({ signal }) => get<ReviewItem[]>(`/api/platform/plugins?status=${filter}`, signal),
    enabled: me.platformAdmin,
  })

  const review = async (
    p: ReviewItem,
    status: 'verified' | 'unverified' | 'suspended' | 'rejected',
  ) => {
    const note =
      status === 'verified' || status === 'unverified'
        ? undefined
        : (window.prompt(`Why is ${p.name} being ${status}? (shown to the developer)`) ?? undefined)
    try {
      await post(`/api/platform/plugins/${p.id}/review`, { status, note })
      toast.success(`${p.name}: ${status}`)
      void q.refetch()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (!me.platformAdmin)
    return (
      <SettingsTitle title="Not available" description="This page is for the WickyChat team." />
    )
  return (
    <>
      <SettingsTitle
        title="Plugin review"
        description="Community plugins that passed the automatic checks. Verify ones you've reviewed; suspend anything harmful."
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'primary' : 'ghost'}
            onClick={() => setFilter(f)}
            className="capitalize"
          >
            {f}
          </Button>
        ))}
      </div>
      {!q.data ? (
        <Skeleton className="h-60" />
      ) : !q.data.length ? (
        <SettingsCard title="Nothing to review">
          <p className="text-[13px] text-fg-muted">No plugins with this status.</p>
        </SettingsCard>
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((p) => (
            <li key={p.id} className="rounded-xl border border-border p-4 text-[13px]">
              <div className="flex gap-3">
                <PluginIcon p={p} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <StatusBadge p={p} />
                    <span className="text-xs text-fg-subtle">{p.installs} installs</span>
                  </div>
                  <p className="text-fg-muted">{p.tagline}</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {p.developerName} · {p.developerEmail} · server <code>{p.baseUrl}</code>
                    {p.submittedBy ? ` · submitted by ${p.submittedBy}` : ''}
                  </p>
                  {p.description && (
                    <p className="mt-2 whitespace-pre-wrap text-fg-muted">{p.description}</p>
                  )}
                  <p className="mt-2 text-xs">
                    Commands:{' '}
                    {p.commands.map((c) => `/${c.name} (${c.description})`).join(', ') || 'none'} ·
                    Reads messages: {p.events.includes('message.created') ? 'yes' : 'no'}
                  </p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Checks: {(p.checks ?? []).map((c) => `${c.label}: ${c.status}`).join(' · ')}
                  </p>
                  {p.reviewNote && (
                    <p className="mt-1 text-xs text-fg-subtle">Note: {p.reviewNote}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.status !== 'verified' && (
                  <Button size="sm" variant="primary" onClick={() => review(p, 'verified')}>
                    Verify
                  </Button>
                )}
                {p.status === 'verified' && (
                  <Button size="sm" onClick={() => review(p, 'unverified')}>
                    Remove verified badge
                  </Button>
                )}
                {p.status !== 'suspended' && (
                  <Button size="sm" variant="danger-ghost" onClick={() => review(p, 'suspended')}>
                    Suspend
                  </Button>
                )}
                {p.status !== 'rejected' && (
                  <Button size="sm" variant="danger-ghost" onClick={() => review(p, 'rejected')}>
                    Reject
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
