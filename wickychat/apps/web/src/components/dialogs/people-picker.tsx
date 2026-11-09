'use client'
import type { Member } from '@quid/shared'
import { Avatar, cn } from '@quid/ui'
import { Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { displayName } from '@/lib/format'
import { useMembers } from '@/lib/queries'
import { useOrgContext } from '../org-context'

/** Searchable multi-select of organization members. */
export function PeoplePicker({
  value,
  onChange,
  exclude = [],
  autoFocus,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  exclude?: string[]
  autoFocus?: boolean
}) {
  const { org } = useOrgContext()
  const members = useMembers(org.id)
  const [q, setQ] = useState('')
  const byId = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m])), [members.data])
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (members.data ?? [])
      .filter((m) => !exclude.includes(m.id))
      .filter(
        (m) =>
          !needle ||
          m.name.toLowerCase().includes(needle) ||
          (m.displayName ?? '').toLowerCase().includes(needle) ||
          m.email.toLowerCase().includes(needle),
      )
      .slice(0, 50)
  }, [members.data, q, exclude])

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-1 border-b border-border p-1.5">
        {value.map((id) => {
          const m = byId.get(id)
          return (
            <span
              key={id}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-accent-subtle pr-1 pl-1.5 text-xs font-medium text-accent-text"
            >
              {m ? displayName(m) : '…'}
              <button
                type="button"
                aria-label="Remove"
                onClick={() => toggle(id)}
                className="rounded hover:bg-accent/15"
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          className="h-6 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-fg-subtle"
          placeholder={value.length ? '' : 'Search by name or email'}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) {
              e.preventDefault()
              toggle(results[0].id)
              setQ('')
            }
            if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1))
          }}
        />
      </div>
      <ul className="max-h-60 overflow-y-auto p-1">
        {members.isLoading && (
          <li className="px-2 py-3 text-[13px] text-fg-subtle">Loading people…</li>
        )}
        {!members.isLoading && results.length === 0 && (
          <li className="px-2 py-3 text-[13px] text-fg-subtle">No one matches "{q}".</li>
        )}
        {results.map((m: Member) => {
          const selected = value.includes(m.id)
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(m.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-bg-muted',
                  selected && 'bg-bg-muted',
                )}
              >
                <Avatar name={m.name} id={m.id} src={m.avatarUrl} size="sm" presence={m.presence} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{displayName(m)}</span>
                  <span className="block truncate text-xs text-fg-subtle">
                    {m.title || m.email}
                  </span>
                </span>
                {selected && <Check className="size-4 text-accent" />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
