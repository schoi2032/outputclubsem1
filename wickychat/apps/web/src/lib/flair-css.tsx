'use client'
import { customIdOf, flairClass, type SpecKind, scopeFlairCss } from '@quid/shared'
import { useEffect, useSyncExternalStore } from 'react'
import { useOrgContext } from '@/components/org-context'
import { get } from '@/lib/api'

type Entry = { kind: SpecKind; css: string | null }

const wanted = new Map<string, SpecKind>()
const loaded = new Map<string, Entry>()
const local = new Map<string, Entry>()
const listeners = new Set<() => void>()
let api = ''
let timer: ReturnType<typeof setTimeout> | null = null
let version = 0

const emit = () => {
  version++
  for (const l of listeners) l()
}

function flush() {
  timer = null
  if (!api) return
  const ids = [...wanted.keys()].filter((id) => !loaded.has(id)).slice(0, 40)
  if (!ids.length) return
  for (const id of ids) loaded.set(id, { kind: wanted.get(id)!, css: null })
  get<Record<string, string>>(`${api}/cosmetics/styles?ids=${ids.join(',')}`)
    .then((rows) => {
      for (const [id, css] of Object.entries(rows)) loaded.set(id, { kind: wanted.get(id)!, css })
      emit()
    })
    .catch(() => {
      for (const id of ids) loaded.delete(id)
    })
  if ([...wanted.keys()].some((id) => !loaded.has(id))) timer = setTimeout(flush, 50)
}

export function flairCssClass(kind: SpecKind, value: string | null | undefined) {
  const id = customIdOf(value)
  if (!id) return ''
  if (!wanted.has(id)) {
    wanted.set(id, kind)
    if (!timer && typeof window !== 'undefined') timer = setTimeout(flush, 30)
  }
  return flairClass(id)
}

export function setLocalFlairCss(id: string, kind: SpecKind, css: string | null) {
  if (css) local.set(id, { kind, css })
  else local.delete(id)
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function FlairStyles() {
  const { api: orgApi } = useOrgContext()
  useEffect(() => {
    api = orgApi
    loaded.clear()
    flush()
  }, [orgApi])
  const v = useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  const text = v >= 0 ? styles() : ''
  return text ? <style>{text}</style> : null
}

function styles() {
  const out: string[] = []
  for (const [id, e] of [...loaded, ...local]) {
    if (!e.css) continue
    const r = scopeFlairCss(e.kind, id, e.css)
    if ('css' in r) out.push(r.css)
  }
  return out.join('\n')
}
