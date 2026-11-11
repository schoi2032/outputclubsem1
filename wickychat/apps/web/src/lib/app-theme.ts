/**
 * WickyChat: loads the app theme someone has on (from the Wicky Shop). The CSS goes in a
 * <style id="wicky-theme"> tag, and <html data-wtheme> turns it on. It's cached so the
 * pre-paint script in app/layout.tsx can put it on before the first frame (no flash).
 */
import type { Me } from '@quid/shared'
import { applyPreferences, getPreferences } from './preferences'

export const THEME_CACHE_KEY = 'wicky-theme'

type Theme = Pick<NonNullable<Me['appTheme']>, 'css' | 'dark'> | null

export function applyAppTheme(theme: Theme, opts: { cache?: boolean } = {}) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  let tag = document.getElementById('wicky-theme') as HTMLStyleElement | null
  if (theme) {
    if (!tag) {
      tag = document.createElement('style')
      tag.id = 'wicky-theme'
      document.head.appendChild(tag)
    }
    // textContent, never innerHTML: the CSS can't turn into HTML.
    if (tag.textContent !== theme.css) tag.textContent = theme.css
    root.dataset.wtheme = ''
    if (theme.dark === null) delete root.dataset.wthemeMode
    else root.dataset.wthemeMode = theme.dark ? 'dark' : 'light'
  } else {
    tag?.remove()
    delete root.dataset.wtheme
    delete root.dataset.wthemeMode
  }
  applyPreferences(getPreferences())
  if (opts.cache === false) return
  try {
    if (theme) localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme))
    else localStorage.removeItem(THEME_CACHE_KEY)
  } catch {}
}
