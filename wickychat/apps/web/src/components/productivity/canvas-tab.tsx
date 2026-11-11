'use client'
import type { Canvas, Channel } from '@quid/shared'
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Tooltip,
  toast,
} from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  ArrowLeft,
  Bold,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  PenTool,
  Plus,
  Quote,
  SquareCode,
  Strikethrough,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, del, errorMessage, get, patch, post } from '@/lib/api'
import { displayName, relative } from '@/lib/format'
import { pkeys, useCanvas, useCanvases } from '@/lib/productivity'
import { useOrgContext } from '../org-context'
import { Whiteboard } from './whiteboard'

const TEMPLATES: { title: string; body: JSONContent }[] = [
  { title: 'Untitled', body: { type: 'doc', content: [{ type: 'paragraph' }] } },
  {
    title: 'Meeting notes',
    body: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Agenda' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
        { type: 'paragraph' },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Action items' }] },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] },
          ],
        },
      ],
    },
  },
  {
    title: 'Project spec',
    body: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Problem' }] },
        { type: 'paragraph' },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goals' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Open questions' }],
        },
        { type: 'paragraph' },
      ],
    },
  },
]

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  const c = () => editor.chain().focus()
  const items: [string, React.ReactNode, () => void, boolean][] = [
    [
      'Heading 1',
      <Heading1 key="h1" />,
      () => c().toggleHeading({ level: 1 }).run(),
      editor.isActive('heading', { level: 1 }),
    ],
    [
      'Heading 2',
      <Heading2 key="h2" />,
      () => c().toggleHeading({ level: 2 }).run(),
      editor.isActive('heading', { level: 2 }),
    ],
    [
      'Heading 3',
      <Heading3 key="h3" />,
      () => c().toggleHeading({ level: 3 }).run(),
      editor.isActive('heading', { level: 3 }),
    ],
    ['Bold', <Bold key="b" />, () => c().toggleBold().run(), editor.isActive('bold')],
    ['Italic', <Italic key="i" />, () => c().toggleItalic().run(), editor.isActive('italic')],
    [
      'Strikethrough',
      <Strikethrough key="s" />,
      () => c().toggleStrike().run(),
      editor.isActive('strike'),
    ],
    ['Code', <Code key="c" />, () => c().toggleCode().run(), editor.isActive('code')],
    [
      'Bulleted list',
      <List key="ul" />,
      () => c().toggleBulletList().run(),
      editor.isActive('bulletList'),
    ],
    [
      'Numbered list',
      <ListOrdered key="ol" />,
      () => c().toggleOrderedList().run(),
      editor.isActive('orderedList'),
    ],
    [
      'Checklist',
      <ListChecks key="tl" />,
      () => c().toggleTaskList().run(),
      editor.isActive('taskList'),
    ],
    ['Quote', <Quote key="q" />, () => c().toggleBlockquote().run(), editor.isActive('blockquote')],
    [
      'Code block',
      <SquareCode key="cb" />,
      () => c().toggleCodeBlock().run(),
      editor.isActive('codeBlock'),
    ],
    ['Divider', <Minus key="hr" />, () => c().setHorizontalRule().run(), false],
  ]
  return (
    <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
      {items.map(([label, icon, run, active], i) => (
        <span key={label} className="contents">
          {(i === 3 || i === 7 || i === 10) && <span className="mx-1 h-4 w-px bg-border" />}
          <Tooltip content={label}>
            <IconButton
              label={label}
              size="sm"
              className={cn('size-7', active && 'bg-bg-emphasis text-fg')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={run}
            >
              {icon}
            </IconButton>
          </Tooltip>
        </span>
      ))}
    </div>
  )
}

/** One canvas: title, toolbar and editor, saved as you type. */
function CanvasEditor({
  canvas,
  canEdit,
  onBack,
}: {
  canvas: Canvas
  canEdit: boolean
  onBack: () => void
}) {
  const { api, me } = useOrgContext()
  const qc = useQueryClient()
  const version = useRef(canvas.version)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [conflict, setConflict] = useState(false)
  const [title, setTitle] = useState(canvas.title)
  const [meta, setMeta] = useState({ at: canvas.updatedAt, by: canvas.updatedBy })

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        underline: false,
        link: { openOnClick: true, autolink: true, protocols: ['http', 'https', 'mailto'] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Heading' : 'Write notes, agendas or specs…',
      }),
    ],
    content: canvas.body as JSONContent,
    editorProps: { attributes: { 'aria-label': `Canvas ${canvas.title}` } },
    onUpdate: () => {
      dirty.current = true
      setStatus('unsaved')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), 900)
    },
  })

  const save = useCallback(
    async (extra: { title?: string } = {}) => {
      if (!editor) return
      setStatus('saving')
      try {
        const saved = await patch<Canvas>(`${api}/canvases/${canvas.id}`, {
          version: version.current,
          ...(dirty.current && { body: editor.getJSON() }),
          ...extra,
        })
        version.current = saved.version
        dirty.current = false
        setStatus('saved')
        setMeta({ at: saved.updatedAt, by: saved.updatedBy })
        qc.setQueryData(pkeys.canvas(canvas.id), saved)
        void qc.invalidateQueries({ queryKey: pkeys.canvases(canvas.channelId) })
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setConflict(true)
          setStatus('unsaved')
        } else {
          setStatus('unsaved')
          toast.error(errorMessage(e))
        }
      }
    },
    [api, canvas.id, canvas.channelId, editor, qc],
  )

  const reload = useCallback(async () => {
    const fresh = await get<Canvas>(`${api}/canvases/${canvas.id}`)
    version.current = fresh.version
    dirty.current = false
    editor?.commands.setContent(fresh.body as JSONContent, { emitUpdate: false })
    setTitle(fresh.title)
    setMeta({ at: fresh.updatedAt, by: fresh.updatedBy })
    setStatus('saved')
    setConflict(false)
  }, [api, canvas.id, editor])

  // Someone else saved: pick up their version, unless we're mid-edit.
  useEffect(() => {
    const on = (ev: Event) => {
      const e = (
        ev as CustomEvent<{
          canvasId: string
          version: number
          updatedBy: string | null
          deleted?: boolean
        }>
      ).detail
      if (e.canvasId !== canvas.id || e.updatedBy === me.id || e.version <= version.current) return
      if (e.deleted) return onBack()
      if (dirty.current) setConflict(true)
      else void reload()
    }
    window.addEventListener('quid:canvas', on)
    return () => window.removeEventListener('quid:canvas', on)
  }, [canvas.id, me.id, reload, onBack])

  // Save on the way out.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (dirty.current) void save()
    },
    [save],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 md:px-6">
        <IconButton label="All canvases" size="sm" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        {canEdit && <Toolbar editor={editor} />}
        <span className="ml-auto text-xs text-fg-subtle" aria-live="polite">
          {status === 'saving'
            ? 'Saving…'
            : status === 'unsaved'
              ? 'Unsaved changes'
              : `Saved · ${meta.by ? `${displayName(meta.by)}, ` : ''}${relative(meta.at)}`}
        </span>
      </div>
      {conflict && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/10 px-6 py-2 text-[13px]">
          <span className="flex-1">Someone else just edited this canvas.</span>
          <Button size="sm" onClick={() => void reload()}>
            Load their version
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              const fresh = await get<Canvas>(`${api}/canvases/${canvas.id}`)
              version.current = fresh.version
              dirty.current = true
              setConflict(false)
              await save()
            }}
          >
            Keep mine
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-8 md:px-10">
          <input
            aria-label="Canvas title"
            value={title}
            readOnly={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim()
              if (t && t !== canvas.title) void save({ title: t })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
            className="w-full bg-transparent text-3xl font-semibold tracking-[-0.03em] outline-none placeholder:text-fg-subtle"
            placeholder="Untitled"
          />
          <EditorContent editor={editor} className="q-canvas q-prose mt-4" />
        </div>
      </div>
    </div>
  )
}

export function CanvasTab({ channel, canEdit }: { channel: Channel; canEdit: boolean }) {
  const { api } = useOrgContext()
  const qc = useQueryClient()
  const list = useCanvases(channel.id)
  const [openId, setOpenId] = useState<string | null>(null)
  const canvas = useCanvas(openId)
  const [creating, setCreating] = useState(false)

  const create = async (tpl: (typeof TEMPLATES)[number] | 'whiteboard') => {
    setCreating(true)
    try {
      const c = await post<Canvas>(
        `${api}/channels/${channel.id}/canvases`,
        tpl === 'whiteboard'
          ? { title: 'Untitled whiteboard', kind: 'whiteboard' }
          : { title: tpl.title === 'Untitled' ? 'Untitled canvas' : tpl.title, body: tpl.body },
      )
      qc.setQueryData(pkeys.canvas(c.id), c)
      void qc.invalidateQueries({ queryKey: pkeys.canvases(channel.id) })
      setOpenId(c.id)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  if (openId) {
    if (!canvas.data)
      return (
        <div className="mx-auto w-full max-w-3xl p-10">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="mt-6 h-64" />
        </div>
      )
    const back = () => {
      setOpenId(null)
      void qc.invalidateQueries({ queryKey: pkeys.canvas(openId) })
    }
    if (canvas.data.kind === 'whiteboard')
      return (
        <Whiteboard key={canvas.data.id} canvas={canvas.data} canEdit={canEdit} onBack={back} />
      )
    return (
      <CanvasEditor
        key={canvas.data.id}
        canvas={canvas.data}
        canEdit={canEdit}
        onBack={() => {
          setOpenId(null)
          void qc.invalidateQueries({ queryKey: pkeys.canvas(openId) })
        }}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Canvases</h2>
            <p className="text-[13px] text-fg-muted">
              Shared docs and whiteboards for notes, specs, diagrams and charts. Everyone in the
              channel can edit, live.
            </p>
          </div>
          {canEdit && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="primary" loading={creating}>
                  <Plus /> New canvas
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<PenTool />} onSelect={() => void create('whiteboard')}>
                  Whiteboard
                </MenuItem>
                <MenuSeparator />
                {TEMPLATES.map((t) => (
                  <MenuItem key={t.title} icon={<FileText />} onSelect={() => void create(t)}>
                    {t.title === 'Untitled' ? 'Blank doc' : t.title}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </div>
        {list.isLoading ? (
          <Skeleton className="h-40" />
        ) : !list.data?.length ? (
          <EmptyState
            emoji="📝"
            title="A blank canvas awaits"
            description="Keep meeting notes, plans and specs right next to the conversation."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.data.map((c) => (
              <li key={c.id} className="q-lift group relative rounded-xl">
                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className="flex h-full w-full flex-col rounded-xl border border-border bg-bg p-4 text-left transition-colors hover:border-border-strong hover:bg-bg-subtle"
                >
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    {c.kind === 'whiteboard' ? (
                      <PenTool className="size-4 text-accent-text" />
                    ) : (
                      <FileText className="size-4 text-accent-text" />
                    )}
                    <span className="truncate">{c.title}</span>
                  </span>
                  <span className="mt-1.5 line-clamp-3 min-h-[3.6em] text-[12.5px] text-fg-muted">
                    {c.preview || (c.kind === 'whiteboard' ? 'Whiteboard' : 'Empty')}
                  </span>
                  <span className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
                    {c.updatedBy && (
                      <Avatar
                        name={c.updatedBy.name}
                        id={c.updatedBy.id}
                        src={c.updatedBy.avatarUrl}
                        decoration={c.updatedBy.decoration}
                        size="xs"
                      />
                    )}
                    Edited {relative(c.updatedAt)}
                  </span>
                </button>
                {canEdit && (
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton
                        label="Canvas actions"
                        size="sm"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        <MoreHorizontal />
                      </IconButton>
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem
                        danger
                        icon={<Trash2 />}
                        onSelect={async () => {
                          try {
                            await del(`${api}/canvases/${c.id}`)
                            void list.refetch()
                          } catch (e) {
                            toast.error(errorMessage(e))
                          }
                        }}
                      >
                        Delete canvas
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
