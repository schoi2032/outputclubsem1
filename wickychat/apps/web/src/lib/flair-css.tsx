'use client'
import { customIdOf, flairClass, type ItemKind, type SpecKind, scopeFlairCss } from '@quid/shared'
import { useEffect, useSyncExternalStore } from 'react'
import { useOrgContext } from '@/components/org-context'
import { get } from '@/lib/api'

type Entry = { kind: ItemKind; css: string | null; live: string | null }

const wanted = new Map<string, ItemKind>()
const loaded = new Map<string, Entry>()
const local = new Map<string, Partial<Entry> & { kind: ItemKind }>()
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
  for (const id of ids) loaded.set(id, { kind: wanted.get(id)!, css: null, live: null })
  get<Record<string, { css?: string; live?: string }>>(
    `${api}/cosmetics/styles?ids=${ids.join(',')}`,
  )
    .then((rows) => {
      for (const [id, r] of Object.entries(rows))
        loaded.set(id, { kind: wanted.get(id)!, css: r.css ?? null, live: r.live ?? null })
      emit()
    })
    .catch(() => {
      for (const id of ids) loaded.delete(id)
    })
  if ([...wanted.keys()].some((id) => !loaded.has(id))) timer = setTimeout(flush, 50)
}

export function wantCosmetic(kind: ItemKind, value: string | null | undefined) {
  const id = customIdOf(value)
  if (!id) return null
  if (!wanted.has(id)) {
    wanted.set(id, kind)
    if (!timer && typeof window !== 'undefined') timer = setTimeout(flush, 30)
  }
  return id
}

export function flairCssClass(kind: SpecKind, value: string | null | undefined) {
  const id = wantCosmetic(kind, value)
  return id ? flairClass(id) : ''
}

export function setLocalFlairCss(id: string, kind: ItemKind, css: string | null) {
  local.set(id, { ...local.get(id), kind, css })
  emit()
}

export function setLocalLive(id: string, kind: ItemKind, live: string | null) {
  local.set(id, { ...local.get(id), kind, live })
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const useVersion = () =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )

export function useLiveCode(kind: ItemKind, value: string | null | undefined) {
  useVersion()
  const id = wantCosmetic(kind, value)
  if (!id) return null
  const l = local.get(id)
  if (l && l.live !== undefined) return l.live
  return loaded.get(id)?.live ?? null
}

export function FlairStyles() {
  const { api: orgApi } = useOrgContext()
  useEffect(() => {
    api = orgApi
    loaded.clear()
    flush()
  }, [orgApi])
  const v = useVersion()
  const text = v >= 0 ? styles() : ''
  return text ? <style>{text}</style> : null
}

function styles() {
  const out: string[] = []
  const all = new Map<string, { kind: ItemKind; css?: string | null }>(loaded)
  for (const [id, l] of local) if (l.css !== undefined) all.set(id, l)
  for (const [id, e] of all) {
    if (!e.css || e.kind === 'sound_pack') continue
    if (
      ![
        'bubble',
        'name_effect',
        'message_effect',
        'typing',
        'reaction_skin',
        'mention_style',
      ].includes(e.kind)
    )
      continue
    const r = scopeFlairCss(e.kind as SpecKind, id, e.css)
    if ('css' in r) out.push(r.css)
  }
  return out.join('\n')
}
