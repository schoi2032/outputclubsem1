'use client'
import type { BlockNode, CustomEmoji, DocNode, InlineNode, Mark } from '@quid/shared'
import { cn } from '@quid/ui'
import Link from 'next/link'
import { Fragment } from 'react'
import { useEmojiMap } from '@/lib/expressions'
import { useOrgContext } from '../org-context'
import { CustomEmojiImg, emojify } from './custom-emoji'

type Emojis = Map<string, CustomEmoji>

function withMarks(text: React.ReactNode, marks: Mark[] | undefined, key: string): React.ReactNode {
  let node = text
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        node = <strong className="font-semibold">{node}</strong>
        break
      case 'italic':
        node = <em>{node}</em>
        break
      case 'strike':
        node = <s>{node}</s>
        break
      case 'code':
        node = <code>{node}</code>
        break
      case 'link':
        node = (
          <a href={m.attrs.href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {node}
          </a>
        )
        break
    }
  }
  return <Fragment key={key}>{node}</Fragment>
}

/** Turns bare URLs in plain text into links, and `:name:` into custom emoji. */
function autolink(text: string, key: string, emojis: Emojis): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"')\]]+)/g)
  if (parts.length === 1) return emojify(text, emojis, key)
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <a key={`${key}-${i}`} href={p} target="_blank" rel="noopener noreferrer nofollow ugc">
        {p}
      </a>
    ) : (
      <Fragment key={`${key}-${i}`}>{emojify(p, emojis, `${key}-${i}`)}</Fragment>
    ),
  )
}

function Inline({ n, k, emojis }: { n: InlineNode; k: string; emojis: Emojis }) {
  const { me, base } = useOrgContext()
  switch (n.type) {
    case 'text':
      return (
        <>
          {withMarks(
            n.marks?.some((m) => m.type === 'link' || m.type === 'code')
              ? n.text
              : autolink(n.text, k, emojis),
            n.marks,
            k,
          )}
        </>
      )
    case 'hardBreak':
      return <br />
    case 'emoji': {
      const custom = emojis.get(n.attrs.name)
      return custom ? <CustomEmojiImg emoji={custom} /> : <span>:{n.attrs.name}:</span>
    }
    case 'mention': {
      if (n.attrs.kind === 'channel') {
        return (
          <Link href={`${base}/c/${n.attrs.id}`} className="q-mention no-underline!">
            #{n.attrs.label}
          </Link>
        )
      }
      const isMe = n.attrs.kind === 'here' || n.attrs.id === me.id
      return <span className={cn('q-mention', isMe && 'q-mention-me')}>@{n.attrs.label}</span>
    }
  }
}

function Block({ b, k, emojis }: { b: BlockNode; k: string; emojis: Emojis }) {
  switch (b.type) {
    case 'paragraph':
      return (
        <p>
          {(b.content ?? []).map((n, i) => (
            <Inline key={i} n={n} k={`${k}-${i}`} emojis={emojis} />
          ))}
        </p>
      )
    case 'codeBlock':
      return (
        <pre data-language={b.attrs?.language ?? undefined}>
          <code>{(b.content ?? []).map((t) => t.text).join('')}</code>
        </pre>
      )
    case 'blockquote':
      return (
        <blockquote>
          {(b.content ?? []).map((c, i) => (
            <Block key={i} b={c} k={`${k}-${i}`} emojis={emojis} />
          ))}
        </blockquote>
      )
    case 'bulletList':
      return (
        <ul>
          {(b.content ?? []).map((li, i) => (
            <li key={i}>
              {(li.content ?? []).map((c, j) => (
                <Block key={j} b={c} k={`${k}-${i}-${j}`} emojis={emojis} />
              ))}
            </li>
          ))}
        </ul>
      )
    case 'orderedList':
      return (
        <ol start={b.attrs?.start}>
          {(b.content ?? []).map((li, i) => (
            <li key={i}>
              {(li.content ?? []).map((c, j) => (
                <Block key={j} b={c} k={`${k}-${i}-${j}`} emojis={emojis} />
              ))}
            </li>
          ))}
        </ol>
      )
  }
}

/** Renders a validated message document. Never uses innerHTML. */
export function RichText({ doc, className }: { doc: DocNode; className?: string }) {
  const emojis = useEmojiMap()
  // A message that is only emoji renders larger, like most chat apps.
  const plain =
    doc.content.length === 1 && doc.content[0]!.type === 'paragraph'
      ? (doc.content[0]!.content ?? [])
      : null
  const jumbo =
    plain &&
    plain.length === 1 &&
    plain[0]!.type === 'text' &&
    !plain[0]!.marks &&
    /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,24}$/u.test(plain[0]!.text) &&
    /\p{Extended_Pictographic}/u.test(plain[0]!.text)
  return (
    <div className={cn('q-prose', jumbo && 'text-[30px] leading-tight', className)}>
      {doc.content.map((b, i) => (
        <Block key={i} b={b} k={String(i)} emojis={emojis} />
      ))}
    </div>
  )
}
