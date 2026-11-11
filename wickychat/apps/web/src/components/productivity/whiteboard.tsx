'use client'
import type { Canvas } from '@quid/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  Tooltip,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BarChart3,
  LayoutTemplate,
  LineChart,
  PieChart,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, patch } from '@/lib/api'
import { pkeys } from '@/lib/productivity'
import { useOrgContext } from '../org-context'
import type { BoardStatus, ChartSpec, WhiteboardHandle } from './whiteboard-impl'

// Excalidraw is big and browser-only: load it when a whiteboard opens.
const WhiteboardImpl = dynamic(() => import('./whiteboard-impl'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Skeleton className="h-2/3 w-2/3" />
    </div>
  ),
})

const STICKY_COLORS: [string, string][] = [
  ['Yellow', '#fff3bf'],
  ['Pink', '#ffdeeb'],
  ['Green', '#d3f9d8'],
  ['Blue', '#d0ebff'],
  ['Purple', '#e5dbff'],
]

function useDark() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const el = document.documentElement
    const read = () => setDark(el.classList.contains('dark'))
    read()
    const o = new MutationObserver(read)
    o.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => o.disconnect()
  }, [])
  return dark
}

/** Build a chart from a small table, then drop it on the board. */
function ChartDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onInsert: (c: ChartSpec) => void
}) {
  const [kind, setKind] = useState<ChartSpec['kind']>('bar')
  const [title, setTitle] = useState('Q3 signups')
  const [rows, setRows] = useState([
    { label: 'Jul', value: 120 },
    { label: 'Aug', value: 180 },
    { label: 'Sep', value: 240 },
  ])
  const set = (i: number, patchRow: Partial<(typeof rows)[number]>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patchRow } : x)))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Insert a chart"
        description="Type or paste your numbers. You can move and restyle it on the board after."
      >
        <div className="flex flex-col gap-4">
          <fieldset className="flex gap-1.5">
            <legend className="sr-only">Chart type</legend>
            {(
              [
                ['bar', 'Bar', BarChart3],
                ['line', 'Line', LineChart],
                ['pie', 'Share', PieChart],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium ${kind === k ? 'border-accent bg-accent-subtle text-accent-text' : 'border-border text-fg-muted hover:bg-bg-subtle'}`}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </fieldset>
          <Field label="Title">
            {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Data</p>
            <div className="flex flex-col gap-1.5">
              {rows.map((r, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input
                    aria-label={`Label ${i + 1}`}
                    value={r.label}
                    onChange={(e) => set(i, { label: e.target.value })}
                    onPaste={(e) => {
                      // Paste a column pair from a spreadsheet: "Jul\t120\nAug\t180".
                      const text = e.clipboardData.getData('text')
                      if (!/[\t,]/.test(text) || !text.includes('\n')) return
                      e.preventDefault()
                      const parsed = text
                        .trim()
                        .split(/\r?\n/)
                        .map((line) => line.split(/\t|,/))
                        .filter((c) => c.length >= 2)
                        .map(([l, v]) => ({
                          label: (l ?? '').trim(),
                          value: Number(String(v).replace(/[^\d.-]/g, '')) || 0,
                        }))
                      if (parsed.length) setRows(parsed.slice(0, 24))
                    }}
                  />
                  <Input
                    aria-label={`Value ${i + 1}`}
                    type="number"
                    value={Number.isFinite(r.value) ? r.value : 0}
                    onChange={(e) => set(i, { value: Number(e.target.value) })}
                    className="w-28"
                  />
                  <IconButton
                    label="Remove row"
                    onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
            </div>
            {rows.length < 24 && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1.5"
                onClick={() => setRows((r) => [...r, { label: '', value: 0 }])}
              >
                <Plus /> Row
              </Button>
            )}
            <p className="mt-1 text-xs text-fg-subtle">
              Tip: paste two columns from a spreadsheet into a label box.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!rows.length}
            onClick={() => {
              onInsert({ kind, title, rows })
              onOpenChange(false)
            }}
          >
            Insert chart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A whiteboard canvas: Excalidraw plus WickyChat's toolbar (sticky notes, charts, templates). */
export function Whiteboard({
  canvas,
  canEdit,
  onBack,
}: {
  canvas: Canvas
  canEdit: boolean
  onBack: () => void
}) {
  const { api } = useOrgContext()
  const qc = useQueryClient()
  const dark = useDark()
  const [status, setStatus] = useState<BoardStatus>('saved')
  const [title, setTitle] = useState(canvas.title)
  const [chartOpen, setChartOpen] = useState(false)
  const handle = useRef<WhiteboardHandle | null>(null)
  const onReady = useCallback((h: WhiteboardHandle) => {
    handle.current = h
  }, [])

  // Someone deleted it while we're here.
  useEffect(() => {
    const on = (ev: Event) => {
      const e = (ev as CustomEvent<{ canvasId: string; deleted?: boolean }>).detail
      if (e.canvasId === canvas.id && e.deleted) onBack()
    }
    window.addEventListener('quid:canvas', on)
    return () => window.removeEventListener('quid:canvas', on)
  }, [canvas.id, onBack])

  const rename = async () => {
    const t = title.trim()
    if (!t || t === canvas.title) return
    try {
      await patch(`${api}/canvases/${canvas.id}`, { title: t })
      void qc.invalidateQueries({ queryKey: pkeys.canvases(canvas.channelId) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 md:px-4">
        <IconButton label="All canvases" size="sm" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <input
          aria-label="Whiteboard title"
          value={title}
          readOnly={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-w-0 max-w-64 rounded-md bg-transparent px-1.5 py-1 text-[14px] font-semibold outline-none hover:bg-bg-muted focus:bg-bg-muted"
        />
        {canEdit && (
          <div className="flex items-center gap-1">
            <Menu>
              <Tooltip content="Sticky note">
                <MenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <StickyNote /> Sticky
                  </Button>
                </MenuTrigger>
              </Tooltip>
              <MenuContent align="start">
                {STICKY_COLORS.map(([name, color]) => (
                  <MenuItem
                    key={name}
                    icon={
                      <span
                        className="size-3.5 rounded-sm border border-black/10"
                        style={{ background: color }}
                      />
                    }
                    onSelect={() => handle.current?.addSticky(color)}
                  >
                    {name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Button size="sm" variant="ghost" onClick={() => setChartOpen(true)}>
              <BarChart3 /> Chart
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  <LayoutTemplate /> Template
                </Button>
              </MenuTrigger>
              <MenuContent align="start">
                <MenuItem onSelect={() => handle.current?.addTemplate('brainstorm')}>
                  Brainstorm
                </MenuItem>
                <MenuItem onSelect={() => handle.current?.addTemplate('retro')}>
                  Retrospective
                </MenuItem>
                <MenuItem onSelect={() => handle.current?.addTemplate('kanban')}>
                  Kanban board
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        )}
        <span className="ml-auto text-xs text-fg-subtle" aria-live="polite">
          {!canEdit
            ? 'View only'
            : status === 'saving'
              ? 'Saving…'
              : status === 'offline'
                ? 'Reconnecting… your changes are kept'
                : 'All changes saved'}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <WhiteboardImpl
          canvas={canvas}
          canEdit={canEdit}
          dark={dark}
          onStatus={setStatus}
          onReady={onReady}
        />
      </div>
      <ChartDialog
        open={chartOpen}
        onOpenChange={setChartOpen}
        onInsert={(c) => handle.current?.addChart(c)}
      />
    </div>
  )
}
