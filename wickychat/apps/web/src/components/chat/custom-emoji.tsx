'use client'
import { CUSTOM_EMOJI_IN_TEXT, type CustomEmoji } from '@quid/shared'
import { cn } from '@quid/ui'
import { customEmojiFor, useEmojiMap } from '@/lib/expressions'

export function CustomEmojiImg({ emoji, className }: { emoji: CustomEmoji; className?: string }) {
  return (
    <img
      src={emoji.url}
      alt={`:${emoji.name}:`}
      title={`:${emoji.name}:`}
      draggable={false}
      loading="lazy"
      className={cn('q-emoji', className)}
    />
  )
}

/** A reaction or quick-reaction value: a Unicode emoji or a `:custom:` token. */
export function EmojiValue({ value, className }: { value: string; className?: string }) {
  const custom = customEmojiFor(value, useEmojiMap())
  return custom ? <CustomEmojiImg emoji={custom} className={className} /> : value
}

/** Replaces known `:name:` tokens in plain text with their images. */
export function emojify(text: string, map: Map<string, CustomEmoji>, key: string): React.ReactNode {
  if (!map.size || !text.includes(':')) return text
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(CUSTOM_EMOJI_IN_TEXT)) {
    const e = map.get(m[1]!)
    if (!e) continue
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<CustomEmojiImg key={`${key}-e${m.index}`} emoji={e} />)
    last = m.index + m[0].length
  }
  if (!out.length) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** True when the text is only emoji (Unicode or known custom), so it can be shown large. */
export function isEmojiOnly(text: string, map: Map<string, CustomEmoji>) {
  if (!text || text.length > 200) return false
  let customs = 0
  const rest = text.replace(CUSTOM_EMOJI_IN_TEXT, (all, name: string) => {
    if (!map.has(name)) return all
    customs++
    return ''
  })
  if (customs > 12) return false
  if (!rest.trim()) return customs > 0
  return (
    rest.length <= 40 &&
    /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍️\u{1f3fb}-\u{1f3ff}\s])+$/u.test(rest) &&
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(rest)
  )
}
