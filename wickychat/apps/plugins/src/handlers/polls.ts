import { channel, type Deps, ephemeral, type PluginImpl } from './types'

interface Poll {
  id: number
  question: string
  options: string[]
  created_by: string
  closed: boolean
}

const HELP = [
  '**Polls**',
  '- `/poll Lunch? | Pizza | Sushi | Tacos` starts a poll',
  '- `/vote 2` votes (you can change your vote)',
  '- `/poll results` shows the count, `/poll close` ends it',
].join('\n')

async function latest(deps: Deps, installId: string, channelId: string) {
  const [p] = await deps.sql<Poll[]>`
    select id, question, options, created_by, closed from official_plugins.polls
    where install_id = ${installId} and channel_id = ${channelId}
    order by id desc limit 1`
  return p ?? null
}

async function tally(deps: Deps, p: Poll) {
  const rows = await deps.sql<{ option: number; n: number }[]>`
    select option, count(*)::int as n from official_plugins.votes where poll_id = ${p.id} group by option`
  const counts = p.options.map((_, i) => rows.find((r) => r.option === i)?.n ?? 0)
  const total = counts.reduce((a, b) => a + b, 0)
  const top = Math.max(...counts)
  const lines = p.options.map((o, i) => {
    const n = counts[i]!
    const pct = total ? Math.round((n / total) * 100) : 0
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))
    const name = n && n === top ? `**${o}**` : o
    return `- ${i + 1}. ${name}  ${bar} ${n} (${pct}%)`
  })
  return { lines, total }
}

export const polls: PluginImpl = {
  async command(deps, input) {
    const text = input.text.trim()
    if (input.command === 'vote') {
      const p = await latest(deps, input.installId, input.channel.id)
      if (!p) return ephemeral('There is no poll in this channel yet. Start one with `/poll`.')
      if (p.closed) return ephemeral(`“${p.question}” is closed.`)
      const n = Number.parseInt(text, 10)
      const byName = p.options.findIndex((o) => o.toLowerCase() === text.toLowerCase())
      const choice = Number.isInteger(n) && n >= 1 && n <= p.options.length ? n - 1 : byName
      if (choice < 0)
        return ephemeral(
          `Pick 1–${p.options.length}:\n${p.options.map((o, i) => `- ${i + 1}. ${o}`).join('\n')}`,
        )
      await deps.sql`
        insert into official_plugins.votes (poll_id, user_id, option)
        values (${p.id}, ${input.user.id}, ${choice})
        on conflict (poll_id, user_id) do update set option = excluded.option`
      const { lines, total } = await tally(deps, p)
      return ephemeral(
        `You voted for **${p.options[choice]}**.\n${lines.join('\n')}\n${total} vote${total === 1 ? '' : 's'} so far`,
      )
    }

    if (!text || text === 'help') return ephemeral(HELP)
    if (text === 'results' || text === 'close') {
      const p = await latest(deps, input.installId, input.channel.id)
      if (!p) return ephemeral('There is no poll in this channel yet.')
      if (text === 'close') {
        if (p.created_by !== input.user.id)
          return ephemeral('Only the person who started the poll can close it.')
        await deps.sql`update official_plugins.polls set closed = true where id = ${p.id}`
      }
      const { lines, total } = await tally(deps, p)
      const head = text === 'close' || p.closed ? '📊 **Final results:**' : '📊 **Results so far:**'
      return channel(
        `${head} ${p.question}\n${lines.join('\n')}\n${total} vote${total === 1 ? '' : 's'}`,
      )
    }

    const parts = text
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
    const [question, ...options] = parts
    if (!question || options.length < 2)
      return ephemeral('Give a question and at least two options:\n`/poll Lunch? | Pizza | Sushi`')
    if (options.length > 10) return ephemeral('Polls can have up to 10 options.')
    await deps.sql`
      insert into official_plugins.polls (install_id, channel_id, question, options, created_by)
      values (${input.installId}, ${input.channel.id}, ${question.slice(0, 300)},
              ${deps.sql.json(options.map((o) => o.slice(0, 100)))}, ${input.user.id})`
    return channel(
      [
        `📊 **${question}**  (poll by ${input.user.name})`,
        ...options.map((o, i) => `- ${i + 1}. ${o}`),
        'Vote with `/vote 1`, `/vote 2`…',
      ].join('\n'),
    )
  },
}
