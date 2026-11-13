'use client'
import { buildLiveDoc, type ItemKind, liveImageIds } from '@quid/shared'
import { cn } from '@quid/ui'
import { useEffect, useRef, useState } from 'react'
import { useLiveCode } from '@/lib/flair-css'

export const LIVE_KEY = 'wicky-live'
const MAX_RUNNING = 16
let running = 0
const images = new Map<string, Promise<string>>()

export function liveOn() {
  try {
    return localStorage.getItem(LIVE_KEY) !== 'off'
  } catch {
    return true
  }
}

function dataUrl(id: string) {
  let p = images.get(id)
  if (!p) {
    p = fetch(`/api/files/${id}/content?inline=1`, { credentials: 'include' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('image'))))
      .then(
        (b) =>
          new Promise<string>((res, rej) => {
            const fr = new FileReader()
            fr.onload = () => res(String(fr.result))
            fr.onerror = () => rej(fr.error)
            fr.readAsDataURL(b)
          }),
      )
    p.catch(() => images.delete(id))
    images.set(id, p)
  }
  return p
}

async function makeDoc(code: string, kind: ItemKind) {
  const found: Record<string, string> = {}
  await Promise.all(
    liveImageIds(code).map(async (id) => {
      found[id] = await dataUrl(id).catch(() => '')
    }),
  )
  const root = getComputedStyle(document.documentElement)
  const scheme = root.colorScheme || 'normal'
  return buildLiveDoc(code, found, {
    kind,
    dark: scheme.includes('dark'),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    scheme,
  })
}

const killed = new Set<string>()

export function LiveFrame({ code, kind }: { code: string; kind: ItemKind }) {
  const [doc, setDoc] = useState<string | null>(null)
  const [dead, setDead] = useState(() => killed.has(code))
  const loads = useRef(0)
  useEffect(() => {
    let live = true
    void makeDoc(code, kind).then((d) => live && setDoc(d))
    return () => {
      live = false
    }
  }, [code, kind])
  if (!doc || dead) return null
  return (
    <iframe
      onLoad={() => {
        loads.current++
        if (loads.current > 1) {
          killed.add(code)
          setDead(true)
        }
      }}
      sandbox="allow-scripts"
      srcDoc={doc}
      title="Live cosmetic"
      tabIndex={-1}
      aria-hidden="true"
      referrerPolicy="no-referrer"
      allow=""
    />
  )
}

export function LiveLayer({
  kind,
  value,
  code: given,
  front = false,
  pad = 6,
  className,
}: {
  kind: ItemKind
  value?: string | null
  code?: string | null
  front?: boolean
  pad?: number
  className?: string
}) {
  const fetched = useLiveCode(kind, given === undefined ? value : null)
  const code = given === undefined ? fetched : given
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [slot, setSlot] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || !code) return
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), {
      rootMargin: '120px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [code])

  useEffect(() => {
    if (!visible || !code || !liveOn() || running >= MAX_RUNNING) return
    running++
    setSlot(true)
    return () => {
      running--
      setSlot(false)
    }
  }, [visible, code])

  if (!code) return null
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn('q-live', front && 'q-live-front', className)}
      style={{ inset: -pad }}
    >
      {slot && <LiveFrame code={code} kind={kind} />}
    </span>
  )
}
