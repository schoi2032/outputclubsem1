'use client'
import { cn } from '@quid/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useNavItems } from './rail'

/** Bottom navigation on small screens. */
export function MobileTabs() {
  const pathname = usePathname()
  const items = useNavItems().filter((i) =>
    ['Home', 'Chat', 'Activity', 'Search', 'Files'].includes(i.label),
  )
  return (
    <nav
      aria-label="Products"
      className="flex h-14 shrink-0 items-stretch border-t border-border bg-bg-subtle pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((it) => {
        const active =
          pathname === it.href ||
          (it.match ?? []).some((m) => pathname.startsWith(m)) ||
          (it.label !== 'Chat' && pathname.startsWith(it.href))
        return (
          <Link
            key={it.label}
            href={it.href}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-medium text-fg-subtle',
              active && 'text-fg',
            )}
          >
            <it.icon className="size-5" />
            {it.label}
            {(it.count || it.dot) && (
              <span className="absolute top-2 left-1/2 ml-2 size-2 rounded-full bg-accent" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
