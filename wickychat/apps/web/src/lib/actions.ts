'use client'
import type { Attachment, Channel, DocNode, Message, ReactionGroup } from '@quid/shared'
import { DUEL, docToText } from '@quid/shared'
import { toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useOrgContext } from '@/components/org-context'
import { parseRemind, whenLabel } from '@/lib/productivity'
import { del, errorMessage, get, patch, post, put } from './api'
import { keys, patchMessage, removeMessage, upsertMessage } from './queries'

export type PluginCommand = {
  command: string
  description: string
  usage: string | null
  plugin: { id: string; name: string; iconUrl: string | null; verified: boolean }
  channelIds: string[]
}

/** Commands built into WickyChat (plugins with the same name take precedence). */
export const BUILTIN_COMMANDS = [
  { command: 'remind', usage: 'in 20m stretch', description: 'Set a reminder for yourself' },
  { command: 'todo', usage: 'Write the launch email', description: 'Add a task to this channel' },
  { command: 'coinflip', usage: '50 heads', description: 'Duel anyone here for Wicky Coins' },
] as const

export type LocalMessage = Message & { _status?: 'sending' | 'failed'; _retry?: () => void }

/** All message mutations, with optimistic cache updates. */
export function useMessageActions() {
  const { api, me, org } = useOrgContext()
  const qc = useQueryClient()

  const send = async (
    channel: Channel,
    body: DocNode,
    fileIds: string[],
    files: Attachment[],
    parentId: string | null = null,
  ) => {
    // "/command text" runs a plugin's slash command instead of posting (when a plugin provides it).
    const plain = docToText(body).trim()
    const slash = !fileIds.length && /^\/([a-z][a-z0-9-]{1,31})(?:\s+([\s\S]*))?$/.exec(plain)
    if (slash) {
      const commands = await qc.fetchQuery({
        queryKey: ['plugin-commands', org.id],
        queryFn: () => get<PluginCommand[]>(`${api}/plugin-commands`),
        staleTime: 60_000,
      })
      const cmd = commands.find((c) => c.command === slash[1])
      if (cmd) {
        try {
          const r = await post<{
            visibility: 'channel' | 'ephemeral'
            text: string | null
            plugin: string
          }>(`${api}/channels/${channel.id}/commands`, {
            command: cmd.command,
            text: slash[2] ?? '',
            threadId: parentId,
          })
          // Only you see ephemeral replies; channel replies arrive as a message from the plugin.
          if (r.visibility === 'ephemeral' && r.text)
            // Plugin text may use **bold** and `code`; toasts show it plain.
            toast.info(r.plugin, { description: r.text.replace(/\*\*|`/g, '').slice(0, 500) })
        } catch (e) {
          toast.error(errorMessage(e))
          throw e
        }
        return
      }
      if (slash[1] === 'remind') {
        const parsed = parseRemind(slash[2] ?? '')
        if (!parsed) {
          toast.error(
            'Try “/remind in 20m stretch”, “/remind tomorrow 9am review the deck” or “/remind at 5pm ship it”.',
          )
          throw new Error('bad /remind')
        }
        await post(`${api}/reminders`, { text: parsed.what, dueAt: parsed.due.toISOString() })
        void qc.invalidateQueries({ queryKey: ['reminders', org.id] })
        toast.success(`Reminder set: ${whenLabel(parsed.due.toISOString())}`, {
          description: parsed.what,
        })
        return
      }
      if (slash[1] === 'todo') {
        const title = (slash[2] ?? '').trim()
        if (!title) {
          toast.error('Add what needs doing: “/todo Write the launch email”.')
          throw new Error('bad /todo')
        }
        try {
          await post(`${api}/tasks`, { channelId: channel.id, title: title.slice(0, 300) })
        } catch (e) {
          toast.error(errorMessage(e))
          throw e
        }
        void qc.invalidateQueries({ queryKey: ['tasks', org.id] })
        toast.success('Task added', { description: `${title.slice(0, 80)} · see the Tasks tab` })
        return
      }
      if (slash[1] === 'coinflip') {
        const args = (slash[2] ?? '').toLowerCase()
        const amount = Number(/\d+/.exec(args)?.[0])
        if (!amount || amount < DUEL.min || amount > DUEL.max) {
          toast.error(`Try “/coinflip 50 heads” (${DUEL.min} to ${DUEL.max} coins).`)
          throw new Error('bad /coinflip')
        }
        // In a 1:1 chat, the duel is for the other person.
        const other =
          channel.kind === 'dm' ? channel.participants?.find((m) => m.id !== me.id)?.id : undefined
        try {
          await post(`${api}/channels/${channel.id}/duels`, {
            amount,
            side: args.includes('tail') ? 'tails' : 'heads',
            opponentId: other ?? null,
          })
          void qc.invalidateQueries({ queryKey: ['wallet'] })
        } catch (e) {
          toast.error(errorMessage(e))
          throw e
        }
        return
      }
    }
    const clientId = `c-${crypto.randomUUID()}`
    const optimistic: LocalMessage = {
      id: clientId,
      clientId,
      channelId: channel.id,
      parentId,
      author: {
        id: me.id,
        name: me.name,
        displayName: me.displayName,
        avatarUrl: me.avatarUrl,
        isBot: false,
      },
      body,
      text: docToText(body),
      kind: 'user',
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      reactions: [],
      attachments: files,
      replyCount: 0,
      lastReplyAt: null,
      replyUsers: [],
      pinned: false,
      bookmarked: false,
      forwardedFrom: null,
      _status: 'sending',
    }
    const place = (m: LocalMessage) => {
      if (parentId) {
        qc.setQueryData<{ root: Message; replies: LocalMessage[] }>(keys.thread(parentId), (t) =>
          t
            ? {
                ...t,
                replies: t.replies.some((r) => r.clientId === m.clientId)
                  ? t.replies.map((r) => (r.clientId === m.clientId ? m : r))
                  : [...t.replies, m],
              }
            : t,
        )
      } else upsertMessage(qc, m)
    }
    place(optimistic)
    const attempt = async () => {
      try {
        const saved = await post<Message>(`${api}/channels/${channel.id}/messages`, {
          body,
          parentId,
          fileIds,
          clientId,
        })
        place(saved)
        void qc.invalidateQueries({ queryKey: keys.drafts(org.id) })
      } catch (e) {
        place({
          ...optimistic,
          _status: 'failed',
          _retry: () => {
            place({ ...optimistic, _status: 'sending' })
            void attempt()
          },
        })
        toast.error("Message didn't send", { description: errorMessage(e) })
      }
    }
    await attempt()
  }

  const discardFailed = (m: LocalMessage) => {
    if (m.parentId) {
      qc.setQueryData<{ root: Message; replies: Message[] }>(keys.thread(m.parentId), (t) =>
        t ? { ...t, replies: t.replies.filter((r) => r.id !== m.id) } : t,
      )
    } else removeMessage(qc, m.channelId, m.id)
  }

  const edit = async (m: Message, body: DocNode) => {
    const before = m
    patchMessage(qc, m.channelId, m.id, (x) => ({
      ...x,
      body,
      text: docToText(body),
      editedAt: new Date().toISOString(),
    }))
    try {
      const saved = await patch<Message>(`${api}/messages/${m.id}`, { body })
      patchMessage(qc, m.channelId, m.id, (x) => ({ ...saved, bookmarked: x.bookmarked }))
    } catch (e) {
      patchMessage(qc, m.channelId, m.id, () => before)
      toast.error(errorMessage(e))
      throw e
    }
  }

  const remove = async (m: Message) => {
    try {
      await del(`${api}/messages/${m.id}`)
      removeMessage(qc, m.channelId, m.id)
      if (m.parentId) {
        qc.setQueryData<{ root: Message; replies: Message[] }>(keys.thread(m.parentId), (t) =>
          t ? { ...t, replies: t.replies.filter((r) => r.id !== m.id) } : t,
        )
      }
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const toggleReaction = async (m: Message, emoji: string) => {
    const mine = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(me.id)
    const next: ReactionGroup[] = mine
      ? m.reactions
          .map((r) =>
            r.emoji === emoji
              ? { ...r, count: r.count - 1, userIds: r.userIds.filter((u) => u !== me.id) }
              : r,
          )
          .filter((r) => r.count > 0)
      : m.reactions.some((r) => r.emoji === emoji)
        ? m.reactions.map((r) =>
            r.emoji === emoji ? { ...r, count: r.count + 1, userIds: [...r.userIds, me.id] } : r,
          )
        : [...m.reactions, { emoji, count: 1, userIds: [me.id] }]
    patchMessage(qc, m.channelId, m.id, (x) => ({ ...x, reactions: next }))
    try {
      const r = await (mine ? del : post)<{ reactions: ReactionGroup[] }>(
        `${api}/messages/${m.id}/reactions`,
        { emoji },
      )
      patchMessage(qc, m.channelId, m.id, (x) => ({ ...x, reactions: r.reactions }))
    } catch (e) {
      patchMessage(qc, m.channelId, m.id, (x) => ({ ...x, reactions: m.reactions }))
      toast.error(errorMessage(e))
    }
  }

  const togglePin = async (m: Message) => {
    try {
      await (m.pinned ? del : post)(`${api}/messages/${m.id}/pin`)
      patchMessage(qc, m.channelId, m.id, (x) => ({ ...x, pinned: !m.pinned }))
      void qc.invalidateQueries({ queryKey: keys.pins(m.channelId) })
      toast.success(m.pinned ? 'Unpinned' : 'Pinned to channel')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const toggleBookmark = async (m: Message) => {
    patchMessage(qc, m.channelId, m.id, (x) => ({ ...x, bookmarked: !m.bookmarked }))
    try {
      await (m.bookmarked ? del : post)(`${api}/messages/${m.id}/bookmark`)
      void qc.invalidateQueries({ queryKey: keys.bookmarks(org.id) })
      toast.success(m.bookmarked ? 'Removed from saved items' : 'Saved for later')
    } catch (e) {
      patchMessage(qc, m.channelId, m.id, (x) => ({ ...x, bookmarked: m.bookmarked }))
      toast.error(errorMessage(e))
    }
  }

  const forward = async (m: Message, targetChannelId: string, comment?: DocNode) => {
    await post(`${api}/messages/${m.id}/forward`, { targetChannelId, ...(comment && { comment }) })
  }

  const saveDraft = async (channelId: string, parentId: string | null, body: DocNode | null) => {
    await put(`${api}/channels/${channelId}/draft`, {
      body: body ?? { type: 'doc', content: [] },
      parentId,
    }).catch(() => {})
    void qc.invalidateQueries({ queryKey: keys.drafts(org.id) })
  }

  const schedule = async (
    channelId: string,
    parentId: string | null,
    body: DocNode,
    sendAt: Date,
  ) => {
    try {
      await post(`${api}/scheduled`, { channelId, parentId, body, sendAt: sendAt.toISOString() })
      void qc.invalidateQueries({ queryKey: keys.scheduled(org.id) })
      toast.success('Message scheduled', {
        description: sendAt.toLocaleString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
      })
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    }
  }

  return {
    send,
    discardFailed,
    edit,
    remove,
    toggleReaction,
    togglePin,
    toggleBookmark,
    forward,
    saveDraft,
    schedule,
  }
}
