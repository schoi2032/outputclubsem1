'use client'
import {
  Button,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  Tooltip,
} from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, X } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { errorMessage, post } from '@/lib/api'
import { useOrgContext } from '../org-context'

export type SummaryRequest = {
  channelId: string
  threadId?: string
  afterMessageId?: string
  hours?: number
  /** Shown in the card header, e.g. "12 new messages" or "Last 24 hours". */
  label: string
}

type SummaryResult = { summary: string | null; messageCount: number }

/** Claude's catch-up summary for a channel or thread, shown above the conversation. */
export function CatchUpCard({
  request,
  onClose,
}: {
  request: SummaryRequest
  onClose: () => void
}) {
  const { org, api } = useOrgContext()
  const { label, ...body } = request
  const q = useQuery({
    queryKey: ['ai-summary', org.id, body],
    queryFn: () => post<SummaryResult>(`${api}/ai/summarize`, body),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    retry: false,
  })

  return (
    <section
      className="mx-3 mt-3 flex max-h-[45vh] shrink-0 animate-in flex-col rounded-xl border border-border bg-bg-subtle md:mx-5"
      aria-label="Catch-up summary"
    >
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Sparkles className="size-4 text-accent" />
        <h2 className="text-[13px] font-semibold">Catch up</h2>
        <span className="truncate text-xs text-fg-subtle">
          {label}
          {q.data?.messageCount ? ` · ${q.data.messageCount} messages` : ''}
        </span>
        <IconButton label="Close summary" className="ml-auto" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="min-h-0 overflow-y-auto px-4 pb-4" aria-live="polite" aria-busy={q.isLoading}>
        {q.isLoading ? (
          <div className="space-y-2 pt-1" role="status" aria-label="Summarizing">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5" />
            <Skeleton className="h-3.5 w-1/2" />
            <p className="pt-1 text-xs text-fg-subtle">Claude is reading the conversation…</p>
          </div>
        ) : q.isError ? (
          <div className="flex items-center gap-3 text-[13px] text-fg-muted">
            {errorMessage(q.error)}
            <Button size="sm" onClick={() => q.refetch()}>
              Try again
            </Button>
          </div>
        ) : q.data?.summary ? (
          <AiText text={q.data.summary} />
        ) : (
          <p className="text-[13px] text-fg-muted">Nothing new to summarize.</p>
        )}
        {q.data?.summary && (
          <p className="mt-3 text-2xs text-fg-subtle">
            Written by Claude from messages you can read. Check anything important.
          </p>
        )}
      </div>
    </section>
  )
}

/** Header button: summarize a recent window of the channel. */
export function SummarizeMenu({ onPick }: { onPick: (hours: number, label: string) => void }) {
  return (
    <Menu>
      <Tooltip content="Catch up with Claude">
        <MenuTrigger asChild>
          <IconButton label="Catch up with Claude">
            <Sparkles />
          </IconButton>
        </MenuTrigger>
      </Tooltip>
      <MenuContent align="end">
        <MenuItem onSelect={() => onPick(24, 'Last 24 hours')}>
          Summarize the last 24 hours
        </MenuItem>
        <MenuItem onSelect={() => onPick(24 * 3, 'Last 3 days')}>
          Summarize the last 3 days
        </MenuItem>
        <MenuItem onSelect={() => onPick(24 * 7, 'Last 7 days')}>Summarize the last week</MenuItem>
      </MenuContent>
    </Menu>
  )
}

/**
 * Renders the small Markdown subset summaries use (paragraphs, bullets, bold,
 * inline code) as React elements, so model output is never parsed as HTML.
 */
export function AiText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (!list.length) return
    blocks.push(
      <ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-5">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    )
    list = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const bullet = /^[-*•]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line)
    if (bullet) {
      list.push(bullet[1]!)
      continue
    }
    flush()
    if (!line) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    blocks.push(
      <p key={blocks.length} className={heading ? 'mt-2 font-semibold' : 'my-1'}>
        {inline(heading ? heading[1]! : line)}
      </p>,
    )
  }
  flush()
  return <div className="text-[13px] leading-relaxed text-fg">{blocks}</div>
}

function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <code key={i} className="rounded bg-bg-muted px-1 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      )
    return <Fragment key={i}>{part}</Fragment>
  })
}
