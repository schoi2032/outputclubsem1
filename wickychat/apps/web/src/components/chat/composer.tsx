'use client'
import type { Attachment, Channel, DocNode, Member } from '@quid/shared'
import { MAX_UPLOAD_BYTES } from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  toast,
} from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import Mention, { type MentionOptions } from '@tiptap/extension-mention'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import {
  AtSign,
  Bold,
  ChevronDown,
  Code,
  FileText,
  Hash,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  SendHorizontal,
  Smile,
  SquareCode,
  SquareSlash,
  Strikethrough,
  Type,
  X,
} from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { BUILTIN_COMMANDS, type PluginCommand } from '@/lib/actions'
import { get, upload } from '@/lib/api'
import { useCustomEmojis } from '@/lib/expressions'
import { displayName, fileSize } from '@/lib/format'
import { getPreferences, usePreference } from '@/lib/preferences'
import { useAiStatus, useChannels, useMembers } from '@/lib/queries'
import { send } from '@/lib/realtime'
import { useOrgContext } from '../org-context'
import { useIsMac } from '../shell/command-palette'
import { ALL_EMOJI } from './emoji'
import { EmojiPicker } from './emoji-picker'
import { PollButton } from './poll'

// ---------------------------------------------------------------------------
// Wire format <-> editor format
// Mentions carry an explicit `kind` on the wire; Tiptap tracks the trigger char.
// ---------------------------------------------------------------------------

export function toWireDoc(json: JSONContent): DocNode {
  const walk = (n: JSONContent): JSONContent => {
    if (n.type === 'mention') {
      const char = n.attrs?.mentionSuggestionChar
      const kind = char === '#' ? 'channel' : n.attrs?.id === 'here' ? 'here' : 'user'
      return { type: 'mention', attrs: { id: n.attrs?.id, label: n.attrs?.label ?? '', kind } }
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n
  }
  return walk(json) as unknown as DocNode
}

export function fromWireDoc(doc: DocNode): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    if (n.type === 'mention') {
      return {
        type: 'mention',
        attrs: {
          id: n.attrs?.id,
          label: n.attrs?.label,
          mentionSuggestionChar: n.attrs?.kind === 'channel' ? '#' : '@',
        },
      }
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n
  }
  return walk(doc as unknown as JSONContent)
}

const isEmpty = (j: JSONContent) => !JSON.stringify(j).match(/"text":"[^"]*\S|"type":"mention"/)

// ---------------------------------------------------------------------------

type SuggestionItem = {
  id: string
  label: string
  sub?: string
  avatar?: { name: string; src: string | null }
  /** Emoji suggestions: the Unicode character, or a custom emoji's image. */
  emoji?: string
  emojiUrl?: string
}
type SuggestionChar = '@' | '#' | '/' | ':'
type SuggestionState = { char: SuggestionChar; props: SuggestionProps<SuggestionItem> } | null

interface PendingFile {
  key: string
  file: File
  progress: number
  result?: Attachment
  error?: string
  abort?: () => void
}

export interface ComposerHandle {
  focus: () => void
  insertText: (t: string) => void
}

export interface ComposerProps {
  channel: Channel
  parentId?: string | null
  placeholder: string
  disabledReason?: string | null
  initial?: DocNode | null
  /** Edit mode: no attachments or scheduling; Escape cancels. */
  mode?: 'send' | 'edit'
  onSubmit: (body: DocNode, fileIds: string[], files: Attachment[]) => Promise<void> | void
  onSchedule?: (body: DocNode, sendAt: Date) => Promise<void>
  onCancel?: () => void
  onDraftChange?: (body: DocNode | null) => void
  compact?: boolean
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    channel,
    parentId = null,
    placeholder,
    disabledReason,
    initial,
    mode = 'send',
    onSubmit,
    onSchedule,
    onCancel,
    onDraftChange,
    compact,
  },
  ref,
) {
  const { org, api, me } = useOrgContext()
  const members = useMembers(org.id)
  const channels = useChannels(org.id)
  const { assistant } = useAiStatus(org.id)
  const customEmojis = useCustomEmojis()
  const commands = useQuery({
    queryKey: ['plugin-commands', org.id],
    queryFn: ({ signal }) => get<PluginCommand[]>(`${api}/plugin-commands`, signal),
    staleTime: 60_000,
    enabled: mode === 'send',
  })
  const [showToolbar, setShowToolbar] = useState(!compact)
  const [files, setFiles] = useState<PendingFile[]>([])
  const [sug, setSug] = useState<SuggestionState>(null)
  const [sugIndex, setSugIndex] = useState(0)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [empty, setEmpty] = useState(true)
  const isMac = useIsMac()
  const sendHint =
    usePreference('sendKey') === 'mod-enter' ? `${isMac ? '⌘' : 'Ctrl'}+Enter` : 'Enter'
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Refs read by editor callbacks, which are created once.
  const r = useRef({
    sug,
    sugIndex,
    submit: () => {},
    onDraftChange,
    membersData: members.data,
    channelsData: channels.data,
    commands: commands.data,
    emojis: customEmojis.data,
    lastTyping: 0,
    assistant,
  })
  r.current.assistant = assistant
  r.current.emojis = customEmojis.data
  r.current.commands = commands.data
  r.current.sug = sug
  r.current.sugIndex = sugIndex
  r.current.onDraftChange = onDraftChange
  r.current.membersData = members.data
  r.current.channelsData = channels.data

  const suggestionConfig = (char: SuggestionChar) => ({
    char,
    allowSpaces: false,
    ...(char === ':' && {
      // Emoji go in as text: the character itself, or `:name:` for custom emoji.
      command: ({
        editor,
        range,
        props,
      }: {
        editor: {
          chain: () => {
            focus: () => { insertContentAt: (r: unknown, c: string) => { run: () => boolean } }
          }
        }
        range: unknown
        props: SuggestionItem
      }) =>
        editor
          .chain()
          .focus()
          .insertContentAt(range, `${props.emoji ?? props.label} `)
          .run(),
    }),
    ...(char === '/' && {
      startOfLine: true,
      // Commands are typed as plain text ("/remind …"), not inserted as mention chips.
      command: ({
        editor,
        range,
        props,
      }: {
        editor: {
          chain: () => {
            focus: () => { insertContentAt: (r: unknown, c: string) => { run: () => boolean } }
          }
        }
        range: unknown
        props: SuggestionItem
      }) => editor.chain().focus().insertContentAt(range, `/${props.id} `).run(),
    }),
    items: ({ query }: { query: string }): SuggestionItem[] => {
      const q = query.toLowerCase()
      if (char === ':') {
        if (q.length < 2) return []
        const custom = (r.current.emojis ?? [])
          .filter((e) => e.name.includes(q))
          .map((e) => ({ id: e.id, label: `:${e.name}:`, emojiUrl: e.url }))
        const std = ALL_EMOJI.filter(([, words]) => words.split(' ').some((w) => w.startsWith(q)))
          .slice(0, 8)
          .map(([e, words]) => ({ id: e, label: `:${words.split(' ')[0]}:`, emoji: e }))
        return [...custom, ...std].slice(0, 8)
      }
      if (char === '/') {
        const all = [
          ...BUILTIN_COMMANDS.map((c) => ({
            id: c.command,
            label: `/${c.command}`,
            sub: c.description,
          })),
          ...(r.current.commands ?? [])
            .filter((c) => c.channelIds.includes(channel.id))
            .map((c) => ({
              id: c.command,
              label: `/${c.command}`,
              sub: `${c.plugin.name}: ${c.description}`,
            })),
        ]
        const seen = new Set<string>()
        return all
          .filter((c) => c.id.startsWith(q) && !seen.has(c.id) && seen.add(c.id))
          .slice(0, 8)
      }
      if (char === '#') {
        return (r.current.channelsData ?? [])
          .filter(
            (c) =>
              (c.kind === 'public' || c.kind === 'private') && !c.archivedAt && c.name?.includes(q),
          )
          .slice(0, 8)
          .map((c) => ({
            id: c.id,
            label: c.name!,
            sub: c.kind === 'private' ? 'Private' : undefined,
          }))
      }
      const people: SuggestionItem[] = (r.current.membersData ?? [])
        .filter(
          (m: Member) =>
            m.id !== me.id &&
            (m.name.toLowerCase().includes(q) || (m.displayName ?? '').toLowerCase().includes(q)),
        )
        .slice(0, 8)
        .map((m) => ({
          id: m.id,
          label: displayName(m),
          sub: m.title ?? undefined,
          avatar: { name: m.name, src: m.avatarUrl },
        }))
      const bot = r.current.assistant
      const claude =
        bot && 'claude'.startsWith(q)
          ? [
              {
                id: bot.id,
                label: 'Claude',
                sub: 'AI assistant · answers in a thread',
                avatar: { name: 'Claude', src: bot.avatarUrl },
              },
            ]
          : []
      const here =
        'here'.startsWith(q) || 'channel'.startsWith(q)
          ? [{ id: 'here', label: 'here', sub: 'Notify everyone in this conversation' }]
          : []
      return [...claude, ...people, ...here]
    },
    render: () => ({
      onStart: (props: SuggestionProps<SuggestionItem>) => {
        setSugIndex(0)
        setSug({ char, props })
      },
      onUpdate: (props: SuggestionProps<SuggestionItem>) => {
        setSugIndex(0)
        setSug({ char, props })
      },
      onExit: () => setSug(null),
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        const s = r.current.sug
        if (!s) return false
        const n = s.props.items.length
        if (event.key === 'ArrowDown') {
          setSugIndex((i) => (n ? (i + 1) % n : 0))
          return true
        }
        if (event.key === 'ArrowUp') {
          setSugIndex((i) => (n ? (i - 1 + n) % n : 0))
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = s.props.items[r.current.sugIndex]
          if (item) s.props.command(item)
          return !!item
        }
        if (event.key === 'Escape') {
          setSug(null)
          return true
        }
        return false
      },
    }),
  })

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabledReason,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        underline: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          protocols: ['http', 'https', 'mailto'],
          defaultProtocol: 'https',
        },
      }),
      Placeholder.configure({ placeholder }),
      Mention.configure({
        HTMLAttributes: { class: 'q-mention' },
        renderText: ({ node }) => `${node.attrs.mentionSuggestionChar}${node.attrs.label}`,
        renderHTML: ({ node, options }) => [
          'span',
          options.HTMLAttributes,
          `${node.attrs.mentionSuggestionChar}${node.attrs.label}`,
        ],
        suggestions: [
          suggestionConfig('@'),
          suggestionConfig('#'),
          suggestionConfig(':'),
          ...(mode === 'send' ? [suggestionConfig('/')] : []),
        ] as MentionOptions['suggestions'],
      }),
      Extension.create({
        name: 'quidKeys',
        addKeyboardShortcuts() {
          return {
            Enter: ({ editor }) => {
              if (r.current.sug) return false
              if (editor.isActive('codeBlock')) return false
              // With "Ctrl/⌘ + Enter to send", Enter is a new line.
              if (getPreferences().sendKey === 'mod-enter') return false
              r.current.submit()
              return true
            },
            'Mod-Enter': () => {
              r.current.submit()
              return true
            },
            Escape: () => {
              if (mode === 'edit') onCancel?.()
              return mode === 'edit'
            },
          }
        },
      }),
    ],
    content: initial ? fromWireDoc(initial) : undefined,
    editorProps: {
      // A function so the spellcheck preference applies without recreating the editor.
      attributes: () => ({
        'aria-label': placeholder,
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: String(getPreferences().spellcheck),
        class: 'q-msg-text',
      }),
      handlePaste: (_view, event) => {
        const pasted = [...(event.clipboardData?.files ?? [])]
        if (pasted.length && mode === 'send') {
          addFiles(pasted)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      const e = isEmpty(json)
      setEmpty(e)
      r.current.onDraftChange?.(e ? null : toWireDoc(json))
      const now = Date.now()
      if (!e && now - r.current.lastTyping > 3000) {
        r.current.lastTyping = now
        send({ type: 'typing', channelId: channel.id, parentId })
      }
    },
  })

  useEffect(() => {
    editor?.setEditable(!disabledReason)
  }, [editor, disabledReason])

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus('end'),
    insertText: (t) => editor?.chain().focus().insertContent(t).run(),
  }))

  useEffect(() => {
    if (editor && initial) setEmpty(isEmpty(editor.getJSON()))
  }, [editor, initial])

  const uploading = files.some((f) => !f.result && !f.error)

  const addFiles = (list: File[]) => {
    for (const file of list) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name} is larger than 4 MB.`)
        continue
      }
      const key = `${file.name}-${file.size}-${Math.random()}`
      const { promise, abort } = upload<Attachment>(
        `${api}/files?channelId=${channel.id}`,
        file,
        (progress) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, progress } : f))),
      )
      setFiles((fs) => [...fs, { key, file, progress: 0, abort }].slice(0, 10))
      promise
        .then((result) =>
          setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, result, progress: 100 } : f))),
        )
        .catch((e: Error) =>
          setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, error: e.message } : f))),
        )
    }
  }

  const submit = async () => {
    if (!editor || disabledReason) return
    const json = editor.getJSON()
    const ready = files.filter((f) => f.result)
    if (isEmpty(json) && ready.length === 0) return
    if (uploading) {
      toast.info('Wait for uploads to finish.')
      return
    }
    const body = toWireDoc(json)
    const attachments = ready.map((f) => f.result!)
    editor.commands.clearContent(true)
    setFiles([])
    setEmpty(true)
    try {
      await onSubmit(
        body,
        attachments.map((a) => a.id),
        attachments,
      )
    } catch {
      // Callers surface errors; restore the text so nothing is lost.
      if (mode === 'edit') editor.commands.setContent(fromWireDoc(body))
    }
    editor.commands.focus()
  }
  r.current.submit = () => void submit()

  const schedule = async (when: Date) => {
    if (!editor || !onSchedule) return
    const json = editor.getJSON()
    if (isEmpty(json)) return toast.info('Write a message to schedule.')
    await onSchedule(toWireDoc(json), when)
    editor.commands.clearContent(true)
    setEmpty(true)
  }

  const presets = useMemo(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    const monday = new Date()
    monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7))
    monday.setHours(9, 0, 0, 0)
    return [
      { label: 'Tomorrow at 9:00', at: tomorrow },
      { label: `Monday at 9:00`, at: monday },
    ]
  }, [])
  const [customAt, setCustomAt] = useState('')

  const fmt = (
    cmd: () => boolean,
    name: string,
    Icon: typeof Bold,
    label: string,
    shortcut?: string,
    attrs?: Record<string, unknown>,
  ) => (
    <Tooltip content={label} shortcut={shortcut}>
      <IconButton
        label={label}
        size="sm"
        active={editor?.isActive(name, attrs) ?? false}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => cmd()}
        disabled={!!disabledReason}
      >
        <Icon />
      </IconButton>
    </Tooltip>
  )

  if (disabledReason && mode === 'send') {
    return (
      <div className="mx-4 mb-4 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-center text-[13px] text-fg-muted md:mx-5">
        {disabledReason}
      </div>
    )
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop target; the attach button is the accessible path
    <div
      className={cn('relative', mode === 'send' ? 'px-4 pb-4 md:px-5' : '')}
      onDragOver={(e) => {
        if (mode === 'send' && e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (mode !== 'send') return
        e.preventDefault()
        setDragging(false)
        addFiles([...e.dataTransfer.files])
      }}
    >
      {sug && sug.props.items.length > 0 && (
        <div
          role="listbox"
          aria-label="Suggestions"
          className="absolute bottom-full left-4 z-30 mb-1 w-72 animate-in rounded-lg border border-border bg-bg-overlay p-1 shadow-pop md:left-5"
        >
          <p className="px-2 pt-1 pb-1.5 text-2xs font-medium text-fg-subtle">
            {sug.char === '#'
              ? 'Channels'
              : sug.char === '/'
                ? 'Commands'
                : sug.char === ':'
                  ? 'Emoji'
                  : 'People'}
          </p>
          {sug.props.items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === sugIndex}
              onMouseDown={(e) => {
                e.preventDefault()
                sug.props.command(item)
              }}
              onMouseEnter={() => setSugIndex(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                i === sugIndex && 'bg-bg-muted',
              )}
            >
              {item.emojiUrl ? (
                <img src={item.emojiUrl} alt="" className="size-5 object-contain" />
              ) : item.emoji ? (
                <span className="flex size-5 items-center justify-center text-base">
                  {item.emoji}
                </span>
              ) : sug.char === '/' ? (
                <SquareSlash className="size-4 text-fg-subtle" />
              ) : sug.char === '#' ? (
                <Hash className="size-4 text-fg-subtle" />
              ) : item.avatar ? (
                <Avatar name={item.avatar.name} id={item.id} src={item.avatar.src} size="xs" />
              ) : (
                <AtSign className="size-4 text-fg-subtle" />
              )}
              <span className="font-medium">{item.label}</span>
              {item.sub && <span className="truncate text-xs text-fg-subtle">{item.sub}</span>}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          'rounded-xl border border-border-strong bg-bg shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,box-shadow] focus-within:border-fg-subtle',
          dragging && 'border-accent ring-3 ring-accent/15',
          mode === 'edit' && 'rounded-lg',
        )}
      >
        {showToolbar && editor && (
          <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
            {fmt(() => editor.chain().focus().toggleBold().run(), 'bold', Bold, 'Bold', '⌘B')}
            {fmt(
              () => editor.chain().focus().toggleItalic().run(),
              'italic',
              Italic,
              'Italic',
              '⌘I',
            )}
            {fmt(
              () => editor.chain().focus().toggleStrike().run(),
              'strike',
              Strikethrough,
              'Strikethrough',
              '⌘⇧S',
            )}
            <span className="mx-1 h-4 w-px bg-border" />
            <Popover open={linkOpen} onOpenChange={setLinkOpen}>
              <PopoverTrigger asChild>
                <IconButton
                  label="Link"
                  size="sm"
                  active={editor.isActive('link')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setLinkUrl(editor.getAttributes('link').href ?? '')}
                >
                  <Link2 />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-72 p-2">
                <form
                  className="flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const url = linkUrl.trim()
                    if (!url) editor.chain().focus().unsetLink().run()
                    else {
                      const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`
                      if (editor.state.selection.empty)
                        editor
                          .chain()
                          .focus()
                          .insertContent({
                            type: 'text',
                            text: url,
                            marks: [{ type: 'link', attrs: { href } }],
                          })
                          .run()
                      else editor.chain().focus().setLink({ href }).run()
                    }
                    setLinkOpen(false)
                  }}
                >
                  <Input
                    autoFocus
                    className="h-8"
                    placeholder="https://"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                  />
                  <Button size="sm" type="submit" variant="primary" className="h-8">
                    Save
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
            <span className="mx-1 h-4 w-px bg-border" />
            {fmt(
              () => editor.chain().focus().toggleOrderedList().run(),
              'orderedList',
              ListOrdered,
              'Numbered list',
            )}
            {fmt(
              () => editor.chain().focus().toggleBulletList().run(),
              'bulletList',
              List,
              'Bulleted list',
            )}
            <span className="mx-1 h-4 w-px bg-border" />
            {fmt(
              () => editor.chain().focus().toggleBlockquote().run(),
              'blockquote',
              Quote,
              'Quote',
            )}
            {fmt(() => editor.chain().focus().toggleCode().run(), 'code', Code, 'Code', '⌘E')}
            {fmt(
              () => editor.chain().focus().toggleCodeBlock().run(),
              'codeBlock',
              SquareCode,
              'Code block',
              '⌘⌥C',
            )}
          </div>
        )}

        <div className="q-editor px-3 pt-2.5 pb-1">
          <EditorContent editor={editor} />
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-1 pb-2">
            {files.map((f) => (
              <div
                key={f.key}
                className={cn(
                  'relative flex h-12 w-56 items-center gap-2 overflow-hidden rounded-lg border border-border bg-bg-subtle px-2',
                  f.error && 'border-danger/40',
                )}
              >
                {f.result?.isImage ? (
                  <img
                    src={f.result.thumbnailUrl ?? f.result.url}
                    alt=""
                    className="size-8 rounded object-cover"
                  />
                ) : (
                  <FileText className="size-6 shrink-0 text-fg-subtle" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{f.file.name}</p>
                  <p className={cn('text-2xs text-fg-subtle', f.error && 'text-danger')}>
                    {f.error ?? (f.result ? fileSize(f.file.size) : `Uploading… ${f.progress}%`)}
                  </p>
                </div>
                <IconButton
                  label="Remove attachment"
                  size="sm"
                  onClick={() => {
                    f.abort?.()
                    setFiles((fs) => fs.filter((x) => x.key !== f.key))
                  }}
                >
                  <X />
                </IconButton>
                {!f.result && !f.error && (
                  <span
                    className="absolute bottom-0 left-0 h-0.5 bg-accent transition-[width]"
                    style={{ width: `${f.progress}%` }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          {mode === 'send' && (
            <>
              <Tooltip content="Attach files">
                <IconButton
                  label="Attach files"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip />
                </IconButton>
              </Tooltip>
              {!parentId && <PollButton channel={channel} />}
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  addFiles([...(e.target.files ?? [])])
                  e.target.value = ''
                }}
              />
            </>
          )}
          <Tooltip content={showToolbar ? 'Hide formatting' : 'Show formatting'}>
            <IconButton
              label="Formatting"
              size="sm"
              active={showToolbar}
              onClick={() => setShowToolbar((s) => !s)}
            >
              <Type />
            </IconButton>
          </Tooltip>
          <EmojiPicker onPick={(e) => editor?.chain().focus().insertContent(e).run()}>
            <IconButton label="Emoji" size="sm">
              <Smile />
            </IconButton>
          </EmojiPicker>
          <Tooltip content="Mention someone">
            <IconButton
              label="Mention someone"
              size="sm"
              onClick={() => editor?.chain().focus().insertContent(' @').run()}
            >
              <AtSign />
            </IconButton>
          </Tooltip>

          <div className="ml-auto flex items-center gap-1.5">
            {mode === 'edit' ? (
              <>
                <span className="hidden text-2xs text-fg-subtle sm:inline">
                  Esc to cancel · {sendHint} to save
                </span>
                <Button size="sm" onClick={onCancel}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" onClick={() => void submit()}>
                  Save
                </Button>
              </>
            ) : (
              <div
                className={cn(
                  'flex h-7 items-center overflow-hidden rounded-md',
                  empty && !files.some((f) => f.result)
                    ? 'bg-bg-muted text-fg-subtle'
                    : 'bg-accent text-accent-fg',
                )}
              >
                <button
                  type="button"
                  aria-label="Send message"
                  title={`Send (${sendHint})`}
                  className="flex h-7 w-8 items-center justify-center disabled:opacity-60"
                  disabled={uploading}
                  onClick={() => void submit()}
                >
                  <SendHorizontal className="size-4" />
                </button>
                {onSchedule && (
                  <Menu>
                    <MenuTrigger
                      aria-label="Schedule message"
                      className="flex h-7 w-6 items-center justify-center border-l border-current/20 outline-none"
                    >
                      <ChevronDown className="size-3.5" />
                    </MenuTrigger>
                    <MenuContent align="end" side="top" className="w-60">
                      <MenuLabel>Schedule message</MenuLabel>
                      {presets.map((p) => (
                        <MenuItem key={p.label} onSelect={() => void schedule(p.at)}>
                          {p.label}
                        </MenuItem>
                      ))}
                      <div className="flex gap-1 p-1">
                        <input
                          type="datetime-local"
                          aria-label="Custom time"
                          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-1.5 text-xs"
                          value={customAt}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => setCustomAt(e.target.value)}
                        />
                        <Button
                          size="sm"
                          className="h-7"
                          disabled={!customAt}
                          onClick={() => customAt && void schedule(new Date(customAt))}
                        >
                          Set
                        </Button>
                      </div>
                    </MenuContent>
                  </Menu>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-x-4 -top-8 text-center text-xs font-medium text-accent-text md:inset-x-5">
          Drop files to attach
        </div>
      )}
    </div>
  )
})
