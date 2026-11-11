import { describe, expect, it } from 'vitest'
import { docToText, extractMentions, sanitizeDoc, simpleMarkdownToDoc, textToDoc } from './richtext'

describe('sanitizeDoc', () => {
  it('accepts formatted text, mentions and code blocks', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ', marks: [{ type: 'bold' }] },
            {
              type: 'mention',
              attrs: { id: '0190a3e2-0000-7000-8000-000000000001', label: 'ada', kind: 'user' },
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const a = 1' }],
        },
      ],
    })
    expect(docToText(doc)).toBe('hi @ada\nconst a = 1')
    expect(extractMentions(doc)).toEqual([
      { kind: 'user', id: '0190a3e2-0000-7000-8000-000000000001' },
    ])
  })

  it('strips unknown keys', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      evil: 1,
      content: [{ type: 'paragraph', onclick: 'x', content: [] }],
    })
    expect(doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [] }] })
  })

  it('rejects javascript: links', () => {
    expect(() =>
      sanitizeDoc({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      }),
    ).toThrow()
  })

  it('rejects unsupported nodes and deep nesting', () => {
    expect(() =>
      sanitizeDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] }),
    ).toThrow()
    let node: Record<string, unknown> = { type: 'paragraph', content: [] }
    for (let i = 0; i < 20; i++) node = { type: 'blockquote', content: [node] }
    expect(() => sanitizeDoc({ type: 'doc', content: [node] })).toThrow()
  })

  it('round-trips plain text', () => {
    expect(docToText(sanitizeDoc(textToDoc('a\nb')))).toBe('a\nb')
  })
})

describe('simpleMarkdownToDoc', () => {
  it('turns lists, headings and fenced code into valid message blocks', () => {
    const d = simpleMarkdownToDoc(
      '## Plan\nShip **Friday**\n- one\n* two\n1. first\n2. second\n```ts\nconst a = 1\n```',
    )
    expect(sanitizeDoc(d)).toEqual(d)
    expect(d.content.map((b) => b.type)).toEqual([
      'paragraph',
      'paragraph',
      'bulletList',
      'orderedList',
      'codeBlock',
    ])
    expect(d.content[4]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const a = 1' }],
    })
  })
})
