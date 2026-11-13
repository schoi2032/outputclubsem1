'use client'
import { specFromValue, typingText } from '@quid/shared'
import { TypingLine } from '@/components/profile/flair'
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
    <div className="flex h-5 items-center px-5 text-2xs text-fg-subtle" aria-live="polite">
      {text && <TypingLine spec={custom} text={text} />}
    </div>
  )
}
