/**
 * WickyChat seasonal events. Each one has items (in EFFECTS / PLATES / THEMES with an `event`)
 * and a crate that are only sold while it's on. After that they're collectibles you can only
 * get by trading or from the Market. Dates are school days in Korea, every year.
 */

export interface SeasonEvent {
  id: string
  name: string
  emoji: string
  description: string
  /** Month (1-12) and day it starts and ends, both included. May wrap past New Year. */
  start: [number, number]
  end: [number, number]
  /** Two colours for its banner and crate. */
  colors: [string, string]
}

export const SEASON_EVENTS: SeasonEvent[] = [
  {
    id: 'lunar',
    name: 'Lunar New Year',
    emoji: '🧧',
    description: 'Lanterns, lucky red and a crate full of fortune.',
    start: [1, 20],
    end: [2, 19],
    colors: ['#d7263d', '#f6c344'],
  },
  {
    id: 'valentine',
    name: "Valentine's Week",
    emoji: '💘',
    description: 'Hearts for your friends (and the crush you will never tell).',
    start: [2, 7],
    end: [2, 16],
    colors: ['#ff4d8d', '#ffb3c6'],
  },
  {
    id: 'spring',
    name: 'Spring Bloom',
    emoji: '🌷',
    description: 'Flowers, butterflies and pastel everything.',
    start: [3, 15],
    end: [4, 30],
    colors: ['#f9a8d4', '#86efac'],
  },
  {
    id: 'finals',
    name: 'Finals Week',
    emoji: '📚',
    description: 'Survive exams in style. Coffee not included.',
    start: [5, 20],
    end: [6, 14],
    colors: ['#1e3a8a', '#fbbf24'],
  },
  {
    id: 'summer',
    name: 'Summer Break',
    emoji: '🏖️',
    description: 'Beach days and watermelon.',
    start: [6, 15],
    end: [8, 31],
    colors: ['#06b6d4', '#facc15'],
  },
  {
    id: 'halloween',
    name: 'Halloween',
    emoji: '🎃',
    description: 'Bats, ghosts and a spooky theme.',
    start: [10, 15],
    end: [11, 2],
    colors: ['#ff7a00', '#6d28d9'],
  },
  {
    id: 'harvest',
    name: 'Autumn Harvest',
    emoji: '🍁',
    description: 'Falling leaves and warm maple colours.',
    start: [11, 3],
    end: [11, 30],
    colors: ['#c2410c', '#eab308'],
  },
  {
    id: 'winter',
    name: 'Winter Wonderland',
    emoji: '⛄',
    description: 'Snowmen, presents and a frosty theme.',
    start: [12, 1],
    end: [1, 6],
    colors: ['#38bdf8', '#e0f2fe'],
  },
]

export const seasonEventById = (id: string | null | undefined) =>
  SEASON_EVENTS.find((e) => e.id === id)

const KST = 9 * 3_600_000
const md = (m: number, d: number) => m * 100 + d

/** Today's month and day in Korea. */
function kstToday(now: Date) {
  const k = new Date(now.getTime() + KST)
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() }
}

export function isEventLive(id: string | null | undefined, now = new Date()) {
  const e = seasonEventById(id)
  if (!e) return false
  const t = kstToday(now)
  const today = md(t.m, t.d)
  const a = md(...e.start)
  const b = md(...e.end)
  return a <= b ? today >= a && today <= b : today >= a || today <= b
}

export const liveEvents = (now = new Date()) => SEASON_EVENTS.filter((e) => isEventLive(e.id, now))

/** When the event ends (the end of its last day in Korea), for a live event. */
export function eventEndsAt(e: SeasonEvent, now = new Date()): Date {
  const t = kstToday(now)
  const wraps = md(...e.start) > md(...e.end)
  const y = wraps && t.m >= e.start[0] ? t.y + 1 : t.y
  return new Date(Date.UTC(y, e.end[0] - 1, e.end[1] + 1) - KST)
}

/** When it next starts, for one that isn't on. */
export function eventStartsAt(e: SeasonEvent, now = new Date()): Date {
  const t = kstToday(now)
  const thisYear = new Date(Date.UTC(t.y, e.start[0] - 1, e.start[1]) - KST)
  return thisYear > now ? thisYear : new Date(Date.UTC(t.y + 1, e.start[0] - 1, e.start[1]) - KST)
}

/** Events coming up next, soonest first. */
export const upcomingEvents = (now = new Date()) =>
  SEASON_EVENTS.filter((e) => !isEventLive(e.id, now)).sort(
    (a, b) => eventStartsAt(a, now).getTime() - eventStartsAt(b, now).getTime(),
  )
