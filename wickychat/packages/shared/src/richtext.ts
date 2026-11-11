/**
 * Message bodies are stored as a restricted ProseMirror/Tiptap JSON document.
 * The server validates every document against this whitelist, so clients can
 * render bodies without ever injecting HTML.
 */
import { z } from 'zod'

export const MAX_MESSAGE_TEXT = 40_000
const MAX_DEPTH = 8
const MAX_NODES = 5_000

const MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'link'] as const

export const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({ type: z.literal('strike') }),
  z.object({ type: z.literal('code') }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: z
        .string()
        .max(2048)
        .refine((v) => /^(https?:|mailto:)/i.test(v), 'Only http(s) and mailto links are allowed'),
    }),
  }),
])
export type Mark = z.infer<typeof markSchema>

export const MENTION_KINDS = ['user', 'channel', 'here'] as const
export type MentionKind = (typeof MENTION_KINDS)[number]

export interface TextNode {
  type: 'text'
  text: string
  marks?: Mark[]
}
export interface MentionNode {
  type: 'mention'
  attrs: { id: string; label: string; kind: MentionKind }
}
export interface HardBreakNode {
  type: 'hardBreak'
}
export interface EmojiNode {
  type: 'emoji'
  attrs: { name: string }
}
export type InlineNode = TextNode | MentionNode | HardBreakNode | EmojiNode

export interface ParagraphNode {
  type: 'paragraph'
  content?: InlineNode[]
}
export interface CodeBlockNode {
  type: 'codeBlock'
  attrs?: { language?: string | null }
  content?: TextNode[]
}
export interface BlockquoteNode {
  type: 'blockquote'
  content?: BlockNode[]
}
export interface ListItemNode {
  type: 'listItem'
  content?: BlockNode[]
}
export interface BulletListNode {
  type: 'bulletList'
  content?: ListItemNode[]
}
export interface OrderedListNode {
  type: 'orderedList'
  attrs?: { start?: number }
  content?: ListItemNode[]
}
/** Canvas-only blocks (see `sanitizeDoc(…, { rich: true })`). */
export interface HeadingNode {
  type: 'heading'
  attrs: { level: 1 | 2 | 3 }
  content?: InlineNode[]
}
export interface TaskItemNode {
  type: 'taskItem'
  attrs: { checked: boolean }
  content?: BlockNode[]
}
export interface TaskListNode {
  type: 'taskList'
  content?: TaskItemNode[]
}
export interface HorizontalRuleNode {
  type: 'horizontalRule'
}
export type BlockNode =
  | ParagraphNode
  | CodeBlockNode
  | BlockquoteNode
  | BulletListNode
  | OrderedListNode
  | HeadingNode
  | TaskListNode
  | HorizontalRuleNode

export interface DocNode {
  type: 'doc'
  content: BlockNode[]
}

const BLOCKS = new Set(['paragraph', 'codeBlock', 'blockquote', 'bulletList', 'orderedList'])
const RICH_BLOCKS = new Set([...BLOCKS, 'heading', 'taskList', 'horizontalRule'])
/** Canvases are documents, so they may be much longer than a message. */
export const MAX_CANVAS_TEXT = 200_000

class DocError extends Error {}

function assertObject(v: unknown): asserts v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DocError('Invalid node')
}

/**
 * Validates and normalizes an untrusted document. Unknown keys are dropped.
 * Throws a DocError with a readable message on invalid input.
 */
export function sanitizeDoc(input: unknown, opts: { rich?: boolean } = {}): DocNode {
  let count = 0
  const allowed = opts.rich ? RICH_BLOCKS : BLOCKS
  const maxNodes = opts.rich ? MAX_NODES * 10 : MAX_NODES
  const bump = () => {
    if (++count > maxNodes)
      throw new DocError(opts.rich ? 'Canvas is too long' : 'Message is too complex')
  }

  const inline = (n: unknown, allowMarks = true): InlineNode => {
    assertObject(n)
    bump()
    switch (n.type) {
      case 'text': {
        if (typeof n.text !== 'string' || n.text.length === 0) throw new DocError('Invalid text')
        const out: TextNode = { type: 'text', text: n.text }
        if (Array.isArray(n.marks) && n.marks.length > 0) {
          if (!allowMarks) throw new DocError('Formatting is not allowed here')
          const seen = new Set<string>()
          out.marks = n.marks.map((m) => {
            const parsed = markSchema.safeParse(m)
            if (!parsed.success) throw new DocError('Invalid formatting')
            if (!MARK_TYPES.includes(parsed.data.type) || seen.has(parsed.data.type)) {
              throw new DocError('Invalid formatting')
            }
            seen.add(parsed.data.type)
            return parsed.data
          })
        }
        return out
      }
      case 'mention': {
        assertObject(n.attrs)
        const { id, label, kind } = n.attrs
        if (typeof id !== 'string' || id.length > 64) throw new DocError('Invalid mention')
        if (typeof label !== 'string' || label.length > 200) throw new DocError('Invalid mention')
        if (!MENTION_KINDS.includes(kind as MentionKind)) throw new DocError('Invalid mention')
        return { type: 'mention', attrs: { id, label, kind: kind as MentionKind } }
      }
      case 'emoji': {
        assertObject(n.attrs)
        if (typeof n.attrs.name !== 'string' || n.attrs.name.length > 64) {
          throw new DocError('Invalid emoji')
        }
        return { type: 'emoji', attrs: { name: n.attrs.name } }
      }
      case 'hardBreak':
        return { type: 'hardBreak' }
      default:
        throw new DocError(`Unsupported content: ${String(n.type)}`)
    }
  }

  const listItem = (n: unknown, depth: number): ListItemNode => {
    assertObject(n)
    bump()
    if (n.type !== 'listItem') throw new DocError('Invalid list')
    return { type: 'listItem', content: blocks(n.content, depth + 1) }
  }

  const block = (n: unknown, depth: number): BlockNode => {
    assertObject(n)
    bump()
    if (depth > MAX_DEPTH) throw new DocError('Message is nested too deeply')
    if (typeof n.type !== 'string' || !allowed.has(n.type)) {
      throw new DocError(`Unsupported content: ${String(n.type)}`)
    }
    const content = n.content === undefined ? [] : n.content
    if (!Array.isArray(content)) throw new DocError('Invalid content')
    switch (n.type) {
      case 'paragraph':
        return { type: 'paragraph', content: content.map((c) => inline(c)) }
      case 'codeBlock': {
        const lang =
          n.attrs && typeof n.attrs === 'object' && 'language' in n.attrs
            ? (n.attrs as { language: unknown }).language
            : null
        return {
          type: 'codeBlock',
          attrs: {
            language: typeof lang === 'string' && /^[\w+#-]{1,32}$/.test(lang) ? lang : null,
          },
          content: content.map((c) => {
            const t = inline(c, false)
            if (t.type !== 'text') throw new DocError('Code blocks may only contain text')
            return t
          }),
        }
      }
      case 'blockquote':
        return { type: 'blockquote', content: blocks(content, depth + 1) }
      case 'bulletList':
        return { type: 'bulletList', content: content.map((c) => listItem(c, depth)) }
      case 'heading': {
        const level = Number((n.attrs as { level?: unknown } | undefined)?.level)
        return {
          type: 'heading',
          attrs: { level: level === 1 || level === 2 ? level : 3 },
          content: content.map((c) => inline(c)),
        }
      }
      case 'horizontalRule':
        return { type: 'horizontalRule' }
      case 'taskList':
        return {
          type: 'taskList',
          content: content.map((c) => {
            assertObject(c)
            bump()
            if (c.type !== 'taskItem') throw new DocError('Invalid checklist')
            return {
              type: 'taskItem',
              attrs: { checked: (c.attrs as { checked?: unknown } | undefined)?.checked === true },
              content: blocks(c.content, depth + 1),
            }
          }),
        }
      default: {
        const start =
          n.attrs && typeof n.attrs === 'object' && 'start' in n.attrs
            ? Number((n.attrs as { start: unknown }).start)
            : 1
        return {
          type: 'orderedList',
          attrs: { start: Number.isInteger(start) && start > 0 && start < 1e6 ? start : 1 },
          content: content.map((c) => listItem(c, depth)),
        }
      }
    }
  }

  const blocks = (arr: unknown, depth: number): BlockNode[] => {
    if (arr === undefined) return []
    if (!Array.isArray(arr)) throw new DocError('Invalid content')
    return arr.map((b) => block(b, depth))
  }

  assertObject(input)
  if (input.type !== 'doc') throw new DocError('Invalid document')
  const doc: DocNode = { type: 'doc', content: blocks(input.content, 0) }
  const text = docToText(doc)
  if (text.length > (opts.rich ? MAX_CANVAS_TEXT : MAX_MESSAGE_TEXT))
    throw new DocError(opts.rich ? 'Canvas is too long' : 'Message is too long')
  return doc
}

export function isDocError(e: unknown): e is Error {
  return e instanceof DocError
}

/** Plain-text projection used for search, notifications and previews. */
export function docToText(doc: DocNode): string {
  const out: string[] = []
  const inlineText = (n: InlineNode): string => {
    switch (n.type) {
      case 'text':
        return n.text
      case 'mention':
        return n.attrs.kind === 'channel' ? `#${n.attrs.label}` : `@${n.attrs.label}`
      case 'emoji':
        return `:${n.attrs.name}:`
      case 'hardBreak':
        return '\n'
    }
  }
  const walk = (b: BlockNode) => {
    switch (b.type) {
      case 'paragraph':
      case 'codeBlock':
      case 'heading':
        out.push((b.content ?? []).map(inlineText).join(''))
        break
      case 'taskList':
        for (const item of b.content ?? [])
          for (const [i, c] of (item.content ?? []).entries()) {
            const start = out.length
            walk(c)
            if (i === 0 && out.length > start)
              out[start] = `[${item.attrs.checked ? 'x' : ' '}] ${out[start]}`
          }
        break
      case 'horizontalRule':
        break
      case 'blockquote':
        for (const c of b.content ?? []) walk(c)
        break
      case 'bulletList':
      case 'orderedList':
        for (const li of b.content ?? []) for (const c of li.content ?? []) walk(c)
        break
    }
  }
  for (const b of doc.content) walk(b)
  return out.join('\n').trim()
}

export function extractMentions(doc: DocNode): { kind: MentionKind; id: string }[] {
  const found = new Map<string, { kind: MentionKind; id: string }>()
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const n = node as {
      type?: string
      attrs?: { id: string; kind: MentionKind }
      content?: unknown[]
    }
    if (n.type === 'mention' && n.attrs) found.set(`${n.attrs.kind}:${n.attrs.id}`, n.attrs)
    if (Array.isArray(n.content)) for (const c of n.content) visit(c)
  }
  visit(doc)
  return [...found.values()].map(({ kind, id }) => ({ kind, id }))
}

/** Builds a document from plain text (used by webhooks, bots and tests). */
export function textToDoc(text: string): DocNode {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph' as const,
      content: line ? [{ type: 'text' as const, text: line }] : [],
    })),
  }
}

/** Inline `**bold**` and `` `code` `` in a line of plugin text. */
function inlineMarks(line: string): TextNode[] {
  const out: TextNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ type: 'text', text: line.slice(last, m.index) })
    out.push(
      m[1] !== undefined
        ? { type: 'text', text: m[1], marks: [{ type: 'bold' }] }
        : { type: 'text', text: m[2]!, marks: [{ type: 'code' }] },
    )
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ type: 'text', text: line.slice(last) })
  return out
}

/**
 * Builds a document from plugin or assistant text with a little formatting:
 * `**bold**`, `` `code` ``, "- " / "* " bullets, "1. " numbered lists, "#" headings
 * (as bold lines) and ``` fenced code blocks. Everything else stays plain text.
 */
export function simpleMarkdownToDoc(text: string): DocNode {
  const content: BlockNode[] = []
  type OpenList = { kind: 'bulletList' | 'orderedList'; items: ListItemNode[] }
  let list = null as OpenList | null
  let code = null as { language: string | null; lines: string[] } | null
  for (const line of text.split('\n')) {
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line)
    if (code) {
      if (fence) {
        const body = code.lines.join('\n')
        content.push({
          type: 'codeBlock',
          attrs: { language: code.language },
          content: body ? [{ type: 'text', text: body }] : [],
        })
        code = null
      } else code.lines.push(line)
      continue
    }
    if (fence) {
      list = null
      code = { language: fence[1] || null, lines: [] }
      continue
    }
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line)
    const numbered = bullet ? null : /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const item = bullet ?? numbered
    if (item) {
      const kind = bullet ? 'bulletList' : 'orderedList'
      if (list?.kind !== kind) {
        list = { kind, items: [] }
        content.push(
          kind === 'orderedList'
            ? { type: kind, attrs: { start: 1 }, content: list.items }
            : { type: kind, content: list.items },
        )
      }
      list.items.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: inlineMarks(item[1]!) }],
      })
      continue
    }
    list = null
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
    content.push({
      type: 'paragraph',
      content: heading
        ? [{ type: 'text', text: heading[1]!.replace(/\*\*/g, ''), marks: [{ type: 'bold' }] }]
        : line
          ? inlineMarks(line)
          : [],
    })
  }
  // An unclosed fence still shows its code.
  if (code?.lines.length)
    content.push({
      type: 'codeBlock',
      attrs: { language: code.language },
      content: [{ type: 'text', text: code.lines.join('\n') }],
    })
  return { type: 'doc', content }
}

export function isEmptyDoc(doc: DocNode): boolean {
  return docToText(doc).length === 0 && !JSON.stringify(doc).includes('"mention"')
}
