'use client'
import { Avatar, Count, cn, Tooltip } from '@quid/ui'
import {
  Bell,
  FolderOpen,
  Headphones,
  House,
  MessagesSquare,
  Search,
  Store,
  Video,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useChannels, useUnreadCount } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { UserMenu } from './user-menu'

export function useNavItems() {
  const { base, org } = useOrgContext()
  const unread = useUnreadCount(org.id)
  const channels = useChannels(org.id)
  const chatUnread = (channels.data ?? []).some(
    (c) =>
      c.membership &&
      !c.membership.muted &&
      (c.membership.unreadCount > 0 || c.membership.mentionCount > 0),
  )
  return [
    { href: `${base}/home`, label: 'Home', icon: House },
    {
      href: base,
      match: [`${base}/c/`, `${base}/browse`, `${base}/saved`, `${base}/drafts`, `${base}/people`],
      label: 'Chat',
      icon: MessagesSquare,
      dot: chatUnread,
    },
    { href: `${base}/voice`, label: 'Voice', icon: Headphones },
    { href: `${base}/meet`, label: 'Meet', icon: Video },
    { href: `${base}/activity`, label: 'Activity', icon: Bell, count: unread.data?.count ?? 0 },
    { href: `${base}/files`, label: 'Files', icon: FolderOpen },
    { href: `${base}/search`, label: 'Search', icon: Search },
    { href: `${base}/shop`, label: 'Shop', icon: Store },
  ]
}

export function Rail() {
  const { orgs, org } = useOrgContext()
  const pathname = usePathname()
  const items = useNavItems()
  const base = `/${org.slug}`

  return (
    <nav
      aria-label="Products"
      className="hidden w-[68px] shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-rail py-3 md:flex"
    >
      <div className="mb-2 flex flex-col items-center gap-2">
        {orgs.map((o) => (
          <Tooltip key={o.id} content={o.name} side="right">
            <Link
              href={`/${o.slug}/home`}
              aria-label={o.name}
              aria-current={o.id === org.id ? 'page' : undefined}
              className={cn(
                'rounded-[9px] p-[2px] transition-[opacity,box-shadow,scale] duration-150 ease-out active:scale-95',
                o.id === org.id ? 'ring-2 ring-fg' : 'opacity-70 hover:scale-105 hover:opacity-100',
              )}
            >
              <Avatar
                name={o.name}
                id={o.id}
                src={o.logoUrl}
                shape="square"
                size="md"
                className="[&>span]:rounded-[7px]"
              />
            </Link>
          </Tooltip>
        ))}
      </div>
      <div className="my-1 h-px w-8 bg-border" />
      {items.map((it) => {
        const active =
          pathname === it.href ||
          (it.match ?? []).some((m) => pathname.startsWith(m)) ||
          (it.href !== base && pathname.startsWith(it.href))
        return (
          <Link
            key={it.label}
            href={it.href}
            data-tour={`rail-${it.label.toLowerCase()}`}
            aria-current={active ? 'page' : undefined}
            className="group flex w-14 flex-col items-center gap-0.5 py-1"
          >
            <span
              className={cn(
                'relative flex size-9 items-center justify-center rounded-lg text-fg-muted transition-[background-color,color,scale] duration-150 ease-out group-hover:scale-105 group-hover:bg-bg-emphasis group-hover:text-fg group-active:scale-95',
                active && 'bg-bg-emphasis text-fg',
              )}
            >
              <it.icon className="size-[18px]" strokeWidth={active ? 2.2 : 1.8} />
              {it.count ? (
                <span className="absolute -top-1 -right-1.5">
                  <Count n={it.count} />
                </span>
              ) : it.dot ? (
                <span className="absolute top-1 right-1 size-2 rounded-full bg-accent ring-2 ring-bg-rail" />
              ) : null}
            </span>
            <span
              className={cn(
                'text-2xs font-medium text-fg-subtle transition-colors duration-150 group-hover:text-fg-muted',
                active && 'text-fg group-hover:text-fg',
              )}
            >
              {it.label}
            </span>
          </Link>
        )
      })}
      <div className="mt-auto" data-tour="user-menu">
        <UserMenu />
      </div>
    </nav>
  )
}
