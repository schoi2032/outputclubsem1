'use client'
import type {
  CalendarItem,
  OfficeHour,
  OfficeHourBooking,
  OfficeHourSlot,
  OfficeHourTeacher,
  UserSummary,
} from '@quid/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrgContext } from '@/components/org-context'
import { get } from './api'

export const ckeys = {
  calendar: (orgId: string) => ['calendar', orgId] as const,
  range: (orgId: string, from: string, to: string) => ['calendar', orgId, from, to] as const,
  progress: (id: string) => ['calendar-progress', id] as const,
  teachers: (orgId: string) => ['office-hours', orgId, 'teachers'] as const,
  slots: (orgId: string, teacherId: string) => ['office-hours', orgId, 'slots', teacherId] as const,
  mine: (orgId: string) => ['office-hours', orgId, 'mine'] as const,
  bookings: (orgId: string) => ['office-hours', orgId, 'bookings'] as const,
}

export function useCalendar(from: Date, to: Date) {
  const { api, org } = useOrgContext()
  const f = from.toISOString()
  const t = to.toISOString()
  return useQuery({
    queryKey: ckeys.range(org.id, f, t),
    queryFn: ({ signal }) =>
      get<CalendarItem[]>(
        `${api}/calendar?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`,
        signal,
      ),
    placeholderData: (prev) => prev,
  })
}

export function useProgress(eventId: string | null) {
  const { api } = useOrgContext()
  return useQuery({
    queryKey: ckeys.progress(eventId ?? ''),
    queryFn: ({ signal }) =>
      get<{ user: UserSummary; doneAt: string | null }[]>(
        `${api}/calendar/events/${eventId}/progress`,
        signal,
      ),
    enabled: !!eventId,
  })
}

export function useTeachers() {
  const { api, org } = useOrgContext()
  return useQuery({
    queryKey: ckeys.teachers(org.id),
    queryFn: ({ signal }) => get<OfficeHourTeacher[]>(`${api}/office-hours/teachers`, signal),
  })
}

export function useSlots(teacherId: string | null) {
  const { api, org } = useOrgContext()
  return useQuery({
    queryKey: ckeys.slots(org.id, teacherId ?? ''),
    queryFn: ({ signal }) =>
      get<OfficeHourSlot[]>(`${api}/office-hours/teachers/${teacherId}/slots`, signal),
    enabled: !!teacherId,
  })
}

export function useMyHours(enabled: boolean) {
  const { api, org } = useOrgContext()
  return useQuery({
    queryKey: ckeys.mine(org.id),
    queryFn: ({ signal }) => get<OfficeHour[]>(`${api}/office-hours/mine`, signal),
    enabled,
  })
}

export function useBookings() {
  const { api, org } = useOrgContext()
  return useQuery({
    queryKey: ckeys.bookings(org.id),
    queryFn: ({ signal }) => get<OfficeHourBooking[]>(`${api}/office-hours/bookings`, signal),
  })
}

export function useRefreshSchool() {
  const qc = useQueryClient()
  const { org } = useOrgContext()
  return () => {
    void qc.invalidateQueries({ queryKey: ['calendar', org.id] })
    void qc.invalidateQueries({ queryKey: ['office-hours', org.id] })
    void qc.invalidateQueries({ queryKey: ['calendar-progress'] })
  }
}

export const isTeacherRole = (role: string) => role === 'owner' || role === 'admin'

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function dayKey(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function parseDayKey(s: string | null) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export const longDay = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

export function twelveHour(t: string) {
  const [h, m] = t.split(':').map(Number) as [number, number]
  const ampm = h >= 12 ? 'pm' : 'am'
  const hh = h % 12 || 12
  return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`
}
