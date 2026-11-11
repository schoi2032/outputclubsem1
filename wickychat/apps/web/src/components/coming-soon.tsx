'use client'
import { Badge } from '@quid/ui'
import { Check } from 'lucide-react'
import { PageHeader } from './page-header'

/** Honest placeholder for products that are designed but not built yet. No fake controls. */
export function ComingSoon({
  title,
  icon,
  summary,
  features,
  note,
}: {
  title: string
  icon: React.ReactNode
  summary: string
  features: string[]
  note: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} icon={icon} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-6 py-14">
          <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-bg-subtle text-fg-muted [&_svg]:size-6">
            {icon}
          </span>
          <div className="mt-5 flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{title}</h2>
            <Badge tone="accent">Coming soon</Badge>
          </div>
          <p className="mt-2 text-[14px] text-fg-muted">{summary}</p>
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13px]">
                <Check className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-8 rounded-lg border border-border bg-bg-subtle p-3 text-xs text-fg-muted">
            {note}
          </p>
        </div>
      </div>
    </div>
  )
}
