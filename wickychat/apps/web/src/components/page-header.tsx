'use client'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useOrgContext } from './org-context'

export function PageHeader({
  title,
  icon,
  actions,
  children,
}: {
  title: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  const { base } = useOrgContext()
  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex h-12 items-center gap-2 px-3 md:px-6">
        <Link
          href={base}
          className="-ml-1 rounded-md p-1.5 text-fg-muted transition-colors duration-150 hover:bg-bg-muted md:hidden"
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </Link>
        {icon && <span className="text-fg-muted [&_svg]:size-4">{icon}</span>}
        <h1 className="q-squiggle text-[15px] font-semibold tracking-[-0.01em]">{title}</h1>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
      {children}
    </header>
  )
}
