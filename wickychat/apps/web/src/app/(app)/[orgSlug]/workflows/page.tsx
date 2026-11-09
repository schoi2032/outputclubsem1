'use client'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  Switch,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Play, Plus, Trash2, Zap } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { templates, triggerSummary } from '@/components/productivity/workflow-builder'
import { RunWorkflowDialog } from '@/components/productivity/workflow-run'
import { del, errorMessage, patch } from '@/lib/api'
import { displayName, relative } from '@/lib/format'
import { pkeys, useWorkflows, type Workflow } from '@/lib/productivity'
import { useChannels } from '@/lib/queries'

/** The Workflow Builder's home: your automations, and templates to start from. */
export default function WorkflowsPage() {
  const { org, base, api, me } = useOrgContext()
  const qc = useQueryClient()
  const q = useWorkflows()
  const channels = useChannels(org.id)
  const [running, setRunning] = useState<Workflow | null>(null)
  const chanName = (id: string) => `#${channels.data?.find((c) => c.id === id)?.name ?? 'channel'}`
  const refresh = () => qc.invalidateQueries({ queryKey: pkeys.workflows(org.id) })

  if (org.role === 'guest')
    return (
      <EmptyState
        emoji="⚡"
        title="Workflows"
        description="Guests can run workflows in channels, but can’t build them."
      />
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Workflows"
        icon={<Zap />}
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href={`${base}/workflows/new`}>
              <Plus /> New workflow
            </Link>
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-8">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">Automate the busywork</h2>
          <p className="mt-1 max-w-xl text-[13.5px] text-fg-muted">
            Build workflows without code: pick what starts them, then add steps like posting a
            message, sending a DM or creating a task.
          </p>

          <h3 className="mt-8 mb-3 text-xs font-semibold text-fg-subtle uppercase">
            Start from a template
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates('', me.id).map((tpl) => (
              <Link
                key={tpl.key}
                href={`${base}/workflows/new?template=${tpl.key}`}
                className="q-lift flex gap-3 rounded-xl border border-border bg-bg p-4 hover:border-border-strong hover:bg-bg-subtle"
              >
                <span className="text-2xl leading-none">{tpl.value.emoji}</span>
                <span>
                  <span className="block text-[13.5px] font-semibold">{tpl.title}</span>
                  <span className="block text-xs text-fg-muted">{tpl.detail}</span>
                </span>
              </Link>
            ))}
          </div>

          <h3 className="mt-10 mb-3 text-xs font-semibold text-fg-subtle uppercase">
            Workflows in {org.name}
          </h3>
          {q.isLoading ? (
            <Skeleton className="h-32" />
          ) : !q.data?.length ? (
            <EmptyState
              emoji="⚡"
              title="No automations yet"
              description="Pick a template above or start from scratch, and let the robots handle the busywork."
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {q.data.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-bg p-3.5"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bg-muted text-xl">
                    {w.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[14px] font-semibold">
                      <span className="truncate">{w.name}</span>
                      {!w.enabled && <Badge>Off</Badge>}
                      {w.lastError && <Badge tone="danger">Last run failed</Badge>}
                    </p>
                    <p className="truncate text-xs text-fg-muted">
                      {triggerSummary(w.trigger, chanName)} · {w.steps.length} step
                      {w.steps.length === 1 ? '' : 's'}
                    </p>
                    <p className="truncate text-xs text-fg-subtle">
                      {w.runCount} run{w.runCount === 1 ? '' : 's'}
                      {w.lastRunAt ? ` · last ${relative(w.lastRunAt)}` : ''}
                      {w.createdBy ? ` · by ${displayName(w.createdBy)}` : ''}
                      {w.lastError ? ` · ${w.lastError}` : ''}
                    </p>
                  </div>
                  {w.trigger.type === 'shortcut' && w.enabled && (
                    <Button size="sm" onClick={() => setRunning(w)}>
                      <Play /> Run
                    </Button>
                  )}
                  {w.canEdit && (
                    <>
                      <Switch
                        label={`${w.name} on`}
                        checked={w.enabled}
                        onCheckedChange={async (v) => {
                          try {
                            await patch(`${api}/workflows/${w.id}`, { enabled: v })
                            void refresh()
                          } catch (e) {
                            toast.error(errorMessage(e))
                          }
                        }}
                      />
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton label={`${w.name} actions`} size="sm">
                            <MoreHorizontal />
                          </IconButton>
                        </MenuTrigger>
                        <MenuContent align="end">
                          <MenuItem icon={<Pencil />} asChild>
                            <Link href={`${base}/workflows/${w.id}`}>Edit</Link>
                          </MenuItem>
                          <MenuItem
                            danger
                            icon={<Trash2 />}
                            onSelect={async () => {
                              try {
                                await del(`${api}/workflows/${w.id}`)
                                void refresh()
                              } catch (e) {
                                toast.error(errorMessage(e))
                              }
                            }}
                          >
                            Delete
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <RunWorkflowDialog workflow={running} onClose={() => setRunning(null)} />
    </div>
  )
}
