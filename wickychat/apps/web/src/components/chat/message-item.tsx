'use client'
import type { Channel, Message } from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Tooltip,
  toast,
} from '@quid/ui'
import {
  AlarmClock,
  Bookmark,
  BookmarkCheck,
  CornerUpRight,
  Flag,
  Link2,
  ListTodo,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCw,
  SmilePlus,
  Trash2,
} from 'lucide-react'
import { memo, useState } from 'react'
import { type LocalMessage, useMessageActions } from '@/lib/actions'
import { errorMessage, post } from '@/lib/api'
import { useEmojiMap } from '@/lib/expressions'
import { displayName, formatFull, formatTime, relative } from '@/lib/format'
import { usePreferences } from '@/lib/preferences'
import { reminderChoices, whenLabel } from '@/lib/productivity'
import { useMembers } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { TaskDialog } from '../productivity/tasks'
import { ProfilePopover } from '../profile/profile-card'
import { StyledName } from '../profile/styled-name'
import { Attachments } from './attachments'
import { Composer } from './composer'
import { EmojiValue, isEmojiOnly } from './custom-emoji'
import { DuelCard } from './duel'
import { EmojiPicker } from './emoji-picker'
import { PollCard } from './poll'
import { ReportDialog } from './report-dialog'
import { RichText } from './rich-text'
import { SeenBy } from './seen-by'

export interface MessageItemProps {
  m: LocalMessage
  channel: Channel
  /** Collapse the header when the previous message is from the same author shortly before. */
  grouped: boolean
  inThread?: boolean
  highlighted?: boolean
  canModerate: boolean
  canPost: boolean
  onOpenThread?: (m: Message) => void
  onForward: (m: Message) => void
}

function Reactions({ m, onToggle }: { m: Message; onToggle: (emoji: string) => void }) {
  const { me, org } = useOrgContext()
  const members = useMembers(org.id)
  const name = (id: string) =>
    id === me.id ? 'You' : (members.data?.find((x) => x.id === id)?.name ?? 'Someone')
  if (!m.reactions.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {m.reactions.map((r) => {
        const mine = r.userIds.includes(me.id)
        const who = r.userIds.slice(0, 6).map(name)
        const label = `${who.join(', ')}${r.userIds.length > 6 ? ` and ${r.userIds.length - 6} more` : ''} reacted with ${r.emoji}`
        return (
          <Tooltip key={r.emoji} content={label}>
            <button
              type="button"
              aria-pressed={mine}
              aria-label={label}
              onClick={() => onToggle(r.emoji)}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors',
                mine
                  ? 'border-accent/50 bg-accent-subtle font-medium text-accent-text'
                  : 'border-border bg-bg-subtle text-fg-muted hover:border-border-strong',
              )}
            >
              <span className="text-[13px] leading-none">
                <EmojiValue value={r.emoji} />
              </span>
              {r.count}
            </button>
          </Tooltip>
        )
      })}
      <EmojiPicker onPick={onToggle} side="top" align="start">
        <button
          type="button"
          aria-label="Add reaction"
          className="inline-flex h-6 items-center rounded-full border border-transparent px-1.5 text-fg-subtle hover:border-border hover:bg-bg-subtle hover:text-fg"
        >
          <SmilePlus className="size-3.5" />
        </button>
      </EmojiPicker>
    </div>
  )
}

/**
 * The channel object is replaced whenever its unread counts change (on every
 * new message), so comparing it by identity would re-render every message.
 * Only the fields a message row reads matter.
 */
function sameMessageProps(a: MessageItemProps, b: MessageItemProps) {
  for (const k of Object.keys(b) as (keyof MessageItemProps)[]) {
    if (k !== 'channel' && a[k] !== b[k]) return false
  }
  return (
    a.channel.id === b.channel.id &&
    a.channel.archivedAt === b.channel.archivedAt &&
    !!a.channel.membership === !!b.channel.membership
  )
}

export const MessageItem = memo(function MessageItem({
  m,
  channel,
  grouped,
  inThread,
  highlighted,
  canModerate,
  canPost,
  onOpenThread,
  onForward,
}: MessageItemProps) {
  const { me, base, api, org: orgInfo } = useOrgContext()
  const actions = useMessageActions()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reporting, setReporting] = useState(false)
  // Teachers see who has read announcements (channels where only teachers can post).
  const seenReceipts =
    (orgInfo.role === 'owner' || orgInfo.role === 'admin') &&
    channel.postingPolicy === 'admins' &&
    m.kind === 'user'
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const prefs = usePreferences()
  const emojis = useEmojiMap()
  const compact = prefs.density === 'compact'
  const mine = m.author.id === me.id
  const remindAt = async (at: Date) => {
    try {
      await post(`${api}/reminders`, { messageId: m.id, dueAt: at.toISOString() })
      toast.success(`We'll remind you ${whenLabel(at.toISOString()).toLowerCase()}`, {
        description: 'Find it in Later → Reminders.',
      })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const local = m._status !== undefined
  const author = displayName(m.author)

  if (m.kind === 'system') {
    return (
      <div className="group flex items-center gap-2 px-4 py-1 text-[13px] text-fg-muted md:px-5">
        <span className="w-9 shrink-0 text-right text-2xs text-fg-subtle opacity-0 group-hover:opacity-100">
          {formatTime(m.createdAt)}
        </span>
        <span>
          <span className="font-medium text-fg">{author}</span> {m.text}
        </span>
      </div>
    )
  }

  if (m.deletedAt) {
    return (
      <div className="flex gap-3 px-4 py-1.5 md:px-5">
        <div className="w-9 shrink-0" />
        <div>
          <p className="text-[13px] text-fg-subtle italic">This message was deleted.</p>
          {!inThread && m.replyCount > 0 && (
            <ThreadSummary m={m} onOpen={() => onOpenThread?.(m)} />
          )}
        </div>
      </div>
    )
  }

  const copyLink = () => {
    void navigator.clipboard.writeText(`${location.origin}${base}/c/${m.channelId}?m=${m.id}`)
    toast.success('Link copied')
  }

  const toolbarVisible = menuOpen || pickerOpen

  return (
    <div
      id={inThread ? `t-${m.id}` : `m-${m.id}`}
      className={cn(
        'q-anim-row group relative flex gap-3 px-4 transition-colors hover:bg-bg-subtle md:px-5',
        grouped ? (compact ? 'py-0' : 'py-0.5') : compact ? 'pt-1 pb-0' : 'pt-2 pb-0.5',
        highlighted && 'bg-mention/60 hover:bg-mention/60',
        editing && 'bg-accent-subtle/40 hover:bg-accent-subtle/40',
        m._status === 'sending' && 'opacity-60',
        toolbarVisible && 'bg-bg-subtle',
      )}
    >
      <div className={cn('shrink-0', compact ? 'w-8' : 'w-9')}>
        {grouped ? (
          <Tooltip content={formatFull(m.createdAt)}>
            <time
              dateTime={m.createdAt}
              className="mt-[3px] block text-right text-2xs leading-5 text-fg-subtle opacity-0 tabular-nums group-hover:opacity-100"
            >
              {formatTime(m.createdAt).replace(/\s?[AP]M$/i, '')}
            </time>
          </Tooltip>
        ) : prefs.avatars ? (
          <ProfilePopover user={m.author}>
            <Avatar
              name={m.author.name}
              id={m.author.id}
              src={m.author.avatarUrl}
              decoration={m.author.decoration}
              size="lg"
              className={cn('mt-0.5', compact ? '[&>span]:size-8' : '[&>span]:size-9')}
            />
          </ProfilePopover>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <ProfilePopover user={m.author}>
              <StyledName user={m.author} className="text-[14px] font-semibold" />
            </ProfilePopover>
            {m.author.isBot && (
              <span className="rounded bg-bg-emphasis px-1 text-2xs font-semibold text-fg-muted">
                BOT
              </span>
            )}
            <Tooltip content={formatFull(m.createdAt)}>
              <time dateTime={m.createdAt} className="text-xs text-fg-subtle tabular-nums">
                {formatTime(m.createdAt)}
              </time>
            </Tooltip>
          </div>
        )}

        {m.pinned && !inThread && (
          <p className="flex items-center gap-1 text-2xs font-medium text-warning">
            <Pin className="size-3" /> Pinned
          </p>
        )}

        {m.forwardedFrom && (
          <div className="mt-0.5 mb-1 border-l-2 border-border-strong pl-3">
            <p className="flex items-center gap-1 text-xs text-fg-subtle">
              <CornerUpRight className="size-3" /> Forwarded from{' '}
              {displayName(m.forwardedFrom.author)} · {relative(m.forwardedFrom.createdAt)}
            </p>
            <p className="mt-0.5 text-[14px] whitespace-pre-wrap">{m.forwardedFrom.text}</p>
          </div>
        )}

        {editing ? (
          <div className="mt-1 mb-2">
            <Composer
              channel={channel}
              parentId={m.parentId}
              mode="edit"
              initial={m.body}
              placeholder="Edit message"
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => {
                await actions.edit(m, body)
                setEditing(false)
              }}
            />
          </div>
        ) : (
          <div
            className={prefs.jumboEmoji && isEmojiOnly(m.text, emojis) ? 'q-jumbo' : 'q-msg-text'}
          >
            <RichText doc={m.body} />
            {m.editedAt && <span className="text-2xs text-fg-subtle"> (edited)</span>}
          </div>
        )}

        <Attachments items={m.attachments} />
        {m.pollId && <PollCard pollId={m.pollId} />}
        {m.duelId && <DuelCard duelId={m.duelId} />}
        <Reactions m={m} onToggle={(e) => void actions.toggleReaction(m, e)} />
        {seenReceipts && !local && !inThread && <SeenBy messageId={m.id} />}
        {!inThread && m.replyCount > 0 && <ThreadSummary m={m} onOpen={() => onOpenThread?.(m)} />}

        {m._status === 'failed' && (
          <p className="mt-1 flex items-center gap-2 text-xs text-danger">
            Not sent.
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium hover:underline"
              onClick={() => m._retry?.()}
            >
              <RotateCw className="size-3" /> Retry
            </button>
            <button
              type="button"
              className="font-medium text-fg-muted hover:underline"
              onClick={() => actions.discardFailed(m)}
            >
              Discard
            </button>
          </p>
        )}
      </div>

      {!local && !editing && (
        <div
          className={cn(
            'absolute -top-3.5 right-4 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-bg-overlay p-0.5 shadow-pop md:right-5',
            toolbarVisible ? 'flex' : 'hidden group-focus-within:flex group-hover:flex',
          )}
        >
          {prefs.quickReactions.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`React with ${e}`}
              onClick={() => void actions.toggleReaction(m, e)}
              className="flex size-7 items-center justify-center rounded-md text-[15px] hover:bg-bg-muted"
            >
              <EmojiValue value={e} />
            </button>
          ))}
          <EmojiPicker
            onPick={(e) => void actions.toggleReaction(m, e)}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          >
            <IconButton label="Add reaction" size="sm" className="size-7">
              <SmilePlus />
            </IconButton>
          </EmojiPicker>
          {!inThread && onOpenThread && (
            <Tooltip content="Reply in thread">
              <IconButton
                label="Reply in thread"
                size="sm"
                className="size-7"
                onClick={() => onOpenThread(m)}
              >
                <MessageSquareText />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip content={m.bookmarked ? 'Remove from saved' : 'Save for later'}>
            <IconButton
              label={m.bookmarked ? 'Remove from saved' : 'Save for later'}
              size="sm"
              className="size-7"
              onClick={() => void actions.toggleBookmark(m)}
            >
              {m.bookmarked ? <BookmarkCheck className="text-accent" /> : <Bookmark />}
            </IconButton>
          </Tooltip>
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger asChild>
              <IconButton label="More actions" size="sm" className="size-7">
                <MoreHorizontal />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              {mine && m.kind === 'user' && !channel.archivedAt && (
                <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                  Edit message
                </MenuItem>
              )}
              <MenuItem icon={<CornerUpRight />} onSelect={() => onForward(m)}>
                Forward
              </MenuItem>
              {!local && channel.membership && !channel.archivedAt && (
                <MenuItem icon={<ListTodo />} onSelect={() => setTaskOpen(true)}>
                  Create task
                </MenuItem>
              )}
              {!local && (
                <MenuSub>
                  <MenuSubTrigger icon={<AlarmClock />}>Remind me about this</MenuSubTrigger>
                  <MenuSubContent>
                    {reminderChoices().map((c) => (
                      <MenuItem key={c.label} onSelect={() => void remindAt(c.at)}>
                        {c.label}
                      </MenuItem>
                    ))}
                  </MenuSubContent>
                </MenuSub>
              )}
              {canPost && (
                <MenuItem
                  icon={m.pinned ? <PinOff /> : <Pin />}
                  onSelect={() => void actions.togglePin(m)}
                >
                  {m.pinned ? 'Unpin from channel' : 'Pin to channel'}
                </MenuItem>
              )}
              <MenuItem icon={<Link2 />} onSelect={copyLink}>
                Copy link
              </MenuItem>
              {!mine && !local && m.kind === 'user' && !m.author.isBot && (
                <MenuItem icon={<Flag />} onSelect={() => setReporting(true)}>
                  Report message
                </MenuItem>
              )}
              {(mine || canModerate) && (
                <>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 />} onSelect={() => setConfirmDelete(true)}>
                    Delete message
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      )}

      {taskOpen && (
        <TaskDialog
          open={taskOpen}
          onOpenChange={setTaskOpen}
          channel={channel}
          initial={{ title: m.text.split('\n')[0], messageId: m.id }}
        />
      )}
      {reporting && <ReportDialog message={m} onClose={() => setReporting(false)} />}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          title="Delete message?"
          description={
            mine
              ? "This can't be undone."
              : `You're deleting a message from ${author} as a moderator. This can't be undone.`
          }
        >
          <blockquote className="line-clamp-4 rounded-md border border-border bg-bg-subtle p-3 text-[13px]">
            {m.text || 'Attachment'}
          </blockquote>
          <DialogFooter>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false)
                void actions.remove(m)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}, sameMessageProps)

function ThreadSummary({ m, onOpen }: { m: Message; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/thread mt-1 -ml-1 flex items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-xs hover:border-border hover:bg-bg"
    >
      <span className="flex -space-x-1">
        {m.replyUsers.slice(0, 3).map((u) => (
          <Avatar
            key={u.id}
            name={u.name}
            id={u.id}
            src={u.avatarUrl}
            decoration={u.decoration}
            size="xs"
            className="ring-2 ring-bg"
          />
        ))}
      </span>
      <span className="font-semibold text-accent-text">
        {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
      </span>
      {m.lastReplyAt && (
        <span className="text-fg-subtle group-hover/thread:hidden">
          Last reply {relative(m.lastReplyAt)}
        </span>
      )}
      <span className="hidden text-fg-subtle group-hover/thread:inline">View thread</span>
    </button>
  )
}
