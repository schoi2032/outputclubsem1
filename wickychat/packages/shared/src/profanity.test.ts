import { describe, expect, it } from 'vitest'
import { censorDoc, censorDocReport, censorText, isSwear } from './profanity'

describe('swear filter', () => {
  it('censors plain and disguised swears', () => {
    for (const w of [
      'fuck',
      'FUCKING',
      'sh1t',
      '$hit',
      'fuuuuck',
      'b!tch',
      'asshole',
      'bullshit',
      'tits',
      'pissed',
      '@ss',
    ])
      expect(isSwear(w), w).toBe(true)
  })
  it('leaves normal words alone', () => {
    for (const w of [
      'class',
      'assessment',
      'as',
      'grass',
      'Scunthorpe',
      'document',
      'analysis',
      'title',
      'cocktail',
      'dog',
      'baby',
      'nobody',
      'hello',
      'assignment',
      'pass',
    ])
      expect(isSwear(w), w).toBe(false)
  })
  it('keeps punctuation and catches spaced-out letters', () => {
    expect(censorText('what the fuck!').text).toBe('what the ****!')
    expect(censorText('you are f u c k e d').text).not.toContain('f u c k')
    expect(censorText('son of a bitch').hits).toBeGreaterThan(0)
    expect(censorText('see you in class at 3').hits).toBe(0)
  })
  it('walks rich text documents', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'oh shit' }] }],
    }
    expect(JSON.stringify(censorDoc(doc))).toContain('oh ****')
  })

  it('reports the words it hid, as typed', () => {
    expect(censorText('wtf this is SH1T and f.u.c.k').words).toEqual(
      expect.arrayContaining(['SH1T', 'f.u.c.k']),
    )
    expect(censorText('see you in class at 3').words).toEqual([])
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'oh shit' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'what a bitch' }] },
      ],
    }
    const r = censorDocReport(doc)
    expect(r.words).toEqual(['shit', 'bitch'])
    expect(JSON.stringify(r.doc)).not.toContain('shit')
  })
})
