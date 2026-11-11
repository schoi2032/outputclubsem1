import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, resolvePreferences, updatePreferencesSchema } from './preferences'

describe('preferences', () => {
  it('fills defaults for missing or malformed input', () => {
    expect(resolvePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(resolvePreferences('nope')).toEqual(DEFAULT_PREFERENCES)
  })
  it('keeps valid values and drops invalid or unknown ones', () => {
    const p = resolvePreferences({ density: 'compact', accent: 'red', font: 'comic', extra: 1 })
    expect(p.density).toBe('compact')
    expect(p.accent).toBe(DEFAULT_PREFERENCES.accent)
    expect(p.font).toBe('geist')
    expect(p).not.toHaveProperty('extra')
  })
  it('validates updates strictly', () => {
    expect(updatePreferencesSchema.safeParse({ accent: '#00aa88' }).success).toBe(true)
    expect(updatePreferencesSchema.safeParse({ accent: 'blue' }).success).toBe(false)
    expect(updatePreferencesSchema.safeParse({ quickReactions: ['👍'] }).success).toBe(false)
    expect(updatePreferencesSchema.safeParse({ bogus: true }).success).toBe(false)
  })
})
