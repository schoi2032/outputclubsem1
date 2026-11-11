'use client'
/**
 * WickyChat: Discord-style profile card. Click someone's name or picture to see their banner,
 * decoration, pronouns, bio and role, and to message them (or, for teachers, reward them).
 */
import type { Channel, Member, UserSummary } from '@quid/shared'
import { decorationById, ROLE_LABEL } from '@quid/shared'
import { Avatar, Button, cn, Input, Popover, PopoverContent, PopoverTrigger, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Coins, MessageSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { keys, useMembers } from '@/lib/queries'

const DEFAULT_BANNER = 'linear-gradient(135deg, #8052ff, #15846e)'

export function ProfileCard({ user }: { user: UserSummary }) {
  const { org, api, base, me } = useOrgContext()
  const members = useMembers(org.id)
  const m: Member | undefined = members.data?.find((x) => x.id === user.id)
  const qc = useQueryClient()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [gift, setGift] = useState('')
  const isTeacher = (r?: string) => r === 'owner' || r === 'admin'
  const canGift = isTeacher(org.role) && user.id !== me.id && !user.isBot
  const decoration = decorationById(m?.decoration ?? user.decoration)

  const message = async () => {
    setBusy(true)
    try {
      const c = await post<Channel>(`${api}/conversations`, { userIds: [user.id] })
      qc.setQueryData<Channel[]>(keys.channels(org.id), (l) =>
        l ? [...l.filter((x) => x.id !== c.id), c] : l,
      )
      router.push(`${base}/c/${c.id}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const sendGift = async () => {
    const amount = Number.parseInt(gift, 10)
    if (!amount || amount < 1) return
    try {
      await post(`${api}/members/${user.id}/coins`, { amount })
      toast.success(`Gave ${amount} Wicky Coins to ${displayName(user)} 🪙`)
      setGift('')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="w-[300px] overflow-hidden rounded-lg">
      <div
        className="h-[72px]"
        style={{ background: m?.bannerColor ?? DEFAULT_BANNER }}
        aria-hidden="true"
      />
      <div className="px-4 pb-4">
        <div className="-mt-9 mb-2 flex items-end justify-between">
          <span className="rounded-2xl bg-bg-overlay p-1">
            <Avatar
              name={user.name}
              id={user.id}
              src={user.avatarUrl}
              decoration={m?.decoration ?? user.decoration}
              presence={m?.presence}
              size="xl"
            />
          </span>
          {decoration && (
            <span className="mb-1 rounded-full bg-bg-muted px-2 py-0.5 text-2xs text-fg-muted">
              ✨ {decoration.name}
            </span>
          )}
        </div>
        <p className="text-[17px] leading-tight font-semibold">{displayName(user)}</p>
        <p className="text-[13px] text-fg-muted">
          {user.name}
          {m?.pronouns ? ` · ${m.pronouns}` : ''}
        </p>
        {m && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-2xs font-semibold',
                isTeacher(m.role)
                  ? 'bg-accent-subtle text-accent-text'
                  : 'bg-bg-muted text-fg-muted',
              )}
            >
              {isTeacher(m.role) ? '🍎 Teacher' : ROLE_LABEL[m.role]}
            </span>
            {m.title && (
              <span className="rounded-md bg-bg-muted px-1.5 py-0.5 text-2xs text-fg-muted">
                {m.title}
              </span>
            )}
          </div>
        )}
        {(m?.statusEmoji || m?.statusText) && (
          <p className="mt-2 text-[13px]">
            {m.statusEmoji} {m.statusText}
          </p>
        )}
        <div className="my-3 h-px bg-border" />
        <p className="mb-1 text-2xs font-semibold text-fg-subtle uppercase">About me</p>
        <p className="text-[13px] break-words whitespace-pre-wrap text-fg">
          {m?.bio || <span className="text-fg-subtle">Nothing here yet.</span>}
        </p>
        {m && (
          <>
            <p className="mt-3 mb-0.5 text-2xs font-semibold text-fg-subtle uppercase">
              Member since
            </p>
            <p className="text-[13px] text-fg-muted">
              {new Date(m.joinedAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </>
        )}
        {user.id !== me.id && !user.isBot && (
          <Button className="mt-4 w-full" variant="primary" loading={busy} onClick={message}>
            <MessageSquare /> Message
          </Button>
        )}
        {canGift && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void sendGift()
            }}
          >
            <Input
              type="number"
              min={1}
              max={1000}
              placeholder="Coins"
              value={gift}
              onChange={(e) => setGift(e.target.value)}
              className="w-24"
              aria-label="Coins to give"
            />
            <Button type="submit" className="flex-1" disabled={!gift}>
              <Coins /> Reward
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

/** Wraps a name or avatar so clicking it opens the profile card. */
export function ProfilePopover({
  user,
  children,
  side = 'right',
}: {
  user: UserSummary
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  if (user.isBot || !user.id || user.id === 'system') return <>{children}</>
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="cursor-pointer text-left hover:underline">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align="start" className="p-0">
        <ProfileCard user={user} />
      </PopoverContent>
    </Popover>
  )
}
