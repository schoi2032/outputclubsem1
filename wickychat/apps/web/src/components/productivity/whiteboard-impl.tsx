'use client'
/**
 * The whiteboard itself (Excalidraw), loaded only in the browser.
 *
 * Sync: we send only the elements whose version changed since we last synced them,
 * a few times a second. The server keeps, per element, the copy with the higher
 * version and broadcasts what it kept; we fold remote changes in with Excalidraw's
 * own reconcile so whatever someone is editing locally isn't yanked away.
 */
import '@excalidraw/excalidraw/index.css'
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  MainMenu,
  reconcileElements,
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from '@excalidraw/excalidraw/types'
import type { Canvas } from '@quid/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { useMembers } from '@/lib/queries'
import { send as sendRealtime } from '@/lib/realtime'
import { useOrgContext } from '../org-context'

type Skeleton = Parameters<typeof convertToExcalidrawElements>[0]
type RemoteElements = Parameters<typeof reconcileElements>[1]

export type BoardStatus = 'saved' | 'saving' | 'offline'

export interface WhiteboardHandle {
  addSticky: (color?: string) => void
  addChart: (chart: ChartSpec) => void
  addTemplate: (t: 'retro' | 'brainstorm' | 'kanban') => void
}

export interface ChartSpec {
  kind: 'bar' | 'line' | 'pie'
  title: string
  rows: { label: string; value: number }[]
}

const PALETTE = [
  '#4c6ef5',
  '#12b886',
  '#fab005',
  '#fa5252',
  '#7950f2',
  '#15aabf',
  '#fd7e14',
  '#40c057',
]
const STICKY = {
  yellow: '#fff3bf',
  pink: '#ffdeeb',
  green: '#d3f9d8',
  blue: '#d0ebff',
  purple: '#e5dbff',
}
const CURSOR_COLORS = ['#e8590c', '#1c7ed6', '#2b8a3e', '#c2255c', '#5f3dc4', '#0b7285', '#e67700']

const colorFor = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return CURSOR_COLORS[h % CURSOR_COLORS.length]!
}

let inserts = 0
/** Where new things go: the middle of what you're looking at, nudged so they don't stack. */
function viewCenter(s: AppState) {
  const nudge = (inserts++ % 6) * 36
  return {
    x: -s.scrollX + s.width / 2 / s.zoom.value + nudge,
    y: -s.scrollY + s.height / 2 / s.zoom.value + nudge,
  }
}

function chartSkeleton(spec: ChartSpec, cx: number, cy: number): Skeleton {
  const rows = spec.rows.filter((r) => r.label.trim() || r.value)
  const max = Math.max(1, ...rows.map((r) => r.value))
  const out: Record<string, unknown>[] = []
  const text = (t: string, x: number, y: number, size = 16, extra: Record<string, unknown> = {}) =>
    out.push({ type: 'text', text: t, x, y, fontSize: size, ...extra })

  if (spec.kind === 'pie') {
    // A ring of labelled wedges isn't possible with primitives, so: a donut legend chart.
    const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0) || 1
    const left = cx - 220
    const top = cy - 30 * rows.length
    text(spec.title || 'Chart', left, top - 56, 26)
    let y = top
    rows.forEach((r, i) => {
      const share = Math.max(0, r.value) / total
      const w = Math.max(4, Math.round(share * 360))
      out.push({
        type: 'rectangle',
        x: left,
        y,
        width: w,
        height: 34,
        backgroundColor: PALETTE[i % PALETTE.length],
        strokeColor: PALETTE[i % PALETTE.length],
        fillStyle: 'solid',
        roughness: 0,
        roundness: { type: 3 },
      })
      text(`${r.label} · ${Math.round(share * 100)}%`, left + w + 12, y + 6, 18)
      y += 46
    })
    return out as unknown as Skeleton
  }

  const H = 260
  const step = 84
  const width = rows.length * step + 40
  const left = cx - width / 2
  const base = cy + H / 2
  text(spec.title || 'Chart', left, base - H - 64, 26)
  out.push({
    type: 'line',
    x: left,
    y: base,
    points: [
      [0, 0],
      [width, 0],
    ],
    strokeColor: '#868e96',
    roughness: 0,
  })
  out.push({
    type: 'line',
    x: left,
    y: base,
    points: [
      [0, 0],
      [0, -H - 10],
    ],
    strokeColor: '#868e96',
    roughness: 0,
  })
  if (spec.kind === 'bar') {
    rows.forEach((r, i) => {
      const h = Math.max(2, (Math.max(0, r.value) / max) * H)
      const x = left + 24 + i * step
      out.push({
        type: 'rectangle',
        x,
        y: base - h,
        width: 52,
        height: h,
        backgroundColor: PALETTE[i % PALETTE.length],
        strokeColor: PALETTE[i % PALETTE.length],
        fillStyle: 'solid',
        roughness: 0,
      })
      text(String(r.value), x + 8, base - h - 26, 16)
      text(r.label.slice(0, 12), x, base + 10, 14)
    })
  } else {
    const pts = rows.map((r, i) => [24 + i * step + 26, -(Math.max(0, r.value) / max) * H])
    out.push({
      type: 'line',
      x: left,
      y: base,
      points: pts,
      strokeColor: PALETTE[0],
      strokeWidth: 3,
      roughness: 0,
    })
    pts.forEach(([px, py], i) => {
      out.push({
        type: 'ellipse',
        x: left + px! - 6,
        y: base + py! - 6,
        width: 12,
        height: 12,
        backgroundColor: PALETTE[0],
        strokeColor: PALETTE[0],
        fillStyle: 'solid',
      })
      text(String(rows[i]!.value), left + px! - 10, base + py! - 32, 15)
      text(rows[i]!.label.slice(0, 12), left + px! - 20, base + 10, 14)
    })
  }
  return out as unknown as Skeleton
}

function stickySkeleton(x: number, y: number, color: string, label = ''): Record<string, unknown> {
  return {
    type: 'rectangle',
    x,
    y,
    width: 200,
    height: 160,
    backgroundColor: color,
    strokeColor: 'transparent',
    fillStyle: 'solid',
    roughness: 0,
    roundness: { type: 3 },
    label: { text: label || ' ', fontSize: 20, verticalAlign: 'top', textAlign: 'left' },
  }
}

function templateSkeleton(t: 'retro' | 'brainstorm' | 'kanban', cx: number, cy: number): Skeleton {
  const out: Record<string, unknown>[] = []
  const columns =
    t === 'retro'
      ? [
          ['Went well', STICKY.green],
          ['To improve', STICKY.pink],
          ['Action items', STICKY.blue],
        ]
      : t === 'kanban'
        ? [
            ['To do', STICKY.yellow],
            ['Doing', STICKY.blue],
            ['Done', STICKY.green],
          ]
        : null
  if (columns) {
    const w = 280
    const left = cx - (columns.length * (w + 30)) / 2
    columns.forEach(([title, color], i) => {
      const x = left + i * (w + 30)
      out.push({
        type: 'rectangle',
        x,
        y: cy - 260,
        width: w,
        height: 560,
        backgroundColor: '#f8f9fa',
        strokeColor: '#dee2e6',
        fillStyle: 'solid',
        roughness: 0,
        roundness: { type: 3 },
      })
      out.push({ type: 'text', text: title, x: x + 20, y: cy - 240, fontSize: 24 })
      out.push(stickySkeleton(x + 40, cy - 180, color as string))
    })
  } else {
    out.push({
      type: 'ellipse',
      x: cx - 120,
      y: cy - 60,
      width: 240,
      height: 120,
      backgroundColor: STICKY.purple,
      strokeColor: '#7950f2',
      fillStyle: 'solid',
      label: { text: 'Main idea', fontSize: 24 },
    })
    const spots = [
      [-420, -260],
      [220, -260],
      [-420, 140],
      [220, 140],
    ]
    for (const [dx, dy] of spots)
      out.push(stickySkeleton(cx + dx!, cy + dy!, STICKY.yellow, 'Idea'))
  }
  return out as unknown as Skeleton
}

export default function WhiteboardImpl({
  canvas,
  canEdit,
  dark,
  onStatus,
  onReady,
}: {
  canvas: Canvas
  canEdit: boolean
  dark: boolean
  onStatus: (s: BoardStatus) => void
  onReady: (h: WhiteboardHandle) => void
}) {
  const { api, me, org } = useOrgContext()
  const members = useMembers(org.id)
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null)
  /** Element id → version the server already has. */
  const synced = useRef(new Map<string, number>())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const collaborators = useRef(new Map<SocketId, Collaborator & { seen: number }>())
  const lastPointer = useRef(0)
  const names = useRef(new Map<string, string>())
  names.current = new Map((members.data ?? []).map((m) => [m.id, displayName(m)]))

  useEffect(() => {
    for (const e of canvas.scene ?? []) synced.current.set(e.id as string, e.version as number)
  }, [canvas.scene])

  const flush = useCallback(async () => {
    if (!excalidraw || inFlight.current) return
    const changed = excalidraw
      .getSceneElementsIncludingDeleted()
      .filter((e) => synced.current.get(e.id) !== e.version)
    if (!changed.length) return onStatus('saved')
    inFlight.current = true
    onStatus('saving')
    try {
      for (let i = 0; i < changed.length; i += 1000) {
        const batch = changed.slice(i, i + 1000)
        await post(`${api}/canvases/${canvas.id}/elements`, { elements: batch })
        for (const e of batch) synced.current.set(e.id, e.version)
      }
      onStatus('saved')
    } catch {
      onStatus('offline')
      // Try again shortly; nothing is lost, it's all still in the scene.
      flushTimer.current = setTimeout(() => void flush(), 3000)
    } finally {
      inFlight.current = false
    }
    // Changes made while we were sending go out next.
    if (
      !flushTimer.current &&
      excalidraw
        .getSceneElementsIncludingDeleted()
        .some((e) => synced.current.get(e.id) !== e.version)
    )
      flushTimer.current = setTimeout(() => {
        flushTimer.current = null
        void flush()
      }, 250)
  }, [excalidraw, api, canvas.id, onStatus])

  const schedule = useCallback(() => {
    if (flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      void flush()
    }, 250)
  }, [flush])

  // Remote changes.
  useEffect(() => {
    if (!excalidraw) return
    const onBoard = (ev: Event) => {
      const e = (
        ev as CustomEvent<{ canvasId: string; userId: string; elements: Record<string, unknown>[] }>
      ).detail
      if (e.canvasId !== canvas.id || e.userId === me.id) return
      const merged = reconcileElements(
        excalidraw.getSceneElementsIncludingDeleted() as readonly OrderedExcalidrawElement[],
        e.elements as unknown as RemoteElements,
        excalidraw.getAppState(),
      )
      for (const el of e.elements) synced.current.set(el.id as string, el.version as number)
      excalidraw.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })
    }
    const onPointer = (ev: Event) => {
      const e = (
        ev as CustomEvent<{
          canvasId: string
          userId: string
          x: number
          y: number
          button: 'up' | 'down'
          gone?: boolean
        }>
      ).detail
      if (e.canvasId !== canvas.id || e.userId === me.id) return
      const id = e.userId as SocketId
      if (e.gone) collaborators.current.delete(id)
      else
        collaborators.current.set(id, {
          id: e.userId,
          socketId: id,
          username: names.current.get(e.userId) ?? 'Someone',
          pointer: { x: e.x, y: e.y, tool: 'pointer' },
          button: e.button,
          color: { background: colorFor(e.userId), stroke: colorFor(e.userId) },
          seen: Date.now(),
        })
      excalidraw.updateScene({ collaborators: new Map(collaborators.current) })
    }
    // Forget cursors that went quiet.
    const sweep = setInterval(() => {
      let changed = false
      for (const [k, c] of collaborators.current)
        if (Date.now() - c.seen > 8000) {
          collaborators.current.delete(k)
          changed = true
        }
      if (changed) excalidraw.updateScene({ collaborators: new Map(collaborators.current) })
    }, 2000)
    window.addEventListener('quid:board', onBoard)
    window.addEventListener('quid:board-pointer', onPointer)
    return () => {
      clearInterval(sweep)
      window.removeEventListener('quid:board', onBoard)
      window.removeEventListener('quid:board-pointer', onPointer)
    }
  }, [excalidraw, canvas.id, me.id])

  // Leaving: send what's pending, and take our cursor away.
  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
      void flush()
      sendRealtime({
        type: 'board.pointer',
        channelId: canvas.channelId,
        canvasId: canvas.id,
        x: 0,
        y: 0,
        button: 'up',
        gone: true,
      })
    },
    [flush, canvas.channelId, canvas.id],
  )

  // The toolbar's helpers.
  useEffect(() => {
    if (!excalidraw) return
    // End-to-end tests read the board (it's drawn on a <canvas>, so there's no DOM to inspect).
    if (navigator.webdriver)
      (window as unknown as { __quidBoard?: unknown }).__quidBoard = excalidraw
    const add = (skeleton: Skeleton) => {
      const created = convertToExcalidrawElements(skeleton, { regenerateIds: true })
      excalidraw.updateScene({
        elements: [...excalidraw.getSceneElementsIncludingDeleted(), ...created],
        appState: { selectedElementIds: Object.fromEntries(created.map((e) => [e.id, true])) },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      schedule()
    }
    onReady({
      addSticky: (color = STICKY.yellow) => {
        const c = viewCenter(excalidraw.getAppState())
        add([stickySkeleton(c.x - 100, c.y - 80, color)] as unknown as Skeleton)
      },
      addChart: (spec) => {
        const c = viewCenter(excalidraw.getAppState())
        add(chartSkeleton(spec, c.x, c.y))
      },
      addTemplate: (t) => {
        const c = viewCenter(excalidraw.getAppState())
        add(templateSkeleton(t, c.x, c.y))
      },
    })
  }, [excalidraw, onReady, schedule])

  return (
    <div className="q-whiteboard h-full w-full">
      <Excalidraw
        excalidrawAPI={setExcalidraw}
        initialData={{
          elements: (canvas.scene ?? []) as unknown as ExcalidrawElement[],
          appState: { viewBackgroundColor: dark ? '#121212' : '#ffffff', currentItemRoughness: 1 },
          scrollToContent: true,
        }}
        theme={dark ? 'dark' : 'light'}
        viewModeEnabled={!canEdit}
        isCollaborating
        name={canvas.title}
        UIOptions={{
          tools: { image: false },
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: null,
            changeViewBackgroundColor: true,
            clearCanvas: canEdit,
            export: { saveFileToDisk: true },
            saveAsImage: true,
          },
        }}
        onChange={(elements) => {
          if (!canEdit) return
          for (const e of elements)
            if (synced.current.get(e.id) !== e.version) {
              schedule()
              break
            }
        }}
        onPointerUpdate={({ pointer, button }) => {
          const now = Date.now()
          if (now - lastPointer.current < 50) return
          lastPointer.current = now
          sendRealtime({
            type: 'board.pointer',
            channelId: canvas.channelId,
            canvasId: canvas.id,
            x: pointer.x,
            y: pointer.y,
            button,
          })
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          {canEdit && <MainMenu.DefaultItems.ClearCanvas />}
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  )
}
