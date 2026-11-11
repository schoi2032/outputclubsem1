'use client'
import { Badge } from '@quid/ui'
import { BadgeCheck, Puzzle } from 'lucide-react'

export type PluginCheck = {
  id: string
  label: string
  status: 'passed' | 'failed' | 'skipped'
  detail?: string
}
export type Plugin = {
  id: string
  name: string
  tagline: string
  description: string
  developerName: string
  homepageUrl: string | null
  iconUrl: string | null
  status: 'pending' | 'unverified' | 'verified' | 'suspended' | 'rejected'
  official: boolean
  private: boolean
  commands: { name: string; description: string; usage?: string }[]
  events: string[]
  install: { id: string; channelIds: string[] } | null
  checks?: PluginCheck[]
  reviewNote?: string | null
}

export function PluginIcon({
  p,
  size = 40,
}: {
  p: Pick<Plugin, 'iconUrl' | 'name'>
  size?: number
}) {
  return p.iconUrl ? (
    // biome-ignore lint/performance/noImgElement: icons are small, already-checked images served by the API
    <img
      src={p.iconUrl}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 self-start rounded-lg border border-border object-cover"
    />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center self-start rounded-lg bg-bg-muted text-fg-subtle"
    >
      <Puzzle className="size-1/2" />
    </span>
  )
}

export function StatusBadge({ p }: { p: Pick<Plugin, 'status' | 'private' | 'official'> }) {
  if (p.private) return <Badge>Private</Badge>
  if (p.official && p.status === 'verified')
    return (
      <Badge tone="accent">
        <BadgeCheck className="mr-0.5 inline size-3" />
        Official
      </Badge>
    )
  if (p.status === 'verified')
    return (
      <Badge tone="success">
        <BadgeCheck className="mr-0.5 inline size-3" />
        Verified
      </Badge>
    )
  if (p.status === 'unverified') return <Badge tone="warning">Unverified</Badge>
  if (p.status === 'pending') return <Badge>Checks failing</Badge>
  return <Badge tone="danger">{p.status === 'suspended' ? 'Suspended' : 'Rejected'}</Badge>
}
