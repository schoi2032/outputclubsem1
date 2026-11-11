'use client'
import type { Meeting } from '@quid/shared'
import {
  Avatar,
  Badge,
  Button,
  cn,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Switch,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Link2, MicOff, MoreHorizontal, SendHorizontal, UserPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { patch as apiPatch, errorMessage, post } from '@/lib/api'
import { displayName, formatTime } from '@/lib/format'
import { PeoplePicker } from '../dialogs/people-picker'
import { useOrgContext } from '../org-context'
import type { MeetingRoomState } from './use-meeting-room'

export function ChatPanel({ room, onClose }: { room: MeetingRoomState; onClose: () => void }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const count = room.messages.length
  useEffect(() => {
    if (count) end.current?.scrollIntoView({ block: 'end' })
  }, [count])
  return (
    <aside className="flex min-h-0 flex-col" aria-label="Meeting chat">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-[14px] font-semibold">Meeting chat</h2>
        <IconButton label="Close chat" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {count === 0 ? (
          <p className="pt-6 text-center text-xs text-fg-subtle">
            Messages are visible to people in the meeting and aren't saved after it ends.
          </p>
        ) : (
          room.messages.map((m) => (
            <div key={m.id} className="mb-3">
              <p className="text-xs">
                <span className="font-semibold">{m.fromName}</span>{' '}
                <span className="text-fg-subtle">{formatTime(new Date(m.at).toISOString())}</span>
              </p>
              <p className="text-[13.5px] whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</p>
            </div>
          ))
        )}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          void room.sendChat(text).catch((err) => toast.error(errorMessage(err)))
          setText('')
        }}
      >
        <input
          aria-label="Message"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 text-[13.5px] outline-none focus:border-accent"
          placeholder="Send a message"
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <IconButton label="Send" type="submit" disabled={!text.trim()}>
          <SendHorizontal />
        </IconButton>
      </form>
    </aside>
  )
}

export function PeoplePanel({
  meeting,
  room,
  onClose,
}: {
  meeting: Meeting
  room: MeetingRoomState
  onClose: () => void
}) {
  const { api, me, org } = useOrgContext()
  const qc = useQueryClient()
  const [inviting, setInviting] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const moderator = meeting.myRole === 'host' || meeting.myRole === 'co_host'
  const base = `${api}/meetings/${meeting.code}`
  const live = new Set([room.local?.identity, ...room.remotes.map((r) => r.identity)])
  const micOff = new Set(
    room.tiles.filter((t) => t.kind === 'camera' && t.micMuted).map((t) => t.participant.identity),
  )
  const waiting = meeting.participants.filter((p) => p.status === 'waiting')
  const waitingGuests = meeting.guests.filter((g) => g.status === 'waiting')
  const insideGuests = meeting.guests.filter(
    (g) => g.status === 'joined' || g.status === 'admitted',
  )
  const isHost = meeting.myRole === 'host'
  const guestLink = typeof window !== 'undefined' ? `${location.origin}/join/${meeting.code}` : ''
  const inside = meeting.participants.filter((p) => p.status === 'joined' || live.has(p.user.id))
  const invited = meeting.participants.filter((p) => p.status === 'invited' && !live.has(p.user.id))

  const act = async (path: string, body: Record<string, unknown>, ok?: string) => {
    try {
      await post(`${base}/${path}`, body)
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <aside className="flex min-h-0 flex-col" aria-label="People">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-[14px] font-semibold">People · {inside.length}</h2>
        <IconButton label="Close people" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Button size="sm" className="mb-3 w-full" onClick={() => setInviting((v) => !v)}>
          <UserPlus /> Invite people
        </Button>
        {inviting && (
          <div className="mb-4 flex flex-col gap-2">
            <PeoplePicker
              value={picked}
              onChange={setPicked}
              exclude={meeting.participants
                .filter((p) => p.status !== 'left')
                .map((p) => p.user.id)}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={!picked.length}
              onClick={async () => {
                await act('invite', { userIds: picked }, `Invited ${picked.length}`)
                setPicked([])
                setInviting(false)
              }}
            >
              Send invitations
            </Button>
          </div>
        )}

        {moderator && (
          <section className="mb-4 rounded-lg border border-border p-2.5">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span>
                Guest link
                <span className="block text-xs text-fg-subtle">
                  People without a WickyChat account can ask to join.
                </span>
              </span>
              <Switch
                checked={meeting.guestAccess}
                disabled={!isHost}
                label="Allow guests"
                onCheckedChange={async (v) => {
                  try {
                    const updated = await apiPatch<Meeting>(`${base}`, { guestAccess: v })
                    qc.setQueryData(['meeting', org.id, meeting.code], updated)
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              />
            </div>
            {meeting.guestAccess && (
              <Button
                size="sm"
                className="mt-2 w-full"
                onClick={() => {
                  void navigator.clipboard.writeText(guestLink)
                  toast.success('Guest link copied', {
                    description: 'Guests always wait for a host to let them in.',
                  })
                }}
              >
                <Link2 /> Copy guest link
              </Button>
            )}
            {!isHost && (
              <p className="mt-1 text-2xs text-fg-subtle">Only the host can change this.</p>
            )}
          </section>
        )}

        {moderator && waitingGuests.length > 0 && (
          <section className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-2">
            <h3 className="px-1 pb-1.5 text-xs font-semibold">
              Guests waiting · {waitingGuests.length}
            </h3>
            {waitingGuests.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                <Avatar name={g.name} id={g.id} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {g.name} <Badge>Guest</Badge>
                </span>
                <Button size="sm" variant="ghost" onClick={() => act(`guests/${g.id}/deny`, {})}>
                  Deny
                </Button>
                <Button size="sm" variant="primary" onClick={() => act(`guests/${g.id}/admit`, {})}>
                  Admit
                </Button>
              </div>
            ))}
          </section>
        )}

        {moderator && waiting.length > 0 && (
          <section className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-2">
            <h3 className="px-1 pb-1.5 text-xs font-semibold">
              Waiting to join · {waiting.length}
            </h3>
            {waiting.map((p) => (
              <div key={p.user.id} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                <Avatar
                  name={p.user.name}
                  id={p.user.id}
                  src={p.user.avatarUrl}
                  decoration={p.user.decoration}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-[13px]">{displayName(p.user)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => act('deny', { userId: p.user.id })}
                >
                  Deny
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => act('admit', { userId: p.user.id })}
                >
                  Admit
                </Button>
              </div>
            ))}
            {waiting.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 w-full"
                onClick={() => Promise.all(waiting.map((p) => act('admit', { userId: p.user.id })))}
              >
                Admit all
              </Button>
            )}
          </section>
        )}

        <h3 className="px-1 pb-1 text-2xs font-medium text-fg-subtle uppercase">In the meeting</h3>
        <ul>
          {inside.map((p) => (
            <li
              key={p.user.id}
              className="group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-bg-muted"
            >
              <Avatar
                name={p.user.name}
                id={p.user.id}
                src={p.user.avatarUrl}
                decoration={p.user.decoration}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {displayName(p.user)}
                {p.user.id === me.id && <span className="text-fg-subtle"> (you)</span>}
              </span>
              {p.role !== 'participant' && (
                <Badge tone={p.role === 'host' ? 'accent' : 'neutral'}>
                  {p.role === 'host' ? 'Host' : 'Co-host'}
                </Badge>
              )}
              {micOff.has(p.user.id) && (
                <MicOff className="size-3.5 text-fg-subtle" aria-label="Muted" />
              )}
              {moderator && p.user.id !== me.id && p.role !== 'host' && (
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton
                      label={`Manage ${p.user.name}`}
                      size="sm"
                      className={cn(
                        'opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100',
                      )}
                    >
                      <MoreHorizontal />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem
                      onSelect={() => act('mute', { userId: p.user.id }, `Muted ${p.user.name}`)}
                    >
                      Mute microphone
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        act('role', {
                          userId: p.user.id,
                          role: p.role === 'co_host' ? 'participant' : 'co_host',
                        })
                      }
                    >
                      {p.role === 'co_host' ? 'Remove co-host' : 'Make co-host'}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      danger
                      onSelect={() =>
                        act('remove', { userId: p.user.id }, `Removed ${p.user.name}`)
                      }
                    >
                      Remove from meeting
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </li>
          ))}
        </ul>

        {insideGuests.length > 0 && (
          <>
            <h3 className="mt-4 px-1 pb-1 text-2xs font-medium text-fg-subtle uppercase">Guests</h3>
            <ul>
              {insideGuests.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-bg-muted"
                >
                  <Avatar name={g.name} id={g.id} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{g.name}</span>
                  <Badge>Guest</Badge>
                  {moderator && (
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      onClick={() => act(`guests/${g.id}/remove`, {}, `Removed ${g.name}`)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {invited.length > 0 && (
          <>
            <h3 className="mt-4 px-1 pb-1 text-2xs font-medium text-fg-subtle uppercase">
              Invited
            </h3>
            <ul>
              {invited.map((p) => (
                <li key={p.user.id} className="flex items-center gap-2 px-1 py-1.5 opacity-70">
                  <Avatar
                    name={p.user.name}
                    id={p.user.id}
                    src={p.user.avatarUrl}
                    decoration={p.user.decoration}
                    size="sm"
                  />
                  <span className="truncate text-[13px]">{displayName(p.user)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}
