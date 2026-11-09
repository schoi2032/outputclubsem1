import { parseClock, partsIn, zonedToUtc, zoneOf } from '../time'
import { ephemeral, type PluginImpl } from './types'

const HELP = [
  '**Reminders**',
  '- `/remind in 30m stretch` (also h, d, w, or "2 hours")',
  '- `/remind at 17:30 Seoul ship it` or `/remind tomorrow 9am London standup notes`',
  '- `/remind list` and `/remind cancel 3`',
].join('\n')

const UNITS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
}
const MAX_AHEAD = 366 * 86_400_000

/** Parses the "when" part off the front of the text. */
export function parseReminder(
  text: string,
  now: Date,
): { due: Date; what: string; zone?: string } | null {
  const rel = /^(?:in\s+)?(\d{1,4})\s*([a-z]+)\s+(.+)$/is.exec(text)
  if (rel && UNITS[rel[2]!.toLowerCase()]) {
    const due = new Date(now.getTime() + Number(rel[1]) * UNITS[rel[2]!.toLowerCase()]!)
    return { due, what: rel[3]!.trim() }
  }
  const abs = /^(at|tomorrow(?:\s+at)?)\s+(\S+(?:\s*[ap]m)?)\s+(.+)$/is.exec(text)
  if (!abs) return null
  const clock = parseClock(abs[2]!)
  if (!clock) return null
  // An optional city or zone right after the time: "at 9:00 Seoul call mom".
  let rest = abs[3]!.trim()
  let zone = 'UTC'
  const words = rest.split(/\s+/)
  for (const n of [3, 2, 1]) {
    const z = words.length > n ? zoneOf(words.slice(0, n).join(' ')) : null
    if (z) {
      zone = z
      rest = words.slice(n).join(' ')
      break
    }
  }
  const today = partsIn(now, zone)
  let due = zonedToUtc(zone, today.year, today.month, today.day, clock[0], clock[1])
  if (abs[1]!.toLowerCase().startsWith('tomorrow')) {
    const t = partsIn(new Date(due.getTime() + 86_400_000), zone)
    due = zonedToUtc(zone, t.year, t.month, t.day, clock[0], clock[1])
  } else if (due <= now) {
    const t = partsIn(new Date(due.getTime() + 86_400_000), zone)
    due = zonedToUtc(zone, t.year, t.month, t.day, clock[0], clock[1])
  }
  return { due, what: rest, zone }
}

const fmt = (d: Date, zone = 'UTC') =>
  `${d.toLocaleString('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${zone === 'UTC' ? ' UTC' : ` (${zone})`}`

const inWords = (ms: number) => {
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'less than a minute'
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.round(m / 6) / 10
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`
  return `${Math.round(h / 24)} days`
}

export const reminders: PluginImpl = {
  async command(deps, input) {
    const text = input.text.trim()
    if (!text || text === 'help') return ephemeral(HELP)
    const now = deps.now()

    if (text === 'list') {
      const rows = await deps.sql<{ id: number; text: string; due_at: Date }[]>`
        select id, text, due_at from official_plugins.reminders
        where install_id = ${input.installId} and user_id = ${input.user.id} and sent_at is null
        order by due_at limit 20`
      if (!rows.length) return ephemeral('You have no reminders coming up.')
      return ephemeral(
        `**Your reminders**\n${rows.map((r) => `- #${r.id} ${fmt(r.due_at)}: ${r.text}`).join('\n')}`,
      )
    }
    const cancel = /^cancel\s+#?(\d+)$/i.exec(text)
    if (cancel) {
      const gone = await deps.sql`
        delete from official_plugins.reminders
        where id = ${Number(cancel[1])} and install_id = ${input.installId}
          and user_id = ${input.user.id} and sent_at is null
        returning id`
      return ephemeral(
        gone.length ? 'Reminder canceled.' : 'No reminder of yours with that number.',
      )
    }

    const r = parseReminder(text, now)
    if (!r || !r.what) return ephemeral(`I couldn't tell when. Try:\n${HELP}`)
    if (r.due.getTime() - now.getTime() > MAX_AHEAD)
      return ephemeral('Reminders can be up to a year ahead.')
    const [row] = await deps.sql<{ id: number }[]>`
      insert into official_plugins.reminders (install_id, channel_id, thread_id, user_id, user_name, text, due_at)
      values (${input.installId}, ${input.channel.id}, ${input.threadId}, ${input.user.id},
              ${input.user.name}, ${r.what.slice(0, 1000)}, ${r.due})
      returning id`
    return ephemeral(
      `⏰ Got it. I'll remind #${input.channel.name} in ${inWords(r.due.getTime() - now.getTime())} (${fmt(r.due, r.zone)}): ${r.what}\nCancel with \`/remind cancel ${row!.id}\``,
    )
  },

  async cron(deps) {
    // Claim due reminders first, so two runs never post the same one.
    const due = await deps.sql<
      {
        id: number
        install_id: string
        channel_id: string
        thread_id: string | null
        user_name: string
        text: string
      }[]
    >`
      update official_plugins.reminders set sent_at = now()
      where id in (
        select id from official_plugins.reminders
        where sent_at is null and due_at <= ${deps.now()} order by due_at limit 100
      )
      returning id, install_id, channel_id, thread_id, user_name, text`
    for (const r of due) {
      const install = await deps.install(r.install_id)
      if (!install) continue
      await deps
        .post(install, r.channel_id, `⏰ **Reminder** from ${r.user_name}: ${r.text}`, r.thread_id)
        .catch(() => {})
    }
  },
}
