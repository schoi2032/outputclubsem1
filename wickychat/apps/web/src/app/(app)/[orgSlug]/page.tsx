'use client'
import { Button, EmptyState, Spinner } from '@quid/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useOrgContext } from '@/components/org-context'
import { useChannels } from '@/lib/queries'

export default function OrgHome() {
  const { org, base } = useOrgContext()
  const channels = useChannels(org.id)
  const router = useRouter()
  const target = channels.data
    ? (channels.data.find((c) => c.name === 'general' && c.kind === 'public') ??
      channels.data.find((c) => !c.archivedAt))
    : undefined

  useEffect(() => {
    if (target && window.matchMedia('(min-width: 768px)').matches)
      router.replace(`${base}/c/${target.id}`)
  }, [target, base, router])

  if (channels.data && !target) {
    return (
      <EmptyState
        className="h-full"
        emoji="👋"
        title="It’s quiet in here…"
        description={
          org.role === 'guest'
            ? 'Once someone adds you to a channel, the chatter will show up here.'
            : 'Kick things off with a new channel or a direct message.'
        }
        action={
          org.role !== 'guest' ? (
            <Button asChild variant="primary">
              <Link href={`${base}/browse`}>Browse channels</Link>
            </Button>
          ) : undefined
        }
      />
    )
  }
  return (
    <div className="hidden h-full items-center justify-center text-fg-subtle md:flex">
      <Spinner className="size-5" />
    </div>
  )
}
