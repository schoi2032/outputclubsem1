'use client'
import { use } from 'react'
import { GuestMeeting } from '@/components/meet/guest-meeting'

/** Public guest link: people without a WickyChat account join a meeting here. */
export default function GuestJoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  return <GuestMeeting key={code} code={code} />
}
