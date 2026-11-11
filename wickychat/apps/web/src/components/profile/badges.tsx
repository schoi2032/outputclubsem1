'use client'
/** WickyChat: badges and daily streak on a profile card. Teachers can give badges here. */
import { BADGES, badgeById, MANUAL_BADGES, type ProfileStats } from '@quid/shared'
import { Menu, MenuContent, MenuItem, MenuTrigger, Tooltip, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, get, post } from '@/lib/api'

export function BadgesRow({ userId, canGive }: { userId: string; canGive?: boolean }) {
  const { org, api } = useOrgContext()
  const qc = useQueryClient()
  const key = ['stats', org.id, userId]
  const stats = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<ProfileStats>(`${api}/members/${userId}/stats`, signal),
    staleTime: 60_000,
  })
  const give = async (badge: string, remove: boolean) => {
    try {
      qc.setQueryData(
        key,
        await post<ProfileStats>(`${api}/members/${userId}/badges`, { badge, remove }),
      )
      toast.success(
        remove ? 'Badge taken back' : `Gave ${badgeById(badge)?.name} ${badgeById(badge)?.emoji}`,
      )
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const s = stats.data
  if (!s) return null
  const has = new Set(s.badges.map((b) => b.id))
  if (!s.badges.length && s.streak < 2 && !canGive) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {s.streak >= 2 && (
        <Tooltip content={`${s.streak}-day streak (best ${s.bestStreak})`}>
          <span className="rounded-md bg-[#ff7a1a]/15 px-1.5 py-0.5 text-2xs font-semibold text-[#d35f00]">
            🔥 {s.streak}
          </span>
        </Tooltip>
      )}
      {s.badges.map((b) => {
        const def = badgeById(b.id)
        if (!def) return null
        return (
          <Tooltip
            key={b.id}
            content={`${def.name}: ${b.note || def.how}${b.by ? ` (from ${b.by})` : ''}`}
          >
            <span
              className="flex size-6 items-center justify-center rounded-md bg-bg-muted text-[14px]"
              role="img"
              aria-label={def.name}
            >
              {def.emoji}
            </span>
          </Tooltip>
        )
      })}
      {canGive && (
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              title="Give a badge"
              aria-label="Give a badge"
              className="flex size-6 items-center justify-center rounded-md border border-dashed border-border-strong text-fg-subtle hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            {BADGES.filter((b) => MANUAL_BADGES.includes(b.id)).map((b) => (
              <MenuItem key={b.id} onSelect={() => void give(b.id, has.has(b.id))}>
                {b.emoji} {has.has(b.id) ? `Take back ${b.name}` : `Give ${b.name}`}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
    </div>
  )
}
