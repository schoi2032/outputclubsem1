/**
 * The update log, newest first. Add an entry when you ship something people
 * will notice; its `id` must be new, since signed-in people are told about any
 * entry newer than the last one they saw.
 */
export interface Update {
  id: string
  date: string
  title: string
  emoji: string
  summary: string
  items: string[]
  tag?: 'new' | 'improved' | 'fixed'
}

export const UPDATES: Update[] = [
  {
    id: '2026-11-03-wickychat',
    date: '2026-11-03',
    emoji: '🪁',
    title: 'Welcome to WickyChat',
    summary: 'The school chat for Chadwick International, made by Output Club.',
    tag: 'new',
    items: [
      'Sign in with your @chadwickschool.org account. Everyone is in one organization, Chadwick International.',
      'Swear words are filtered out of every message automatically.',
      'Channels, DMs, group chats, threads, reactions, files, voice rooms, calls and meetings.',
      'Free for everyone. No plans, no payments.',
    ],
  },
  {
    id: '2026-10-16-customization',
    date: '2026-10-16',
    emoji: '🎨',
    title: 'Make WickyChat your company’s own',
    summary: 'A new Customization page for workspace admins.',
    tag: 'new',
    items: [
      'Brand color: pick your company color and WickyChat uses it for everyone who hasn’t chosen their own accent.',
      'Announcement banner: put a message (and a link) across the top of WickyChat for the whole workspace.',
      'Welcome new members with a note on their Home page, and choose channels they join automatically.',
      'Status presets: one-click statuses for your team, like “In the office” or “On call”.',
      'Profile fields: add pronouns, office, team, a portfolio link or anything else to everyone’s profile.',
      'Choose who can add custom emoji and soundboard sounds.',
    ],
  },
  {
    id: '2026-10-16-expressions',
    date: '2026-10-16',
    emoji: '🎉',
    title: 'Custom emoji, soundboards and animated profile photos',
    summary: 'Make your workspace feel like yours.',
    tag: 'new',
    items: [
      'Custom emoji: add your own images and GIFs in Settings → Emoji & sounds, then use them as :name: in messages and reactions.',
      'Type : and a couple of letters in the composer to find any emoji, custom ones included.',
      'Soundboard in voice rooms: play an airhorn, applause, a drumroll and more for everyone in the room, or upload your own short clips.',
      'Animated profile photos: upload a GIF or animated WebP; it plays when someone hovers your messages. Choose hover, always or never in Preferences.',
      'Custom emoji can be quick reactions too.',
      'This update log, so you never miss what’s new.',
    ],
  },
  {
    id: '2026-10-15-warmer',
    date: '2026-10-15',
    emoji: '🧡',
    title: 'A warmer WickyChat, and preferences that follow you',
    summary: 'A new look, the WickyChat crew, and settings synced across devices.',
    tag: 'improved',
    items: [
      'Cream neutrals, a terracotta accent, friendlier empty states and gentle motion.',
      'Meet the WickyChat crew: Bubble, Sprout and Pebble.',
      'Appearance & preferences: theme, accent color, font, text size, density, clock, quick reactions, send key and sidebar options, saved to your account.',
      'Messages re-render less, so long channels scroll more smoothly.',
      'A desktop app for macOS, Windows and Linux is on the way.',
    ],
  },
  {
    id: '2026-10-09-whiteboards',
    date: '2026-10-09',
    emoji: '🖍️',
    title: 'Whiteboards',
    summary: 'Draw together, live.',
    tag: 'new',
    items: [
      'Collaborative whiteboards inside Canvases, with live cursors.',
      'Sticky notes, a chart builder and templates to get started fast.',
    ],
  },
  {
    id: '2026-10-08-productivity',
    date: '2026-10-08',
    emoji: '✅',
    title: 'Canvases, tasks, reminders and workflows',
    summary: 'Get work done without leaving the conversation.',
    tag: 'new',
    items: [
      'Canvases: shared docs pinned to a channel.',
      'Tasks with assignees and due dates, plus /todo.',
      'Reminders with /remind, collected in Later.',
      'The Workflow Builder for simple automations.',
    ],
  },
  {
    id: '2026-10-07-plugins',
    date: '2026-10-07',
    emoji: '🧩',
    title: 'Plugins, ⌘K and a welcome tour',
    summary: 'Extend WickyChat and find anything fast.',
    tag: 'new',
    items: [
      'A plugin directory with verified, community and private plugins, safety checks and slash commands.',
      'Official plugins: Polls, Reminders, Standup, Translate, World Clock and Dice & Decide.',
      '⌘K to search and jump anywhere.',
      'A welcome tour and a getting-started checklist.',
      'Enterprise+: message retention, audit export and required Google sign-in.',
    ],
  },
  {
    id: '2026-10-05-launch',
    date: '2026-10-05',
    emoji: '🚀',
    title: 'Hello, WickyChat',
    summary: 'Chat, calls, meetings and voice rooms in one place.',
    tag: 'new',
    items: [
      'Channels, DMs, threads, reactions, files and search, all in real time.',
      'Voice calls, WickyChat Meet with screen sharing and live captions, and drop-in voice rooms.',
      'Meeting guest links, calendar invites and saved transcripts.',
      'Connect Claude and other AI apps to WickyChat over MCP.',
      'Sign in with Google.',
    ],
  },
]

export const LATEST_UPDATE = UPDATES[0]!
