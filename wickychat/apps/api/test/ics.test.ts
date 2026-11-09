import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, fold, icsDate } from '../src/modules/meetings/ics'

describe('ics', () => {
  it('escapes text and formats dates', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe(String.raw`a\,b\;c\\d\ne`)
    expect(icsDate(new Date('2026-10-05T09:30:00.000Z'))).toBe('20261005T093000Z')
  })

  it('folds long lines at 75 octets, including multi-byte text', () => {
    const long = `SUMMARY:${'회의 '.repeat(40)}`
    const folded = fold(long)
    for (const line of folded.split('\r\n'))
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })

  it('builds a valid invitation', () => {
    const ics = buildIcs({
      uid: 'abc@quid',
      sequence: 3,
      method: 'REQUEST',
      start: new Date('2026-10-05T09:00:00Z'),
      durationMinutes: 45,
      title: 'Plan, review',
      description: 'Agenda',
      url: 'https://quid.example/acme/meet/abc-defg-hij',
      organizer: { name: 'Ada', email: 'ada@example.com' },
      attendees: [{ name: 'Bea', email: 'bea@example.com' }],
    })
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/)
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('METHOD:REQUEST')
    expect(unfolded).toContain('DTSTART:20261005T090000Z')
    expect(unfolded).toContain('DTEND:20261005T094500Z')
    expect(unfolded).toContain('SUMMARY:Plan\\, review')
    expect(unfolded).toContain('ORGANIZER;CN="Ada":mailto:ada@example.com')
    expect(unfolded).toContain('mailto:bea@example.com')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})
