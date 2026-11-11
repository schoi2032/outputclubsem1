'use client'
import { can } from '@quid/shared'
import { cn } from '@quid/ui'
import {
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  Building2,
  KeyRound,
  Paintbrush,
  Palette,
  Plug,
  Puzzle,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smile,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { base, org, me } = useOrgContext()
  const pathname = usePathname()
  const admin = org.role === 'owner' || org.role === 'admin'
  const sections = [
    {
      title: 'Account',
      items: [
        { href: 'profile', label: 'Profile & security', icon: UserRound },
        { href: 'preferences', label: 'Appearance & preferences', icon: Palette },
        { href: 'notifications', label: 'Notifications', icon: Bell },
        { href: 'connected-apps', label: 'Connected apps', icon: Plug },
      ],
    },
    {
      title: org.name,
      items: [
        ...(admin ? [{ href: 'dashboard', label: 'Dashboard', icon: BarChart3 }] : []),
        ...(admin ? [{ href: 'org', label: 'General', icon: Settings }] : []),
        ...(admin ? [{ href: 'customization', label: 'Customization', icon: Paintbrush }] : []),
        ...(admin ? [{ href: 'compliance', label: 'Compliance', icon: ShieldCheck }] : []),
        ...(can(org.role, 'members.invite_guest')
          ? [{ href: 'members', label: 'Members', icon: Users }]
          : []),
        ...(org.role !== 'guest'
          ? [{ href: 'expressions', label: 'Emoji & sounds', icon: Smile }]
          : []),
        ...(org.role !== 'guest'
          ? [{ href: 'structure', label: 'Departments & teams', icon: Building2 }]
          : []),
        ...(admin ? [{ href: 'integrations', label: 'Integrations', icon: Bot }] : []),
        ...(admin ? [{ href: 'plugins', label: 'Plugins', icon: Puzzle }] : []),
        ...(admin ? [{ href: 'ai', label: 'AI providers', icon: Sparkles }] : []),
        ...(admin ? [{ href: 'moderation', label: 'Rule breakers', icon: ShieldAlert }] : []),
        ...(admin ? [{ href: 'cosmetics', label: 'Cosmetics review', icon: Palette }] : []),
        ...(admin ? [{ href: 'audit', label: 'Audit log', icon: ScrollText }] : []),
      ],
    },
  ]
  if (me.platformAdmin)
    sections.push({
      title: 'WickyChat team',
      items: [{ href: 'plugin-review', label: 'Plugin review', icon: BadgeCheck }],
    })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" icon={<KeyRound />} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          className="shrink-0 overflow-x-auto border-b border-border p-2 md:w-60 md:overflow-y-auto md:border-r md:border-b-0 md:p-3"
          aria-label="Settings"
        >
          <div className="flex gap-1 md:flex-col md:gap-0">
            {sections.map((s) =>
              s.items.length ? (
                <div key={s.title} className="flex gap-1 md:mb-4 md:flex-col md:gap-px">
                  <p className="hidden truncate px-2 pb-1 text-2xs font-medium text-fg-subtle uppercase md:block">
                    {s.title}
                  </p>
                  {s.items.map((it) => {
                    const href = `${base}/settings/${it.href}`
                    const active = pathname === href
                    return (
                      <Link
                        key={it.href}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted hover:bg-bg-muted',
                          active && 'bg-bg-emphasis text-fg',
                        )}
                      >
                        <it.icon className="size-4" />
                        {it.label}
                      </Link>
                    )
                  })}
                </div>
              ) : null,
            )}
          </div>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-4 md:p-8">{children}</div>
        </div>
      </div>
    </div>
  )
}
