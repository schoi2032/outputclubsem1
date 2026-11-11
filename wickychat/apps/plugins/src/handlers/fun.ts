import { randomInt } from 'node:crypto'
import { CITIES, zoneOf } from '../time'
import { channel, ephemeral, type PluginImpl } from './types'

const DEFAULT_CITIES = ['Seoul', 'Tokyo', 'London', 'New York', 'San Francisco']

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

export const worldClock: PluginImpl = {
  async command(deps, input) {
    const text = input.text.trim()
    let names: string[]
    if (!text) names = DEFAULT_CITIES
    else {
      // Match multi-word cities greedily ("new york"), then single words.
      const words = text.split(/[\s,]+/).filter(Boolean)
      names = []
      for (let i = 0; i < words.length; ) {
        const n = [3, 2, 1].find((k) => zoneOf(words.slice(i, i + k).join(' ')))
        if (!n)
          return ephemeral(
            `I don't know “${words[i]}”. Try a city like Seoul or a zone like Asia/Seoul.`,
          )
        names.push(words.slice(i, i + n).join(' '))
        i += n
      }
    }
    const now = deps.now()
    const lines = names.slice(0, 12).map((name) => {
      const tz = zoneOf(name)!
      const t = now.toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
      const hour = Number(
        now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }),
      )
      const icon = hour >= 7 && hour < 19 ? '☀️' : '🌙'
      const label = CITIES[name.toLowerCase()] ? title(name) : name
      return `- ${icon} **${label}**  ${t}`
    })
    return channel(`🕐 **World clock**\n${lines.join('\n')}`)
  },
}

export const dice: PluginImpl = {
  async command(_deps, input) {
    const text = input.text.trim()
    const who = input.user.name
    if (input.command === 'flip') {
      return channel(`🪙 ${who} flipped a coin: **${randomInt(2) ? 'Heads' : 'Tails'}**`)
    }
    if (input.command === 'pick') {
      const options = text
        .split(text.includes(',') ? ',' : /\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (options.length < 2)
        return ephemeral('Give at least two options: `/pick pizza, sushi, tacos`')
      return channel(
        `🎯 Picked for ${who} from ${options.length}: **${options[randomInt(options.length)]}**`,
      )
    }
    // roll: "2d6", "d20", "3d8+2", or nothing for 1d6.
    const m = /^(\d{0,2})d(\d{1,4})([+-]\d{1,4})?$/i.exec(text || 'd6')
    const count = m ? Number(m[1] || 1) : 0
    const sides = m ? Number(m[2]) : 0
    if (!m || count < 1 || count > 20 || sides < 2 || sides > 1000)
      return ephemeral('Roll like `/roll 2d6`, `/roll d20` or `/roll 3d8+2` (up to 20 dice).')
    const mod = Number(m[3] ?? 0)
    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1))
    const total = rolls.reduce((a, b) => a + b, 0) + mod
    const detail = count > 1 || mod ? ` (${rolls.join(' + ')}${mod ? ` ${m[3]}` : ''})` : ''
    return channel(`🎲 ${who} rolled ${text || 'd6'}: **${total}**${detail}`)
  },
}
