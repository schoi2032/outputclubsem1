import { describe, expect, it } from 'vitest'
import { censorDoc, censorText, isSwear } from './profanity'

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
})
