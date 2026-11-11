'use client'
import type { Banner } from '@quid/shared'
import { cn } from '@quid/ui'
import { ExternalLink, Megaphone, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const TONE = {
  info: 'bg-accent-subtle text-accent-text',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
} as const

const key = (orgId: string) => `quid-banner-dismissed:${orgId}`

/** The workspace's announcement banner. Dismissing hides this version on this device. */
export function OrgBanner({
  orgId,
  banner,
  preview,
}: {
  orgId: string
  banner: Banner | null
  /** Settings preview: always shown, not dismissible. */
  preview?: boolean
}) {
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(key(orgId)))
    } catch {}
  }, [orgId])
  if (!banner || (!preview && dismissed === banner.id)) return null
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-9 shrink-0 items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium',
        TONE[banner.tone],
        preview && 'rounded-lg',
      )}
    >
      <Megaphone className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        {banner.text}
        {banner.linkUrl && (
          <a
            href={banner.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 inline-flex items-center gap-1 underline underline-offset-2"
          >
            {banner.linkLabel || 'Learn more'}
            <ExternalLink className="size-3" />
          </a>
        )}
      </p>
      {!preview && (
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={() => {
            setDismissed(banner.id)
            try {
              localStorage.setItem(key(orgId), banner.id)
            } catch {}
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
