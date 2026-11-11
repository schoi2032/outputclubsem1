'use client'
import type { Channel } from '@quid/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Textarea,
  Tooltip,
  toast,
} from '@quid/ui'
import { Plus, Zap } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { errorMessage, post } from '@/lib/api'
import { useShortcuts, type Workflow } from '@/lib/productivity'
import { useOrgContext } from '../org-context'

/** Runs a shortcut workflow, collecting its form first. */
export function RunWorkflowDialog({
  workflow,
  onClose,
}: {
  workflow: Workflow | null
  onClose: () => void
}) {
  const { api } = useOrgContext()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  if (!workflow) return null
  const missing = workflow.form.some((f) => f.required && !values[f.id]?.trim())
  const run = async () => {
    setBusy(true)
    try {
      await post(`${api}/workflows/${workflow.id}/run`, { values })
      toast.success(`${workflow.name} done`)
      setValues({})
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${workflow.emoji} ${workflow.name}`}
        description={workflow.description || undefined}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!missing) void run()
          }}
        >
          {workflow.form.map((f) => (
            <Field key={f.id} label={`${f.label}${f.required ? '' : ' (optional)'}`}>
              {(p) =>
                f.kind === 'long' ? (
                  <Textarea
                    {...p}
                    rows={3}
                    value={values[f.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  />
                ) : f.kind === 'select' ? (
                  <Select
                    {...p}
                    value={values[f.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  >
                    <option value="">Choose…</option>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    {...p}
                    value={values[f.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  />
                )
              }
            </Field>
          ))}
          {!workflow.form.length && (
            <p className="text-[13px] text-fg-muted">Run this workflow now?</p>
          )}
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={missing}>
              {workflow.form.length ? 'Submit' : 'Run'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The ⚡ button in a channel header: shortcuts you can run here. */
export function WorkflowsButton({ channel }: { channel: Channel }) {
  const { base, org } = useOrgContext()
  const q = useShortcuts(channel.id)
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState<Workflow | null>(null)
  if (!channel.membership || channel.kind === 'dm' || (org.role === 'guest' && !q.data?.length))
    return null
  const list = q.data ?? []
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip content="Workflows">
          <PopoverTrigger asChild>
            <IconButton label="Workflows">
              <Zap />
            </IconButton>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent align="end" className="w-72 p-1.5">
          <p className="px-2 pt-1.5 pb-1 text-xs font-semibold text-fg-subtle">
            Workflows in this channel
          </p>
          {list.length ? (
            list.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  setRunning(w)
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-bg-muted"
              >
                <span className="text-base leading-5">{w.emoji}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{w.name}</span>
                  {w.description && (
                    <span className="block truncate text-xs text-fg-subtle">{w.description}</span>
                  )}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-2 text-[13px] text-fg-muted">No shortcuts here yet.</p>
          )}
          {org.role !== 'guest' && (
            <Link
              href={`${base}/workflows/new?channel=${channel.id}`}
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-2 rounded-md border-t border-border px-2 pt-2.5 pb-1.5 text-[13px] text-fg-muted hover:text-fg"
            >
              <Plus className="size-3.5" /> Build a workflow
            </Link>
          )}
        </PopoverContent>
      </Popover>
      <RunWorkflowDialog workflow={running} onClose={() => setRunning(null)} />
    </>
  )
}
