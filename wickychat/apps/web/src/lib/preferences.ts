'use client'
/**
 * Personal preferences on the client. One module-level store so any component
 * can read a single setting without a provider, applied to <html> as data
 * attributes and CSS variables. Changes apply instantly, are cached in
 * localStorage (read by the pre-paint script in the root layout) and saved to
 * the account in the background.
 */
import {
  DEFAULT_ACCENT,
  DEFAULT_PREFERENCES,
  type Preferences,
  type PreferencesUpdate,
  resolvePreferences,
} from '@quid/shared'
import { toast } from '@quid/ui'
import type { QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { errorMessage, patch } from './api'
import type { MeData } from './queries'

export const PREFS_KEY = 'quid-prefs'
const LEGACY_THEME_KEY = 'quid-theme'

let current: Preferences = readCache() ?? DEFAULT_PREFERENCES
const listeners = new Set<() => void>()
let orgAccent: string | null = null

function readCache(): Preferences | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null
    return raw ? resolvePreferences(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeCache(p: Preferences) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
    localStorage.setItem(LEGACY_THEME_KEY, p.theme)
  } catch {}
}

function set(next: Preferences) {
  current = next
  applyPreferences(next)
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** All preferences. Re-renders when any of them changes. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_PREFERENCES,
  )
}

/** One preference. Re-renders only when that one changes. */
export function usePreference<K extends keyof Preferences>(key: K): Preferences[K] {
  return useSyncExternalStore(
    subscribe,
    () => current[key],
    () => DEFAULT_PREFERENCES[key],
  )
}

export const getPreferences = () => current

/** Reflects preferences on <html>. Mirrors the inline script in app/layout.tsx. */
export function applyPreferences(p: Preferences) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const dark =
    p.theme === 'dark' ||
    (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
  root.dataset.contrast = p.contrast
  root.dataset.font = p.font
  root.dataset.textSize = p.textSize
  root.dataset.radius = p.radius
  root.dataset.motion = p.motion
  root.dataset.density = p.density
  root.dataset.animateAvatars = p.animateAvatars
  // People who keep the default accent get their workspace's brand color.
  const accent = p.accent.toLowerCase() === DEFAULT_ACCENT && orgAccent ? orgAccent : p.accent
  if (accent.toLowerCase() === DEFAULT_ACCENT) {
    delete root.dataset.accent
    root.style.removeProperty('--q-accent-base')
  } else {
    root.dataset.accent = ''
    root.style.setProperty('--q-accent-base', accent)
  }
}

export const ORG_ACCENT_KEY = 'quid-org-accent'

/** The open workspace's brand color (null for none). Cached for the pre-paint script. */
export function setOrgAccent(color: string | null) {
  if (color === orgAccent) return
  orgAccent = color
  try {
    if (color) localStorage.setItem(ORG_ACCENT_KEY, color)
    else localStorage.removeItem(ORG_ACCENT_KEY)
  } catch {}
  applyPreferences(current)
}

// --- Saving -------------------------------------------------------------------

let qc: QueryClient | null = null
let pending: PreferencesUpdate = {}
let saveTimer: ReturnType<typeof setTimeout> | null = null
let inFlight = 0

async function flush() {
  saveTimer = null
  const body = pending
  pending = {}
  if (Object.keys(body).length === 0) return
  inFlight++
  try {
    const saved = await patch<Preferences>('/api/me/preferences', body)
    qc?.setQueryData<MeData | null>(['me'], (d) =>
      d ? { ...d, user: { ...d.user, preferences: saved } } : d,
    )
  } catch (e) {
    toast.error("Couldn't save your preferences", { description: errorMessage(e) })
  } finally {
    inFlight--
  }
}

/** Applies immediately; saves to the account shortly after (batched, so sliders don't spam). */
export function setPreferences(update: PreferencesUpdate) {
  const next = resolvePreferences({ ...current, ...update })
  writeCache(next)
  set(next)
  pending = { ...pending, ...update }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), 500)
}

export function resetPreferences() {
  setPreferences({ ...DEFAULT_PREFERENCES, lastSeenUpdate: current.lastSeenUpdate })
}

/**
 * Adopts the account's preferences once /api/me loads (or changes on another
 * device). Local edits that haven't been saved yet win.
 */
export function syncPreferences(client: QueryClient, server: Preferences) {
  qc = client
  if (saveTimer || inFlight > 0) return
  // One-time carry-over of the theme picked before preferences were synced.
  let legacyTheme: string | null = null
  try {
    if (!localStorage.getItem(PREFS_KEY)) legacyTheme = localStorage.getItem(LEGACY_THEME_KEY)
  } catch {}
  writeCache(server)
  set(server)
  if ((legacyTheme === 'light' || legacyTheme === 'dark') && server.theme === 'system')
    setPreferences({ theme: legacyTheme })
}

if (typeof window !== 'undefined') {
  // Other tabs.
  window.addEventListener('storage', (e) => {
    if (e.key !== PREFS_KEY) return
    const next = readCache()
    if (next) set(next)
  })
  // Follow the OS when the theme is "system".
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current.theme === 'system') applyPreferences(current)
  })
}
