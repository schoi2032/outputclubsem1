'use client'
import { Suspense, use } from 'react'
import { ChannelView } from '@/components/chat/channel-view'

export default function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = use(params)
  return (
    <Suspense>
      <ChannelView key={channelId} channelId={channelId} />
    </Suspense>
  )
}
