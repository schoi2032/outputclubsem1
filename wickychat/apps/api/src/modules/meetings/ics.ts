/**
 * iCalendar (RFC 5545) files for meetings, so invitations land in Google
 * Calendar, Outlook and Apple Calendar.
 */

export interface IcsEvent {
  uid: string
  /** Increases on every change so calendar apps replace the earlier version. */
  sequence: number
  method: 'REQUEST' | 'CANCEL' | 'PUBLISH'
  start: Date
  durationMinutes: number
  title: string
  description: string
  url: string
  organizer: { name: string; email: string } | null
  attendees: { name: string; email: string }[]
}

/** Escapes text values (commas, semicolons, backslashes, newlines). */
export function escapeText(v: string) {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Folds lines longer than 75 octets, as the spec requires. */
export function fold(line: string) {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = ''
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74 // continuation lines start with a space
    if (Buffer.byteLength(current + ch, 'utf8') > limit) {
      parts.push(current)
      current = ch
    } else current += ch
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** 20261005T093000Z */
export function icsDate(d: Date) {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

const cn = (name: string) => `"${name.replace(/["\\]/g, '')}"`

export function buildIcs(e: IcsEvent) {
  const end = new Date(e.start.getTime() + e.durationMinutes * 60_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WickyChat//WickyChat Meet//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeText(e.title)}`,
    `DESCRIPTION:${escapeText(`${e.description ? `${e.description}\n\n` : ''}Join: ${e.url}`)}`,
    `LOCATION:${escapeText(e.url)}`,
    `URL:${e.url}`,
    `STATUS:${e.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(e.organizer ? [`ORGANIZER;CN=${cn(e.organizer.name)}:mailto:${e.organizer.email}`] : []),
    ...e.attendees.map(
      (a) =>
        `ATTENDEE;CN=${cn(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    ),
    ...(e.method === 'CANCEL'
      ? []
      : [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${escapeText(e.title)}`,
          'TRIGGER:-PT10M',
          'END:VALARM',
        ]),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}
