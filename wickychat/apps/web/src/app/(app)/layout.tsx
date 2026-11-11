'use client'
import { Spinner } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ErrorScreen } from '@/components/error-screen'
import { applyAppTheme } from '@/lib/app-theme'
import { syncPreferences } from '@/lib/preferences'
import { useMe } from '@/lib/queries'
import { startRealtime, stopRealtime } from '@/lib/realtime'

/** Everything behind sign-in. Starts the realtime connection once the user is known. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const router = useRouter()
  const qc = useQueryClient()
  const userId = me.data?.user.id
  const serverPrefs = me.data?.user.preferences
  const appTheme = me.data === null ? null : me.data?.user.appTheme
  const themeKey = appTheme === undefined ? undefined : JSON.stringify(appTheme)

  useEffect(() => {
    if (serverPrefs) syncPreferences(qc, serverPrefs)
  }, [serverPrefs, qc])

  // Put on (or take off) the Shop theme once we know which one they have.
  useEffect(() => {
    if (themeKey !== undefined) applyAppTheme(JSON.parse(themeKey))
  }, [themeKey])

  useEffect(() => {
    if (me.data === null)
      router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
  }, [me.data, router])

  useEffect(() => {
    if (!userId) return
    startRealtime(qc, userId)
    return () => stopRealtime()
  }, [userId, qc])

  if (me.isError)
    return (
      <ErrorScreen
        emoji="🔌"
        title="We can’t reach WickyChat right now"
        description="We couldn’t load your account. Check your connection and give it another try."
        onRetry={() => me.refetch()}
      />
    )
  if (!me.data) {
    return (
      <div className="flex h-full items-center justify-center text-fg-subtle">
        <Spinner className="size-5" />
      </div>
    )
  }
  return <>{children}</>
}
