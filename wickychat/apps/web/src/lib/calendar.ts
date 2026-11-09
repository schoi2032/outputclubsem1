import type { Meeting } from '@quid/shared'

const compact = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

function times(m: Meeting) {
  const start = new Date(m.scheduledFor ?? m.startedAt ?? m.createdAt)
  return { start, end: new Date(start.getTime() + m.durationMinutes * 60_000) }
}

/** Opens Google Calendar with the event pre-filled. */
export function googleCalendarUrl(m: Meeting, link: string) {
  const { start, end } = times(m)
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title,
    dates: `${compact(start)}/${compact(end)}`,
    details: `${m.description ? `${m.description}\n\n` : ''}Join: ${link}`,
    location: link,
  })
  return `https://calendar.google.com/calendar/render?${p}`
}

/** Opens Outlook on the web with the event pre-filled. */
export function outlookCalendarUrl(m: Meeting, link: string) {
  const { start, end } = times(m)
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: m.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: `${m.description ? `${m.description}\n\n` : ''}Join: ${link}`,
    location: link,
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`
}
