'use client'
import type { Preferences } from '@quid/shared'
import { setPreferences, usePreference } from './preferences'

export type Theme = Preferences['theme']

export function useTheme(): [Theme, (t: Theme) => void] {
  return [usePreference('theme'), (theme) => setPreferences({ theme })]
}
