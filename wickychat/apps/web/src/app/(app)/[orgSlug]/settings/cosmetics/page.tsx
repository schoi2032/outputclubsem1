'use client'
/**
 * WickyChat: teachers review student-made cosmetics before they go on sale, and can take
 * approved ones down again.
 */
import type { Cosmetic } from '@quid/shared'
import { Avatar, Button, EmptyState, Input, Skeleton, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Palette } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { NamePlate } from '@/components/profile/cosmetics-fx'
import { SettingsTitle } from '@/components/settings-ui'
import { ThemeSwatch } from '@/components/shop/theme-swatch'
import { errorMessage, get, post } from '@/lib/api'
import { displayName, relative } from '@/lib/format'

function Row({ c, onDone, live }: { c: Cosmetic; onDone: () => void; live?: boolean }) {
  const { api } = useOrgContext()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const review = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'reject')
    try {
      await post(`${api}/cosmetics/${c.id}/review`, { approve, note: note || undefined })
      toast.success(
        approve ? `${c.name} is on sale` : `${c.name} was ${live ? 'taken down' : 'rejected'}`,
      )
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <li className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="flex shrink-0 gap-6 px-3">
        {c.kind === 'theme' ? (
          <ThemeSwatch css={c.css ?? ''} className="w-28" />
        ) : c.kind === 'effect' || c.kind === 'plate' ? (
          <span className="relative isolate block h-20 w-28 overflow-hidden rounded-md bg-bg-muted">
            <NamePlate value={c.value} />
          </span>
        ) : (
          <Avatar name={c.creator.name} id={c.creator.id} decoration={c.decoration} size="xl" />
        )}
        <div className="flex flex-col justify-center gap-2">
          {c.frameUrl && (
            <a
              href={c.frameUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent-text underline"
            >
              Frame image
            </a>
          )}
          {c.stickerUrl && (
            <a
              href={c.stickerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent-text underline"
            >
              Sticker image
            </a>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-semibold">
          {c.name} <span className="font-normal text-fg-subtle">· 🪙 {c.price}</span>
        </p>
        {c.description && <p className="text-fg-muted">{c.description}</p>}
        <p className="mt-0.5 text-xs text-fg-subtle">
          by {displayName(c.creator)} · {relative(c.createdAt)}
          {live && ` · ${c.sales} sold`}
        </p>
        {c.kind === 'theme' && c.css && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-accent-text">
              Theme CSS ({c.css.length.toLocaleString()} characters)
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-bg-muted p-2 font-mono text-2xs whitespace-pre-wrap">
              {c.css}
            </pre>
          </details>
        )}
        <Input
          className="mt-2"
          placeholder="Note to the student (optional)"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="flex shrink-0 gap-2">
        {!live && (
          <Button variant="primary" loading={busy === 'approve'} onClick={() => review(true)}>
            Approve
          </Button>
        )}
        <Button variant="danger-ghost" loading={busy === 'reject'} onClick={() => review(false)}>
          {live ? 'Take down' : 'Reject'}
        </Button>
      </div>
    </li>
  )
}

export default function CosmeticsReview() {
  const { org, api } = useOrgContext()
  const qc = useQueryClient()
  const pending = useQuery({
    queryKey: ['cosmetics', org.id, 'review'],
    queryFn: ({ signal }) => get<Cosmetic[]>(`${api}/cosmetics?view=review`, signal),
  })
  const live = useQuery({
    queryKey: ['cosmetics', org.id, 'shop'],
    queryFn: ({ signal }) => get<Cosmetic[]>(`${api}/cosmetics?view=shop`, signal),
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })

  return (
    <>
      <SettingsTitle
        title="Cosmetics review"
        description="Students can make their own avatar decorations and app themes (CSS) and sell them for Wicky Coins. Check each one is appropriate and is their own art (nothing copied from Discord, games or other apps) before approving."
      />
      <h2 className="mb-2 text-[15px] font-semibold">Waiting for review</h2>
      {pending.isLoading ? (
        <Skeleton className="h-40" />
      ) : !pending.data?.length ? (
        <EmptyState
          icon={<Palette />}
          title="Nothing to review"
          description="New submissions show up here."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {pending.data.map((c) => (
            <Row key={c.id} c={c} onDone={refresh} />
          ))}
        </ul>
      )}
      {!!live.data?.length && (
        <>
          <h2 className="mt-8 mb-2 text-[15px] font-semibold">On sale now</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {live.data.map((c) => (
              <Row key={c.id} c={c} onDone={refresh} live />
            ))}
          </ul>
        </>
      )}
    </>
  )
}
