'use client'
import type { Presence } from '@quid/shared'
import {
  Avatar,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import {
  BellOff,
  Circle,
  Gift,
  Keyboard,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Smile,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { errorMessage, post, put } from '@/lib/api'
import { LATEST_UPDATE } from '@/lib/changelog'
import { displayName } from '@/lib/format'
import { usePreference } from '@/lib/preferences'
import { usePresence } from '@/lib/queries'
import { useTheme } from '@/lib/theme'
import { StatusDialog } from '../dialogs/status-dialog'
import { useOrgContext } from '../org-context'
import { openCommandPalette } from './command-palette'

export function UserMenu({ side = 'right' }: { side?: 'right' | 'bottom' }) {
  const { me, org, base } = useOrgContext()
  const presence = usePresence(org.id)
  const mine = presence.data?.[me.id]
  const qc = useQueryClient()
  const [theme, setTheme] = useTheme()
  const [statusOpen, setStatusOpen] = useState(false)
  const hasNews = usePreference('lastSeenUpdate') !== LATEST_UPDATE.id

  const setPresence = async (body: Record<string, unknown>) => {
    try {
      const p = await put<Presence>('/api/me/presence', body)
      qc.setQueriesData<Record<string, Presence>>({ queryKey: ['presence'] }, (m) =>
        m ? { ...m, [me.id]: p } : m,
      )
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const dndUntil = (hours: number) =>
    setPresence({
      status: 'dnd',
      statusExpiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
    })

  return (
    <>
      <Menu>
        <MenuTrigger
          className="rounded-lg p-1 outline-none hover:bg-bg-emphasis"
          aria-label="Your account"
        >
          <Avatar
            name={me.name}
            id={me.id}
            src={me.avatarUrl}
            size="md"
            presence={mine?.status ?? 'active'}
            className="[--presence-ring:var(--q-bg-rail)]"
          />
        </MenuTrigger>
        <MenuContent side={side} align="end" className="w-64">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Avatar name={me.name} id={me.id} src={me.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName(me)}</p>
              <p className="truncate text-xs text-fg-subtle">{me.email}</p>
            </div>
          </div>
          <MenuItem icon={<Smile />} onSelect={() => setStatusOpen(true)}>
            {mine?.statusText ? (
              <span className="truncate">
                {mine.statusEmoji} {mine.statusText}
              </span>
            ) : (
              'Set a status'
            )}
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Availability</MenuLabel>
          <MenuItem
            icon={<Circle className="fill-success !text-success" />}
            onSelect={() => setPresence({ status: 'active' })}
          >
            Active
          </MenuItem>
          <MenuItem icon={<Circle />} onSelect={() => setPresence({ status: 'away' })}>
            Away
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger icon={<BellOff />}>Do not disturb</MenuSubTrigger>
            <MenuSubContent>
              <MenuItem onSelect={() => dndUntil(1)}>For 1 hour</MenuItem>
              <MenuItem onSelect={() => dndUntil(4)}>For 4 hours</MenuItem>
              <MenuItem
                onSelect={() => {
                  const t = new Date()
                  t.setDate(t.getDate() + 1)
                  t.setHours(9, 0, 0, 0)
                  void setPresence({ status: 'dnd', statusExpiresAt: t.toISOString() })
                }}
              >
                Until tomorrow 9:00
              </MenuItem>
              <MenuItem onSelect={() => setPresence({ status: 'dnd', statusExpiresAt: null })}>
                Until I turn it off
              </MenuItem>
            </MenuSubContent>
          </MenuSub>
          <MenuSeparator />
          <MenuItem icon={<UserRound />} asChild>
            <Link href={`${base}/settings/profile`}>Profile</Link>
          </MenuItem>
          <MenuItem icon={<Settings />} asChild>
            <Link href={`${base}/settings/preferences`}>Preferences</Link>
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger
              icon={theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />}
            >
              Theme
            </MenuSubTrigger>
            <MenuSubContent>
              {(['light', 'dark', 'system'] as const).map((t) => (
                <MenuItem
                  key={t}
                  onSelect={() => setTheme(t)}
                  shortcut={theme === t ? '✓' : undefined}
                >
                  {t[0]!.toUpperCase() + t.slice(1)}
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          <MenuItem icon={<Gift />} asChild>
            <Link href={`${base}/whats-new`}>
              What’s new
              {hasNews && (
                <span className="ml-auto rounded-full bg-accent px-1.5 py-px text-2xs font-semibold text-white">
                  New
                </span>
              )}
            </Link>
          </MenuItem>
          <MenuItem
            icon={<Sparkles />}
            onSelect={() => window.dispatchEvent(new Event('quid:tour'))}
          >
            Take the tour
          </MenuItem>
          <MenuItem icon={<Keyboard />} onSelect={openCommandPalette} shortcut="⌘K">
            Search and jump
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<LogOut />}
            onSelect={async () => {
              await post('/api/auth/logout').catch(() => {})
              qc.clear()
              window.location.href = '/login'
            }}
          >
            Sign out
          </MenuItem>
        </MenuContent>
      </Menu>
      <StatusDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        current={mine}
        onSave={setPresence}
      />
    </>
  )
}
