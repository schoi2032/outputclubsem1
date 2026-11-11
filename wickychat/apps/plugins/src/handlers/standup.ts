import { parseClock, partsIn, zoneOf } from '../time'
import { channel, ephemeral, type PluginImpl } from './types'

const HELP = [
  '**Standup**',
  '- `/standup` posts a standup thread now',
  '- `/standup daily 09:30 Seoul` posts one every weekday at that time',
  '- `/standup status` and `/standup off`',
].join('\n')

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

export const standupPost = (date?: string) =>
  [
    `🧍 **Daily standup**${date ? ` · ${date}` : ''}`,
    'Reply in this thread with:',
    '- **Yesterday:** what you finished',
    '- **Today:** what you are working on',
    '- **Blockers:** anything in your way',
  ].join('\n')

export const standup: PluginImpl = {
  async command(deps, input) {
    const text = input.text.trim()
    const key = { install: input.installId, channel: input.channel.id }
    if (!text) return channel(standupPost())
    if (text === 'help') return ephemeral(HELP)

    if (text === 'off') {
      await deps.sql`delete from official_plugins.standups
        where install_id = ${key.install} and channel_id = ${key.channel}`
      return ephemeral(`Daily standups in #${input.channel.name} are off.`)
    }
    if (text === 'status') {
      const [s] = await deps.sql<{ at_time: string; tz: string }[]>`
        select at_time, tz from official_plugins.standups
        where install_id = ${key.install} and channel_id = ${key.channel}`
      return ephemeral(
        s
          ? `Standup posts here every weekday at ${s.at_time} (${s.tz}).`
          : 'No daily standup here yet. Try `/standup daily 09:30 Seoul`.',
      )
    }

    const m = /^daily\s+(\S+(?:\s*[ap]m)?)(?:\s+(.+))?$/i.exec(text)
    const clock = m && parseClock(m[1]!)
    if (!m || !clock) return ephemeral(HELP)
    const tz = m[2] ? zoneOf(m[2]) : 'UTC'
    if (!tz) return ephemeral(`I don't know the time zone “${m[2]}”. Try a city or "Asia/Seoul".`)
    const at = `${String(clock[0]).padStart(2, '0')}:${String(clock[1]).padStart(2, '0')}`
    // If today's time has already passed, start tomorrow.
    const local = partsIn(deps.now(), tz)
    const lastRun = local.hhmm >= at ? local.date : null
    await deps.sql`
      insert into official_plugins.standups (install_id, channel_id, at_time, tz, last_run)
      values (${key.install}, ${key.channel}, ${at}, ${tz}, ${lastRun})
      on conflict (install_id, channel_id) do update
        set at_time = excluded.at_time, tz = excluded.tz, last_run = excluded.last_run`
    return channel(
      `🧍 Daily standup is set for #${input.channel.name}: every weekday at **${at}** (${tz}). Turn it off with \`/standup off\`.`,
    )
  },

  async cron(deps) {
    const rows = await deps.sql<
      {
        install_id: string
        channel_id: string
        at_time: string
        tz: string
        last_run: string | null
      }[]
    >`select install_id, channel_id, at_time, tz, last_run from official_plugins.standups`
    const now = deps.now()
    for (const s of rows) {
      const local = partsIn(now, s.tz)
      if (!WEEKDAYS.has(local.weekday) || local.hhmm < s.at_time || s.last_run === local.date)
        continue
      // Claim today's run so it posts once, even if two runs overlap.
      const claimed = await deps.sql`
        update official_plugins.standups set last_run = ${local.date}
        where install_id = ${s.install_id} and channel_id = ${s.channel_id}
          and last_run is distinct from ${local.date}
        returning 1`
      if (!claimed.length) continue
      const install = await deps.install(s.install_id)
      if (!install) continue
      const label = now.toLocaleDateString('en-US', {
        timeZone: s.tz,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
      await deps.post(install, s.channel_id, standupPost(label)).catch(() => {})
    }
  },
}
