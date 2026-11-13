'use client'
import { specFromValue, typingText } from '@quid/shared'
import { TypingGlyphs } from '@/components/profile/flair'
import { displayName } from '@/lib/format'
import { useAiStatus, useMembers } from '@/lib/queries'
import { useTyping } from '@/lib/realtime'
import { useOrgContext } from '../org-context'

export function TypingIndicator({
  channelId,
  parentId = null,
}: {
  channelId: string
  parentId?: string | null
}) {
  const { org, me } = useOrgContext()
  const members = useMembers(org.id)
  const { assistant } = useAiStatus(org.id)
  const ids = useTyping(channelId, parentId).filter((id) => id !== me.id)
  const names = ids.map((id) => {
    const m = members.data?.find((x) => x.id === id)
    return m ? displayName(m).split(' ')[0] : id === assistant?.id ? 'Claude' : 'Someone'
  })
  const first = members.data?.find((x) => x.id === ids[0])
  const custom = specFromValue('typing', first?.typingStyle)
  const text =
    names.length === 0
      ? ''
      : names.length === 1
        ? typingText(names[0]!, custom)
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing`
          : 'Several people are typing'
  return (
    <div className="h-5 px-5 text-2xs text-fg-subtle" aria-live="polite">
      {text && (
        <span className="inline-flex items-center gap-1.5">
          {custom ? (
            <TypingGlyphs spec={custom} />
          ) : (
            <span className="inline-flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1 animate-bounce rounded-full bg-fg-subtle"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
          )}
          <span
            style={
              names.length === 1 && custom?.phraseColor ? { color: custom.phraseColor } : undefined
            }
          >
            {text}…
          </span>
        </span>
      )}
    </div>
  )
}
