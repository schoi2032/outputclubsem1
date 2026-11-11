'use client'
import { type Channel, can } from '@quid/shared'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  IconButton,
  Input,
  Skeleton,
  toast,
} from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Hash, Lock, Plus, Search, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CreateChannelDialog } from '@/components/dialogs/create-channel-dialog'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { del, errorMessage, get, post } from '@/lib/api'
import { keys } from '@/lib/queries'

export default function BrowsePage() {
  const { org, api, base } = useOrgContext()
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [archived, setArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<Channel | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])
  const list = useQuery({
    queryKey: ['browse', org.id, q, archived],
    queryFn: ({ signal }) =>
      get<Channel[]>(
        `${api}/channels/browse?q=${encodeURIComponent(q)}&archived=${archived}`,
        signal,
      ),
    enabled: org.role !== 'guest',
  })

  if (org.role === 'guest')
    return (
      <EmptyState
        className="h-full"
        emoji="🚪"
        title="Guests can’t browse channels"
        description="Ask a member to add you to the channels you need."
      />
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Browse channels"
        icon={<Hash />}
        actions={
          can(org.role, 'channels.create') && (
            <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus /> Create channel
            </Button>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-6">
          <div className="mb-4 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                className="pl-8"
                placeholder="Search channels"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoFocus
              />
            </div>
            <Button
              variant={archived ? 'primary' : 'secondary'}
              onClick={() => setArchived((a) => !a)}
            >
              <Archive /> Archived
            </Button>
          </div>
          {list.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !list.data?.length ? (
            <EmptyState
              emoji={archived ? '🗄️' : '🧭'}
              title={archived ? 'No archived channels' : 'No channels found'}
              description={archived ? undefined : 'Create one to get the conversation started.'}
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {list.data.map((c) => (
                <li key={c.id} className="flex items-center gap-3 p-3">
                  <Link href={`${base}/c/${c.id}`} className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[14px] font-medium">
                      {c.kind === 'private' ? (
                        <Lock className="size-3.5 text-fg-subtle" />
                      ) : (
                        <Hash className="size-3.5 text-fg-subtle" />
                      )}
                      {c.name}
                      {c.membership && (
                        <span className="text-xs font-normal text-success">· Joined</span>
                      )}
                    </p>
                    <p className={cn('mt-0.5 truncate text-[13px] text-fg-muted')}>
                      {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
                      {c.description && ` · ${c.description}`}
                    </p>
                  </Link>
                  {!c.membership && !c.archivedAt && c.kind === 'public' && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const joined = await post<Channel>(`${api}/channels/${c.id}/join`)
                          qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
                            l ? [...l.filter((x) => x.id !== joined.id), joined] : l,
                          )
                          void list.refetch()
                        } catch (e) {
                          toast.error(errorMessage(e))
                        }
                      }}
                    >
                      Join
                    </Button>
                  )}
                  {can(org.role, 'channels.manage_any') && (
                    <IconButton
                      label={`Delete #${c.name}`}
                      size="sm"
                      className="text-fg-subtle hover:text-danger"
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2 />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <CreateChannelDialog open={createOpen} onOpenChange={setCreateOpen} />
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent
          title={`Delete #${deleting?.name}?`}
          description="The channel and all its messages and files are deleted for everyone. This can't be undone."
        >
          <DialogFooter>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const c = deleting!
                setDeleting(null)
                try {
                  await del(`${api}/channels/${c.id}`)
                  qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
                    l ? l.filter((x) => x.id !== c.id) : l,
                  )
                  void list.refetch()
                  toast.success(`#${c.name} was deleted`)
                } catch (e) {
                  toast.error(errorMessage(e))
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
