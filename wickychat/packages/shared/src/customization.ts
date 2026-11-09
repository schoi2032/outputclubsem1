/**
 * How an organization tailors WickyChat for its people: brand color, a banner,
 * a welcome for new members, status presets, profile fields and who can add
 * emoji and sounds. Stored in `organizations.settings.customization`.
 */
import { z } from 'zod'

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex color like #3b50d8')
const text = (min: number, max: number) => z.string().trim().min(min).max(max)

export const PROFILE_FIELD_KINDS = ['text', 'link', 'select'] as const
export type ProfileFieldKind = (typeof PROFILE_FIELD_KINDS)[number]

export const profileFieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{1,16}$/),
  label: text(1, 40),
  kind: z.enum(PROFILE_FIELD_KINDS),
  /** Choices for `select` fields. */
  options: z.array(text(1, 40)).max(20).default([]),
  hint: z.string().trim().max(80).default(''),
})
export type ProfileField = z.infer<typeof profileFieldSchema>

/** Clear-after choices for statuses: hours, 0 = never, -1 = end of today, -7 = end of the week. */
export const STATUS_DURATIONS = [
  { label: "Don't clear", hours: 0 },
  { label: '30 minutes', hours: 0.5 },
  { label: '1 hour', hours: 1 },
  { label: '2 hours', hours: 2 },
  { label: '4 hours', hours: 4 },
  { label: '8 hours', hours: 8 },
  { label: 'Today', hours: -1 },
  { label: 'This week', hours: -7 },
] as const

export const statusPresetSchema = z.object({
  emoji: text(1, 16),
  text: text(1, 100),
  hours: z.number().refine((h) => STATUS_DURATIONS.some((d) => d.hours === h), 'Invalid duration'),
})
export type StatusPreset = z.infer<typeof statusPresetSchema>

export const BANNER_TONES = ['info', 'success', 'warning'] as const

export const bannerInputSchema = z.object({
  text: text(1, 200),
  tone: z.enum(BANNER_TONES).default('info'),
  linkUrl: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullish()
    .or(z.literal('').transform(() => null)),
  linkLabel: z.string().trim().max(30).nullish(),
})
export type BannerInput = z.infer<typeof bannerInputSchema>
/** A published banner. `id` changes whenever it does, so people see it again. */
export type Banner = BannerInput & { id: string }

const customizationFields = {
  /** Default accent for members who haven't picked their own. */
  brandColor: hex.nullable(),
  /** Shown on Home to people who joined in the last 30 days. */
  welcomeMessage: z.string().trim().max(1000),
  /** Public channels new members join automatically (and can leave). */
  autoJoinChannelIds: z.array(z.uuid()).max(20),
  statusPresets: z.array(statusPresetSchema).max(12),
  /** Hide WickyChat's built-in status suggestions, showing only the org's. */
  replaceDefaultStatuses: z.boolean(),
  profileFields: z.array(profileFieldSchema).max(12),
  banner: z.object({ ...bannerInputSchema.shape, id: z.string().max(40) }).nullable(),
  /** Who can add custom emoji and soundboard sounds. */
  expressionsPolicy: z.enum(['members', 'admins']),
}

export type OrgCustomization = z.infer<z.ZodObject<typeof customizationFields>>

export const DEFAULT_CUSTOMIZATION: OrgCustomization = {
  brandColor: null,
  welcomeMessage: '',
  autoJoinChannelIds: [],
  statusPresets: [],
  replaceDefaultStatuses: false,
  profileFields: [],
  banner: null,
  expressionsPolicy: 'members',
}

/** PATCH body. The banner is published without an id; the server assigns one. */
export const updateCustomizationSchema = z
  .object({ ...customizationFields, banner: bannerInputSchema.nullable() })
  .partial()
  .strict()
  .refine(
    (c) =>
      !c.profileFields || new Set(c.profileFields.map((f) => f.id)).size === c.profileFields.length,
    'Profile field ids must be unique',
  )
export type CustomizationUpdate = z.infer<typeof updateCustomizationSchema>

/** Fills in defaults; invalid stored values are dropped. */
export function resolveCustomization(raw: unknown): OrgCustomization {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Record<string, unknown> = { ...DEFAULT_CUSTOMIZATION }
  for (const [key, schema] of Object.entries(customizationFields)) {
    const r = schema.safeParse(src[key])
    if (r.success) out[key] = r.data
  }
  return out as OrgCustomization
}

/** A member's answers to the org's profile fields, keyed by field id. */
export const profileValuesSchema = z.record(z.string().max(16), z.string().trim().max(200))

/**
 * Keeps only answers to fields that exist and fit them: links must be http(s)
 * and select answers must be one of the options. Empty answers are dropped.
 */
export function cleanProfileValues(
  fields: ProfileField[],
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = values[f.id]?.trim()
    if (!v) continue
    if (f.kind === 'select' && !f.options.includes(v)) continue
    if (f.kind === 'link' && !/^https?:\/\/\S+$/i.test(v)) continue
    out[f.id] = v
  }
  return out
}
