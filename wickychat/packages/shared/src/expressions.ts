/** Custom emoji and soundboard sounds: shared by everyone in an org. */
import { z } from 'zod'
import type { UserSummary } from './types'

export const MAX_EMOJI_BYTES = 512 * 1024
export const MAX_SOUND_BYTES = 1024 * 1024
export const MAX_CUSTOM_EMOJIS = 500
export const MAX_SOUNDBOARD_SOUNDS = 100
export const SOUND_AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/ogg'])

/** `party_parrot`, `+1`, `ship-it`: what goes between the colons. */
export const EMOJI_NAME = /^[a-z0-9_+-]{2,32}$/
/** A whole `:name:` token, as stored in reactions and typed in messages. */
export const CUSTOM_EMOJI_TOKEN = /^:([a-z0-9_+-]{2,32}):$/
/** Finds `:name:` tokens inside text. */
export const CUSTOM_EMOJI_IN_TEXT = /:([a-z0-9_+-]{2,32}):/g

export interface CustomEmoji {
  id: string
  name: string
  url: string
  animated: boolean
  createdBy: UserSummary | null
  createdAt: string
}

export interface SoundboardSound {
  id: string
  name: string
  emoji: string | null
  url: string
  volume: number
  createdBy: UserSummary | null
  createdAt: string
}

export const createEmojiSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(EMOJI_NAME, 'Use 2–32 lowercase letters, numbers, - _ or +'),
  fileId: z.uuid(),
})

export const createSoundSchema = z.object({
  name: z.string().trim().min(1, 'Name the sound').max(32),
  emoji: z.string().trim().max(16).nullish(),
  fileId: z.uuid(),
  volume: z.number().int().min(0).max(100).default(100),
})

export const updateSoundSchema = createSoundSchema.omit({ fileId: true }).partial()
