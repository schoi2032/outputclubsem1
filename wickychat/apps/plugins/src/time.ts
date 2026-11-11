/** Time zones by city name, and wall-clock math without a date library. */

export const CITIES: Record<string, string> = {
  seoul: 'Asia/Seoul',
  busan: 'Asia/Seoul',
  korea: 'Asia/Seoul',
  tokyo: 'Asia/Tokyo',
  osaka: 'Asia/Tokyo',
  japan: 'Asia/Tokyo',
  beijing: 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai',
  shenzhen: 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong',
  taipei: 'Asia/Taipei',
  singapore: 'Asia/Singapore',
  manila: 'Asia/Manila',
  bangkok: 'Asia/Bangkok',
  jakarta: 'Asia/Jakarta',
  hanoi: 'Asia/Ho_Chi_Minh',
  'ho chi minh': 'Asia/Ho_Chi_Minh',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  delhi: 'Asia/Kolkata',
  'new delhi': 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata',
  india: 'Asia/Kolkata',
  karachi: 'Asia/Karachi',
  dubai: 'Asia/Dubai',
  riyadh: 'Asia/Riyadh',
  'tel aviv': 'Asia/Jerusalem',
  istanbul: 'Europe/Istanbul',
  moscow: 'Europe/Moscow',
  cairo: 'Africa/Cairo',
  lagos: 'Africa/Lagos',
  nairobi: 'Africa/Nairobi',
  johannesburg: 'Africa/Johannesburg',
  'cape town': 'Africa/Johannesburg',
  london: 'Europe/London',
  uk: 'Europe/London',
  dublin: 'Europe/Dublin',
  lisbon: 'Europe/Lisbon',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  munich: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam',
  brussels: 'Europe/Brussels',
  madrid: 'Europe/Madrid',
  barcelona: 'Europe/Madrid',
  rome: 'Europe/Rome',
  milan: 'Europe/Rome',
  zurich: 'Europe/Zurich',
  vienna: 'Europe/Vienna',
  stockholm: 'Europe/Stockholm',
  oslo: 'Europe/Oslo',
  copenhagen: 'Europe/Copenhagen',
  helsinki: 'Europe/Helsinki',
  warsaw: 'Europe/Warsaw',
  prague: 'Europe/Prague',
  athens: 'Europe/Athens',
  kyiv: 'Europe/Kyiv',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  boston: 'America/New_York',
  miami: 'America/New_York',
  toronto: 'America/Toronto',
  montreal: 'America/Toronto',
  chicago: 'America/Chicago',
  austin: 'America/Chicago',
  dallas: 'America/Chicago',
  denver: 'America/Denver',
  phoenix: 'America/Phoenix',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  sf: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  vancouver: 'America/Vancouver',
  'mexico city': 'America/Mexico_City',
  'sao paulo': 'America/Sao_Paulo',
  'são paulo': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  bogota: 'America/Bogota',
  lima: 'America/Lima',
  santiago: 'America/Santiago',
  honolulu: 'Pacific/Honolulu',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  brisbane: 'Australia/Brisbane',
  perth: 'Australia/Perth',
  auckland: 'Pacific/Auckland',
  utc: 'UTC',
  gmt: 'UTC',
}

export function validZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** A city name or an IANA zone ("Asia/Seoul"), or null. */
export function zoneOf(name: string): string | null {
  const key = name.trim().toLowerCase()
  if (CITIES[key]) return CITIES[key]
  if (name.includes('/') && validZone(name.trim())) return name.trim()
  return null
}

/** Wall-clock parts of `date` in `tz`. */
export function partsIn(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  })
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]))
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: p.weekday as string,
    date: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${p.hour}:${p.minute}`,
  }
}

/** The UTC instant when the clock in `tz` shows the given wall time. */
export function zonedToUtc(
  tz: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): Date {
  let guess = Date.UTC(y, mo - 1, d, h, mi)
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz)
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += Date.UTC(y, mo - 1, d, h, mi) - shown
  }
  return new Date(guess)
}

/** "09:30", "9:30", "9am", "6:15pm" → [hour, minute]. */
export function parseClock(s: string): [number, number] | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim())
  if (!m) return null
  let h = Number(m[1])
  const mi = m[2] ? Number(m[2]) : 0
  if (!m[2] && !m[3]) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)
  }
  if (h > 23 || mi > 59) return null
  return [h, mi]
}
