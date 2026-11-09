'use client'
import { Button, Dialog, DialogContent, DialogFooter, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Hash, Lock, Plug, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { type Plugin, PluginIcon, StatusBadge } from '@/components/plugins/shared'
import { SettingsCard } from '@/components/settings-ui'
import { del, errorMessage, get, post } from '@/lib/api'
import { useChannels } from '@/lib/queries'

const TABS = [
  { id: 'installed', label: 'Installed' },
  { id: 'verified', label: 'Verified' },
  { id: 'community', label: 'Community' },
  { id: 'private', label: 'Private' },
] as const

/** The plugin directory: browse, install and remove plugins (owners and admins). */
export function PluginDirectory({
  header,
}: {
  header: (actions: React.ReactNode) => React.ReactNode
}) {
  const { org, api, base } = useOrgContext()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['plugins', org.id],
    queryFn: ({ signal }) =>
      get<{ enterprise: boolean; plugins: Plugin[] }>(`${api}/plugins`, signal),
  })
  const channels = useChannels(org.id)
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('verified')
  const changed = () => {
    void q.refetch()
    void qc.invalidateQueries({ queryKey: ['plugin-commands', org.id] })
  }
  const [installing, setInstalling] = useState<Plugin | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const data = q.data
  const list = (data?.plugins ?? [])
    .filter((p) =>
      tab === 'installed'
        ? !!p.install
        : tab === 'verified'
          ? !p.private && p.status === 'verified'
          : tab === 'community'
            ? !p.private && p.status !== 'verified'
            : p.private,
    )
    // WickyChat's own plugins first.
    .sort((a, b) => Number(b.official) - Number(a.official))
  const pickable = (channels.data ?? []).filter(
    (c) => (c.kind === 'public' || c.kind === 'private') && !c.archivedAt && c.membership,
  )
  const chanName = (id: string) =>
    pickable.find((c) => c.id === id)?.name ??
    (channels.data ?? []).find((c) => c.id === id)?.name ??
    'channel'

  const install = async () => {
    if (!installing) return
    setBusy(true)
    try {
      await post(`${api}/plugins/${installing.id}/install`, {
        channelIds: picked,
        acceptUnverified: ack,
      })
      toast.success(`${installing.name} installed`)
      setInstalling(null)
      changed()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {header(
        <>
          <Button asChild variant="ghost">
            <Link href="/developers">
              <BookOpen /> Developer docs
            </Link>
          </Button>
          <Button asChild>
            <Link href={`${base}/settings/plugins/submit`}>
              <Plug /> Submit a plugin
            </Link>
          </Button>
        </>,
      )}
      <div className="mb-5 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium ${tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
          >
            {t.label}
            {t.id === 'installed' && data
              ? ` (${data.plugins.filter((p) => p.install).length})`
              : ''}
          </button>
        ))}
      </div>

      {tab === 'community' && (
        <p className="mb-4 flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px] text-fg-muted">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          Community plugins passed WickyChat's automatic safety checks but haven't been reviewed by
          the WickyChat team yet. Install them with care.
        </p>
      )}
      {tab === 'private' && (
        <p className="mb-4 flex gap-2 rounded-lg border border-border bg-bg-subtle p-3 text-[13px] text-fg-muted">
          <Lock className="mt-0.5 size-4 shrink-0" />
          Private plugins are built for {org.name} only and never appear in the public directory.
        </p>
      )}

      {!data ? (
        <Skeleton className="h-60" />
      ) : !list.length ? (
        <SettingsCard title="Nothing here yet">
          <p className="text-[13px] text-fg-muted">
            {tab === 'installed'
              ? 'No plugins installed.'
              : tab === 'private'
                ? 'No private plugins yet. Submit one to get started.'
                : 'No plugins in this list yet.'}
          </p>
        </SettingsCard>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((p) => (
            <li key={p.id} className="flex gap-4 rounded-xl border border-border p-4">
              <PluginIcon p={p} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold">{p.name}</span>
                  <StatusBadge p={p} />
                </div>
                <p className="text-[13px] text-fg-muted">{p.tagline}</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  by {p.developerName}
                  {p.homepageUrl && (
                    <>
                      {' · '}
                      <a
                        href={p.homepageUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline"
                      >
                        website
                      </a>
                    </>
                  )}
                </p>
                {p.commands.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {p.commands.map((c) => (
                      <code
                        key={c.name}
                        title={c.description}
                        className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-xs"
                      >
                        /{c.name}
                      </code>
                    ))}
                  </p>
                )}
                {p.install && (
                  <p className="mt-2 text-xs text-fg-subtle">
                    In{' '}
                    {p.install.channelIds.map((id) => `#${chanName(id)}`).join(', ') ||
                      'no channels'}
                  </p>
                )}
                {p.checks?.some((c) => c.status === 'failed') && (
                  <p className="mt-2 text-xs text-danger">
                    Failing:{' '}
                    {p.checks
                      .filter((c) => c.status === 'failed')
                      .map((c) => c.label)
                      .join(', ')}
                    .{' '}
                    <Link href={`${base}/settings/plugins/submit?id=${p.id}`} className="underline">
                      Details
                    </Link>
                  </p>
                )}
              </div>
              <div className="shrink-0">
                {p.install ? (
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    onClick={async () => {
                      try {
                        await del(`${api}/plugins/${p.id}/install`)
                        toast.success(`${p.name} removed`)
                        changed()
                      } catch (e) {
                        toast.error(errorMessage(e))
                      }
                    }}
                  >
                    Uninstall
                  </Button>
                ) : p.status === 'verified' || p.status === 'unverified' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setInstalling(p)
                      setPicked([])
                      setAck(false)
                    }}
                  >
                    Install
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!installing} onOpenChange={(o) => !o && setInstalling(null)}>
        {installing && (
          <DialogContent title={`Install ${installing.name}`} description={installing.tagline}>
            <div className="flex flex-col gap-4 text-[13px]">
              <div>
                <p className="font-medium">It will be able to</p>
                <ul className="mt-1 list-disc pl-5 text-fg-muted">
                  {installing.commands.length > 0 && (
                    <li>
                      Respond to {installing.commands.map((c) => `/${c.name}`).join(', ')} in the
                      channels below
                    </li>
                  )}
                  <li>Post messages as “{installing.name}” in the channels below</li>
                  {installing.events.includes('message.created') && (
                    <li>Read new messages in the channels below</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="font-medium">Channels</p>
                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border p-1">
                  {pickable.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-subtle"
                    >
                      <input
                        type="checkbox"
                        checked={picked.includes(c.id)}
                        onChange={(e) =>
                          setPicked((x) =>
                            e.target.checked ? [...x, c.id] : x.filter((i) => i !== c.id),
                          )
                        }
                        className="accent-[var(--q-accent)]"
                      />
                      {c.kind === 'private' ? (
                        <Lock className="size-3.5 text-fg-subtle" />
                      ) : (
                        <Hash className="size-3.5 text-fg-subtle" />
                      )}
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
              {installing.status === 'unverified' && !installing.private && (
                <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                    className="mt-0.5 accent-[var(--q-accent)]"
                  />
                  <span>
                    I understand this plugin passed automatic safety checks but hasn't been reviewed
                    by the WickyChat team, and that it will see messages in the channels I picked.
                  </span>
                </label>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setInstalling(null)}>Cancel</Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={
                  !picked.length ||
                  (installing.status === 'unverified' && !installing.private && !ack)
                }
                onClick={install}
              >
                Install
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
