'use client'
/**
 * WickyChat: Discord-style profile card. Click someone's name or picture to see their banner,
 * decoration, styled name, pronouns, bio and role. From here you can message them, gift them a
 * decoration, and (teachers) reward them with coins.
 */
import type { Channel, Member, UserSummary } from '@quid/shared'
import { cleanProfileStyle, decorationById, ROLE_LABEL } from '@quid/shared'
import { Avatar, Button, cn, Input, Popover, PopoverContent, PopoverTrigger, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Coins, ExternalLink, Gift, Link2, MessageSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, post } from '@/lib/api'
import { displayName } from '@/lib/format'
import { keys, useMembers } from '@/lib/queries'
import { StyledName } from './styled-name'

export const DEFAULT_BANNER = 'linear-gradient(135deg, #8052ff, #15846e)'

/** Everything the card needs to draw; shared with the live preview in Settings → Profile. */
export interface CardLook {
  user: UserSummary
  bannerUrl: string | null
  bannerColor: string | null
  theme?: [string, string]
  bioFont?: string
  pronouns: string
  bio: string
  decorationName?: string
}

/** The visual part of the card, without data loading or buttons. */
export function CardFace({
  look,
  children,
  presence,
}: {
  look: CardLook
  children?: React.ReactNode
  presence?: Member['presence']
}) {
  const themed = !!look.theme
  return (
    <div
      className={cn('w-full overflow-hidden rounded-lg', themed && 'p-[3px]')}
      style={
        themed
          ? { background: `linear-gradient(180deg, ${look.theme![0]}, ${look.theme![1]})` }
          : undefined
      }
    >
      <div
        className={cn('overflow-hidden', themed && 'rounded-[6px]')}
        style={
          themed
            ? {
                background: `linear-gradient(180deg, color-mix(in oklab, ${look.theme![0]} 28%, var(--q-bg-overlay)), color-mix(in oklab, ${look.theme![1]} 28%, var(--q-bg-overlay)))`,
              }
            : undefined
        }
      >
        <div
          className="h-[96px] bg-cover bg-center"
          style={{
            backgroundColor: look.bannerColor ?? undefined,
            backgroundImage: look.bannerUrl
              ? `url("${look.bannerUrl}")`
              : look.bannerColor
                ? undefined
                : DEFAULT_BANNER,
          }}
          aria-hidden="true"
        />
        <div className="px-4 pb-4">
          <div className="-mt-10 mb-2 flex items-end justify-between">
            <span className="rounded-full bg-bg-overlay p-1.5">
              <Avatar
                name={look.user.name}
                id={look.user.id}
                src={look.user.avatarUrl}
                decoration={look.user.decoration}
                presence={presence}
                size="xl"
              />
            </span>
            {look.decorationName && (
              <span className="mb-1 rounded-full bg-bg-muted/80 px-2 py-0.5 text-2xs text-fg-muted">
                ✨ {look.decorationName}
              </span>
            )}
          </div>
          <StyledName user={look.user} className="block text-[19px] leading-tight font-bold" />
          <p className="text-[13px] text-fg-muted">
            {look.user.name}
            {look.pronouns ? ` · ${look.pronouns}` : ''}
          </p>
          {children}
        </div>
      </div>
    </div>
  )
}

export function BioBlock({ bio, font }: { bio: string; font?: string }) {
  return (
    <>
      <p className="mb-1 text-2xs font-semibold text-fg-subtle uppercase">About me</p>
      <p
        className={cn(
          'text-[13px] break-words whitespace-pre-wrap text-fg',
          font && font !== 'default' && `q-font-${font}`,
        )}
      >
        {bio || <span className="text-fg-subtle">Nothing here yet.</span>}
      </p>
    </>
  )
}

/** Linked accounts (just guns.lol for now). */
export function ConnectionsBlock({ gunslol }: { gunslol?: string }) {
  if (!gunslol) return null
  return (
    <>
      <p className="mt-3 mb-1 text-2xs font-semibold text-fg-subtle uppercase">Connections</p>
      <a
        href={`https://guns.lol/${encodeURIComponent(gunslol)}`}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-2 rounded-md border border-border bg-bg-muted/60 px-2.5 py-2 text-[13px] hover:bg-bg-muted"
      >
        <Link2 className="size-4 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-fg-muted">guns.lol/</span>
          <span className="font-medium">{gunslol}</span>
        </span>
        <ExternalLink className="size-3.5 shrink-0 text-fg-subtle" />
      </a>
    </>
  )
}

export function ProfileCard({ user, panel }: { user: UserSummary; panel?: boolean }) {
  const { org, api, base, me } = useOrgContext()
  const members = useMembers(org.id)
  const m: Member | undefined = members.data?.find((x) => x.id === user.id)
  const qc = useQueryClient()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [gift, setGift] = useState('')
  const isTeacher = (r?: string) => r === 'owner' || r === 'admin'
  const canGift = isTeacher(org.role) && user.id !== me.id && !user.isBot
  const style = cleanProfileStyle(m?.profileStyle)
  const merged: UserSummary = {
    ...user,
    decoration: m?.decoration ?? user.decoration,
    nameStyle: m?.nameStyle ?? user.nameStyle,
  }
  const decoration = merged.decoration?.startsWith('u:')
    ? 'Made by a student'
    : decorationById(merged.decoration)?.name

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
    <div className={panel ? 'w-full' : 'w-[320px]'}>
      <CardFace
        presence={m?.presence}
        look={{
          user: merged,
          bannerUrl: m?.bannerUrl ?? null,
          bannerColor: m?.bannerColor ?? null,
          theme: style.theme,
          bioFont: style.bioFont,
          pronouns: m?.pronouns ?? '',
          bio: m?.bio ?? '',
          decorationName: decoration,
        }}
      >
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
        <BioBlock bio={m?.bio ?? ''} font={style.bioFont} />
        <ConnectionsBlock gunslol={style.gunslol} />
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
          <div className="mt-4 flex gap-2">
            {!panel && (
              <Button className="flex-1" variant="primary" loading={busy} onClick={message}>
                <MessageSquare /> Message
              </Button>
            )}
            <Button
              title="Gift a decoration"
              className={panel ? 'flex-1' : undefined}
              onClick={() => router.push(`${base}/shop?gift=${user.id}`)}
            >
              <Gift /> {panel && 'Gift a decoration'}
            </Button>
          </div>
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
      </CardFace>
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

/** Discord-style profile on the right side of a 1:1 DM. */
export function ProfilePanel({ user }: { user: UserSummary }) {
  return (
    <aside
      aria-label={`${displayName(user)}'s profile`}
      className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-border bg-bg-overlay lg:flex"
    >
      <div className="p-3">
        <ProfileCard user={user} panel />
      </div>
    </aside>
  )
}
