'use client'
/** Custom emoji and soundboard sounds for the current org. */
import { CUSTOM_EMOJI_TOKEN, type CustomEmoji, type SoundboardSound } from '@quid/shared'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useOrgContext } from '@/components/org-context'
import { get } from './api'

export const expressionKeys = {
  emojis: (orgId: string) => ['emojis', orgId] as const,
  sounds: (orgId: string) => ['sounds', orgId] as const,
}

export function useCustomEmojis() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: expressionKeys.emojis(org.id),
    queryFn: ({ signal }) => get<CustomEmoji[]>(`${api}/emojis`, signal),
    staleTime: 5 * 60_000,
  })
}

/** name → emoji, for rendering `:name:` tokens. */
export function useEmojiMap(): Map<string, CustomEmoji> {
  const { data } = useCustomEmojis()
  return useMemo(() => new Map((data ?? []).map((e) => [e.name, e])), [data])
}

export function useSounds() {
  const { org, api } = useOrgContext()
  return useQuery({
    queryKey: expressionKeys.sounds(org.id),
    queryFn: ({ signal }) => get<SoundboardSound[]>(`${api}/sounds`, signal),
    staleTime: 5 * 60_000,
  })
}

/** The custom emoji a reaction or token refers to, if any. */
export function customEmojiFor(value: string, map: Map<string, CustomEmoji>) {
  const m = CUSTOM_EMOJI_TOKEN.exec(value)
  return m ? map.get(m[1]!) : undefined
}
