'use client'
import { setLiveDecoration } from '@quid/ui'
import { useEffect } from 'react'
import { useOrgContext } from '@/components/org-context'
import { useLiveCode } from '@/lib/flair-css'
import { LiveFrame, LiveLayer, liveOn } from './live-layer'

export function LiveMount() {
  const { me } = useOrgContext()
  useEffect(() => {
    setLiveDecoration((v) => <LiveDecoration value={v} />)
    return () => setLiveDecoration(null)
  }, [])
  const theme = useLiveCode('theme', me.appTheme?.id)
  if (!theme || !liveOn()) return null
  return (
    <div className="q-live-app" aria-hidden="true">
      <LiveFrame code={theme} kind="theme" />
    </div>
  )
}

function LiveDecoration({ value }: { value: string }) {
  return <LiveLayer kind="decoration" value={value} front pad={0} />
}
