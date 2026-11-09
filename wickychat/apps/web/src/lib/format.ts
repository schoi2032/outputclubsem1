import { getPreferences } from './preferences'

const dayMonth = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})
const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})
const short = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

// Times follow the 12h / 24h preference; formatters are cached per setting.
const timeFormats = new Map<string, { time: Intl.DateTimeFormat; full: Intl.DateTimeFormat }>()
function timeFormat() {
  const clock = getPreferences().clock
  let f = timeFormats.get(clock)
  if (!f) {
    const hour12 = clock === 'auto' ? undefined : clock === '12h'
    f = {
      time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12 }),
      full: new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12,
      }),
    }
    timeFormats.set(clock, f)
  }
  return f
}

export const formatTime = (iso: string) => timeFormat().time.format(new Date(iso))
export const formatFull = (iso: string) => timeFormat().full.format(new Date(iso))

export function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.getFullYear() === today.getFullYear() ? dayMonth.format(d) : fullDate.format(d)
}

export function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return short.format(new Date(iso))
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export const displayName = (u: { name: string; displayName: string | null }) =>
  u.displayName || u.name
