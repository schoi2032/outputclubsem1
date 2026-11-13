import type { SpecKind } from './flair'
import { sanitizeThemeCss } from './wicky'

export const MAX_FLAIR_CSS = 8000

export const flairClass = (id: string) => `qcx-${id.slice(0, 8)}${id.slice(-4)}`

export const customIdOf = (value: string | null | undefined) =>
  /^u:([0-9a-f-]{36})/.exec(value ?? '')?.[1] ?? null

const scopeFor = (kind: SpecKind, id: string) =>
  kind === 'mention_style' ? `.${flairClass(id)} .q-mention` : `.${flairClass(id)}`

const TARGETS: Partial<Record<SpecKind, string>> = {
  typing: '& .q-ty-glyphs (the emoji) and & .q-ty-words (the words)',
  bubble: '& (the bubble)',
  name_effect: '& (the name)',
  mention_style: '& (each @mention)',
  reaction_skin: '& (each reaction pill)',
  message_effect: '& (the whole message, while the effect plays)',
}
export const flairCssTargets = (kind: SpecKind) => TARGETS[kind] ?? '&'

type Block = { prelude: string; body: string }

function blocks(css: string): Block[] | string {
  const out: Block[] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open === -1) {
      if (css.slice(i).trim()) return 'Something is outside of a { } block.'
      break
    }
    let depth = 1
    let j = open + 1
    while (j < css.length && depth) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    if (depth) return 'A { is missing its }.'
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) })
    i = j
  }
  return out
}

const BAD: [RegExp, string][] = [
  [/position\s*:\s*(fixed|sticky)/i, 'position fixed and sticky are not allowed'],
  [
    /-?\d*\.?\d+\s*(vw|vh|vmin|vmax|dvh|svh|lvh|dvw|svw|lvw)\b/i,
    'screen units like vw and vh are not allowed',
  ],
  [/z-index\s*:\s*-?\d{3,}/i, 'keep z-index under 100'],
  [/@/, 'only @keyframes can be used'],
]

const LIMITS: [RegExp, number, string][] = [
  [/(-?\d*\.?\d+)\s*px\b/gi, 600, 'keep sizes under 600px'],
  [/(-?\d*\.?\d+)\s*%/g, 400, 'keep percents under 400%'],
  [/(-?\d*\.?\d+)\s*r?em\b/gi, 30, 'keep em sizes under 30'],
]

function tooBig(body: string) {
  for (const [re, max, msg] of LIMITS)
    for (const m of body.matchAll(re)) if (Math.abs(Number.parseFloat(m[1]!)) >= max) return msg
  for (const m of body.matchAll(/scale\w*\s*\(([^)]*)\)/gi))
    for (const n of m[1]!.split(/[\s,]+/).filter(Boolean))
      if (Math.abs(Number.parseFloat(n)) >= 6) return 'keep scale() under 6'
  return null
}

export function scopeFlairCss(
  kind: SpecKind,
  id: string,
  raw: string,
): { css: string } | { error: string } {
  if (raw.length > MAX_FLAIR_CSS) return { error: `Keep it under ${MAX_FLAIR_CSS} characters.` }
  const clean = sanitizeThemeCss(raw.replace(/\/\*[\s\S]*?\*\//g, ''))
  if (clean.removed.length) return { error: `Not allowed here: ${clean.removed.join(', ')}.` }
  const parsed = blocks(clean.css)
  if (typeof parsed === 'string') return { error: parsed }
  const scope = scopeFor(kind, id)
  const tag = flairClass(id).replace('qcx-', 'k')
  const names = new Map<string, string>()
  for (const b of parsed) {
    const m = /^@keyframes\s+([A-Za-z][\w-]{0,40})$/.exec(b.prelude)
    if (m) names.set(m[1]!, `${tag}-${m[1]}`)
  }
  const rename = (body: string) =>
    body.replace(/(animation(?:-name)?\s*:)([^;]*)/gi, (_, p: string, v: string) => {
      let out = v
      for (const [from, to] of names)
        out = out.replace(new RegExp(`(^|[\\s,])${from}(?=$|[\\s,])`, 'g'), `$1${to}`)
      return p + out
    })
  const check = (body: string) => {
    for (const [re, msg] of BAD) if (re.test(body)) return msg
    return tooBig(body)
  }
  const out: string[] = [`${scope}{position:relative;isolation:isolate}`]
  for (const b of parsed) {
    if (b.prelude.startsWith('@')) {
      const m = /^@keyframes\s+([A-Za-z][\w-]{0,40})$/.exec(b.prelude)
      if (!m) return { error: 'Only @keyframes can start with @.' }
      const steps = blocks(b.body)
      if (typeof steps === 'string') return { error: `In @keyframes ${m[1]}: ${steps}` }
      for (const s of steps) {
        if (!/^(from|to|\d{1,3}(\.\d+)?%)(\s*,\s*(from|to|\d{1,3}(\.\d+)?%))*$/.test(s.prelude))
          return { error: `In @keyframes ${m[1]}: "${s.prelude}" should be from, to or a percent.` }
        const bad = check(s.body)
        if (bad) return { error: `In @keyframes ${m[1]}: ${bad}.` }
      }
      out.push(`@keyframes ${names.get(m[1]!)}{${b.body}}`)
      continue
    }
    const sels = b.prelude.split(',').map((x) => x.trim())
    for (const s of sels) {
      if (!s.startsWith('&'))
        return { error: `"${s}" has to start with &. Use & for your ${kind.replace('_', ' ')}.` }
      if (/[+~]/.test(s))
        return {
          error: `"${s}" can't use + or ~, those reach outside your ${kind.replace('_', ' ')}.`,
        }
      if (!/^&[\w\s.:>#()*=[\]"'-]*$/.test(s))
        return { error: `"${s}" has a character that isn't allowed.` }
    }
    const bad = check(b.body)
    if (bad) return { error: `In "${b.prelude}": ${bad}.` }
    const body = rename(b.body)
    const pseudo = sels.some((s) => s.includes('::'))
    out.push(
      `${sels.map((s) => scope + s.slice(1)).join(',')}{${body}${pseudo ? ';pointer-events:none' : ''}}`,
    )
  }
  return { css: out.join('\n') }
}
