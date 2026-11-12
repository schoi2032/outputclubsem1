'use client'
import { cn, toast } from '@quid/ui'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { LATEST_UPDATE } from '@/lib/changelog'
import { setOrgAccent, setPreferences } from '@/lib/preferences'
import { usePresence } from '@/lib/queries'
import { onNotification, useRealtime, viewing } from '@/lib/realtime'
import { playPack } from '@/lib/sounds'
import { CallProvider } from '../calls/call-provider'
import { Tour } from '../onboarding/tour'
import { OrgBanner } from '../org/org-banner'
import { useOrgContext } from '../org-context'
import { VoiceRoomProvider } from '../voice-rooms/voice-room-provider'
import { CommandPalette } from './command-palette'
import { MobileTabs } from './mobile-tabs'
import { Rail } from './rail'
import { Sidebar } from './sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { base, org, me } = useOrgContext()
  const router = useRouter()
  const presence = usePresence(org.id)
  const dnd = presence.data?.[me.id]?.status === 'dnd'
  const pathname = usePathname()
  const isHome = pathname === base
  const isChat = isHome || pathname.startsWith(`${base}/c/`)
  // A meeting gets the whole screen next to the rail.
  const inMeeting = /\/meet\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(pathname)
  const status = useRealtime((s) => s.status)

  useEffect(() => {
    document.title = `${org.name} · WickyChat`
  }, [org.name])

  const brandColor = org.customization.brandColor
  useEffect(() => {
    setOrgAccent(brandColor)
    return () => setOrgAccent(null)
  }, [brandColor])

  // Tell people about a new update once per device; the user menu keeps a "New" badge until they look.
  const lastSeenUpdate = me.preferences.lastSeenUpdate
  useEffect(() => {
    if (lastSeenUpdate === LATEST_UPDATE.id) return
    // Brand-new accounts have nothing to catch up on.
    if (!lastSeenUpdate && me.createdAt.slice(0, 10) >= LATEST_UPDATE.date) {
      setPreferences({ lastSeenUpdate: LATEST_UPDATE.id })
      return
    }
    const flag = 'quid-update-toasted'
    try {
      if (localStorage.getItem(flag) === LATEST_UPDATE.id) return
    } catch {}
    const t = setTimeout(() => {
      try {
        localStorage.setItem(flag, LATEST_UPDATE.id)
      } catch {}
      toast.info(`${LATEST_UPDATE.emoji} WickyChat just got an update`, {
        description: LATEST_UPDATE.title,
        action: { label: 'See what’s new', onClick: () => router.push(`${base}/whats-new`) },
      })
    }, 2500)
    return () => clearTimeout(t)
  }, [lastSeenUpdate, me.createdAt, base, router])

  const soundRef = useRef(me.soundPack)
  soundRef.current = me.soundPack
  // Surface mentions, DMs and replies as a toast unless you're looking at that conversation.
  useEffect(
    () =>
      onNotification(({ orgId, notification: n }) => {
        if (
          orgId !== org.id ||
          dnd ||
          (n.channelId &&
            n.channelId === viewing.channelId &&
            document.visibilityState === 'visible')
        )
          return
        // Calls have their own incoming-call card; activity is too noisy for toasts.
        if (n.kind === 'channel_activity' || n.kind === 'incoming_call') return
        playPack(soundRef.current, 'notify')
        const href = n.link
          ? n.link
          : n.channelId
            ? `${base}/c/${n.channelId}${n.threadId ? `?thread=${n.threadId}` : n.messageId ? `?m=${n.messageId}` : ''}`
            : `${base}/activity`
        toast.info(n.title, {
          description: n.preview.slice(0, 120),
          action: { label: 'Open', onClick: () => router.push(href) },
        })
      }),
    [org.id, base, dnd, router],
  )

  return (
    <CallProvider>
      <VoiceRoomProvider>
        <div className="q-still flex h-dvh flex-col overflow-hidden">
          {status === 'offline' && (
            <div
              role="status"
              className="flex h-7 shrink-0 items-center justify-center gap-2 bg-warning/15 text-xs font-medium text-warning"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-warning" /> Reconnecting…
              Messages will catch up automatically.
            </div>
          )}
          <OrgBanner orgId={org.id} banner={org.customization.banner} />
          <div className="flex min-h-0 flex-1">
            <Rail />
            {/* Sidebar: always on desktop for chat routes; full-screen "home" on mobile. */}
            <aside
              className={cn(
                'min-h-0 w-full shrink-0 flex-col border-r border-border bg-bg-subtle md:flex md:w-[264px]',
                isHome ? 'flex' : 'hidden',
                !isChat && 'md:hidden lg:flex',
                inMeeting && 'md:hidden lg:hidden',
              )}
            >
              <Sidebar />
            </aside>
            <main
              className={cn('min-w-0 flex-1 flex-col bg-bg', isHome ? 'hidden md:flex' : 'flex')}
            >
              {children}
            </main>
          </div>
          <MobileTabs />
        </div>
        <CommandPalette />
        {!inMeeting && <Tour />}
      </VoiceRoomProvider>
    </CallProvider>
  )
}
