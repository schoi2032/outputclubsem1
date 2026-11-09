'use client'
import { use } from 'react'
import { MeetingRoom } from '@/components/meet/meeting-room'

export default function MeetingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  return <MeetingRoom key={code} code={code} />
}
