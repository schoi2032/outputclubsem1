/**
 * Plugins made and hosted by WickyChat (apps/plugins). The API lists them as verified and
 * official; the plugin service serves each at {OFFICIAL_PLUGINS_URL}/{slug}.
 */
export interface OfficialPlugin {
  slug: string
  name: string
  tagline: string
  description: string
  commands: { name: string; description: string; usage?: string }[]
  events: 'message.created'[]
}

export const OFFICIAL_PLUGINS: OfficialPlugin[] = [
  {
    slug: 'quid-polls',
    name: 'Polls',
    tagline: 'Ask the team and see answers add up',
    description:
      'Start a poll with /poll, then everyone votes with /vote. Results update as votes come in, one vote per person.',
    commands: [
      {
        name: 'poll',
        description: 'Start a poll, or show results / close the latest one',
        usage: 'Lunch? | Pizza | Sushi | Tacos',
      },
      { name: 'vote', description: 'Vote in the latest poll in this channel', usage: '2' },
    ],
    events: [],
  },
  {
    slug: 'quid-reminders',
    name: 'Reminders',
    tagline: 'Nudge yourself or the channel later',
    description:
      'Set reminders like "/remind in 30m stretch" or "/remind tomorrow 9am Seoul send the report". They are posted in the channel at the right time.',
    commands: [
      {
        name: 'remind',
        description: 'Set a reminder, or list / cancel yours',
        usage: 'in 30m stand up and stretch',
      },
    ],
    events: [],
  },
  {
    slug: 'quid-standup',
    name: 'Standup',
    tagline: 'Daily check-ins without the meeting',
    description:
      'Posts a standup thread every weekday at the time you pick. Everyone answers yesterday, today and blockers in the thread.',
    commands: [
      {
        name: 'standup',
        description: 'Start a standup now, or schedule it daily',
        usage: 'daily 09:30 Asia/Seoul',
      },
    ],
    events: [],
  },
  {
    slug: 'quid-translate',
    name: 'Translate',
    tagline: 'Translate a message into any language',
    description:
      'Translate text with Google Cloud Translation: "/translate ko Good morning team". The translation is shown to you, or add "!" to post it to the channel.',
    commands: [
      {
        name: 'translate',
        description: 'Translate text (add ! to share it with the channel)',
        usage: 'ko Good morning team  (ko! posts it)',
      },
    ],
    events: [],
  },
  {
    slug: 'quid-world-clock',
    name: 'World Clock',
    tagline: 'See what time it is for everyone',
    description:
      'Show the local time in cities around the world with /time. Great for teams spread across time zones.',
    commands: [
      {
        name: 'time',
        description: 'Show the time in some cities',
        usage: 'Seoul London New York',
      },
    ],
    events: [],
  },
  {
    slug: 'quid-dice',
    name: 'Dice & Decide',
    tagline: 'Roll dice, flip coins, settle debates',
    description:
      'Fair, random picks for the whole channel: /roll 2d6, /flip, and /pick pizza, sushi, tacos.',
    commands: [
      { name: 'roll', description: 'Roll dice', usage: '2d6' },
      { name: 'flip', description: 'Flip a coin' },
      { name: 'pick', description: 'Pick one at random', usage: 'pizza, sushi, tacos' },
    ],
    events: [],
  },
]
