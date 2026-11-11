/**
 * Personal preferences: how WickyChat looks and behaves for one person. Stored on
 * the account so they follow you across devices, and mirrored to localStorage
 * so the first paint already uses them.
 */
import { z } from 'zod'

// The first preset is the default; its color must match --q-accent in packages/ui/src/styles.css.
export const ACCENT_PRESETS = [
  { id: 'terracotta', label: 'Terracotta', color: '#b8492f' },
  { id: 'sage', label: 'Sage', color: '#4f7d5f' },
  { id: 'cobalt', label: 'Cobalt', color: '#3b50d8' },
  { id: 'violet', label: 'Violet', color: '#7a4ddb' },
  { id: 'pink', label: 'Pink', color: '#d0407f' },
  { id: 'red', label: 'Red', color: '#d03a3a' },
  { id: 'orange', label: 'Orange', color: '#df6a1c' },
  { id: 'amber', label: 'Amber', color: '#b7860b' },
  { id: 'green', label: 'Green', color: '#1d9a57' },
  { id: 'teal', label: 'Teal', color: '#0f8f8f' },
  { id: 'sky', label: 'Sky', color: '#1f86c9' },
  { id: 'graphite', label: 'Graphite', color: '#55555f' },
] as const

export const DEFAULT_ACCENT: string = ACCENT_PRESETS[0].color

const preferenceFields = {
  // Appearance
  theme: z.enum(['light', 'dark', 'system']),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex color like #b8492f'),
  contrast: z.enum(['normal', 'high']),
  font: z.enum(['geist', 'system', 'serif', 'mono']),
  textSize: z.enum(['sm', 'md', 'lg', 'xl']),
  radius: z.enum(['square', 'default', 'round']),
  motion: z.enum(['system', 'reduced', 'full']),
  // Messages
  density: z.enum(['comfortable', 'compact']),
  avatars: z.boolean(),
  groupMessages: z.boolean(),
  clock: z.enum(['auto', '12h', '24h']),
  jumboEmoji: z.boolean(),
  quickReactions: z.array(z.string().min(1).max(40)).length(3),
  animateAvatars: z.enum(['hover', 'always', 'never']),
  // Composer
  sendKey: z.enum(['enter', 'mod-enter']),
  spellcheck: z.boolean(),
  // Sidebar
  sidebarSort: z.enum(['alpha', 'recent']),
  sidebarUnreadOnly: z.boolean(),
  sidebarHideMuted: z.boolean(),
  sidebarShortcuts: z.boolean(),
  // Voice
  soundboard: z.boolean(),
  soundboardVolume: z.number().int().min(0).max(100),
  /** Newest update-log entry the person has seen. */
  lastSeenUpdate: z.string().max(40),
}

export type Preferences = z.infer<z.ZodObject<typeof preferenceFields>>

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  accent: DEFAULT_ACCENT,
  contrast: 'normal',
  font: 'geist',
  textSize: 'md',
  radius: 'default',
  motion: 'system',
  density: 'comfortable',
  avatars: true,
  groupMessages: true,
  clock: 'auto',
  jumboEmoji: true,
  quickReactions: ['👍', '❤️', '😂'],
  animateAvatars: 'hover',
  sendKey: 'enter',
  spellcheck: true,
  sidebarSort: 'alpha',
  sidebarUnreadOnly: false,
  sidebarHideMuted: false,
  sidebarShortcuts: true,
  soundboard: true,
  soundboardVolume: 70,
  lastSeenUpdate: '',
}

/** PATCH body: any subset, strictly validated. */
export const updatePreferencesSchema = z.object(preferenceFields).partial().strict()
export type PreferencesUpdate = z.infer<typeof updatePreferencesSchema>

/** Fills in defaults; unknown keys and invalid stored values are dropped. */
export function resolvePreferences(raw: unknown): Preferences {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Record<string, unknown> = { ...DEFAULT_PREFERENCES }
  for (const [key, schema] of Object.entries(preferenceFields)) {
    const r = schema.safeParse(src[key])
    if (r.success) out[key] = r.data
  }
  return out as Preferences
}
