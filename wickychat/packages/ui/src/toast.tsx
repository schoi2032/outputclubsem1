'use client'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { cn } from './cn'

type Tone = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  tone: Tone
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

function push(tone: Tone, title: string, opts: Omit<ToastItem, 'id' | 'tone' | 'title'> = {}) {
  const id = nextId++
  items = [...items.slice(-3), { id, tone, title, ...opts }]
  emit()
  return id
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  info: (title: string, opts?: Omit<ToastItem, 'id' | 'tone' | 'title'>) =>
    push('info', title, opts),
  success: (title: string, opts?: Omit<ToastItem, 'id' | 'tone' | 'title'>) =>
    push('success', title, opts),
  error: (title: string, opts?: Omit<ToastItem, 'id' | 'tone' | 'title'>) =>
    push('error', title, opts),
}

function ToastView({ t }: { t: ToastItem }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(t.id), t.tone === 'error' ? 7000 : 4500)
    return () => clearTimeout(timer)
  }, [t.id, t.tone])
  const Icon = t.tone === 'success' ? CircleCheck : t.tone === 'error' ? CircleAlert : Info
  return (
    <div
      role={t.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-80 animate-in items-start gap-2.5 rounded-lg border border-border bg-bg-overlay p-3 shadow-pop"
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          t.tone === 'success' && 'text-success',
          t.tone === 'error' && 'text-danger',
          t.tone === 'info' && 'text-fg-subtle',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{t.title}</p>
        {t.description && <p className="mt-0.5 text-xs text-fg-muted">{t.description}</p>}
        {t.action && (
          <button
            type="button"
            className="mt-1.5 text-xs font-medium text-accent-text hover:underline"
            onClick={() => {
              t.action!.onClick()
              dismissToast(t.id)
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-fg-subtle hover:text-fg"
        onClick={() => dismissToast(t.id)}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
    () => items,
  )
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col gap-2"
    >
      {list.map((t) => (
        <ToastView key={t.id} t={t} />
      ))}
    </div>
  )
}
