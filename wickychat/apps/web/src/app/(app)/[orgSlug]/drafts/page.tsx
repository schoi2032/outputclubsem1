'use client'
import { docToText } from '@quid/shared'
import {
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { SendHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { del, errorMessage } from '@/lib/api'
import { channelRef } from '@/lib/channels'
import { relative } from '@/lib/format'
import { keys, useChannels, useDrafts, useScheduled } from '@/lib/queries'

export default function DraftsPage() {
  const { org, api, base, me } = useOrgContext()
  const qc = useQueryClient()
  const drafts = useDrafts(org.id)
  const scheduled = useScheduled(org.id)
  const channels = useChannels(org.id)
  const name = (id: string) => {
    const c = channels.data?.find((x) => x.id === id)
    return c ? channelRef(c, me.id) : 'Conversation'
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Drafts & scheduled" icon={<SendHorizontal />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Tabs defaultValue="drafts" className="mx-auto max-w-3xl p-4 md:p-6">
          <TabsList>
            <TabsTrigger value="drafts">
              Drafts {drafts.data?.length ? `· ${drafts.data.length}` : ''}
            </TabsTrigger>
            <TabsTrigger value="scheduled">
              Scheduled {scheduled.data?.length ? `· ${scheduled.data.length}` : ''}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="drafts" className="pt-4">
            {drafts.isLoading ? (
              <Skeleton className="h-16" />
            ) : !drafts.data?.length ? (
              <EmptyState
                emoji="✍️"
                title="No half-finished thoughts"
                description="Unsent messages save automatically and follow you across your devices."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {drafts.data.map((d) => (
                  <li key={`${d.channelId}:${d.parentId}`}>
                    <Link
                      href={
                        d.parentId
                          ? `${base}/c/${d.channelId}?thread=${d.parentId}`
                          : `${base}/c/${d.channelId}`
                      }
                      className="block rounded-lg border border-border p-3 hover:border-border-strong hover:bg-bg-subtle"
                    >
                      <p className="flex items-center justify-between text-xs text-fg-subtle">
                        <span className="font-medium text-fg-muted">
                          {name(d.channelId)}
                          {d.parentId && ' · thread'}
                        </span>
                        {relative(d.updatedAt)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[14px]">{docToText(d.body)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="scheduled" className="pt-4">
            {!scheduled.data?.length ? (
              <EmptyState
                emoji="🕰️"
                title="Nothing queued up"
                description="Use the arrow next to Send to schedule a message for later."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {scheduled.data.map((s) => (
                  <li key={s.id} className="rounded-lg border border-border p-3">
                    <p className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
                      <span className="font-medium text-fg-muted">{name(s.channelId)}</span>
                      <span className={s.status === 'failed' ? 'text-danger' : ''}>
                        {s.status === 'failed'
                          ? 'Failed to send'
                          : `Sends ${new Date(s.sendAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                      </span>
                    </p>
                    <p className="mt-1 line-clamp-3 text-[14px]">{s.text}</p>
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="danger-ghost"
                        onClick={async () => {
                          try {
                            await del(`${api}/scheduled/${s.id}`)
                            void qc.invalidateQueries({ queryKey: keys.scheduled(org.id) })
                            toast.success('Scheduled message canceled')
                          } catch (e) {
                            toast.error(errorMessage(e))
                          }
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
