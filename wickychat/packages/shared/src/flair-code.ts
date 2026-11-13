import type { z } from 'zod'
import { SPEC_SCHEMAS, type SpecKind, type SpecOf } from './flair'

export type CodeKind = Exclude<SpecKind, 'sound_pack'>

type FieldType = 'list' | 'bool' | 'number' | 'text'

type Def = { type: string; innerType?: z.ZodType }

function unwrap(s: z.ZodType) {
  let t = s
  let nullable = false
  for (;;) {
    const def = t.def as Def
    if (def.type === 'nullable') nullable = true
    if (
      (def.type === 'optional' || def.type === 'default' || def.type === 'nullable') &&
      def.innerType
    )
      t = def.innerType
    else return { type: def.type, nullable }
  }
}

function fields(kind: CodeKind) {
  const shape = (SPEC_SCHEMAS[kind] as z.ZodObject).shape as Record<string, z.ZodType>
  return Object.entries(shape).map(([key, s]) => {
    const u = unwrap(s)
    const type: FieldType =
      u.type === 'array'
        ? 'list'
        : u.type === 'boolean'
          ? 'bool'
          : u.type === 'number'
            ? 'number'
            : 'text'
    return { key, type, nullable: u.nullable }
  })
}

const norm = (k: string) =>
  k
    .toLowerCase()
    .replace(/[\s_-]/g, '')
    .replace(/colour/g, 'color')

export function codeFields(kind: CodeKind) {
  return fields(kind).map((f) => f.key)
}

export function specToCode(kind: CodeKind, spec: unknown): string {
  if (!spec || typeof spec !== 'object') return ''
  const s = spec as Record<string, unknown>
  return fields(kind)
    .filter((f) => s[f.key] !== undefined)
    .map((f) => {
      const v = s[f.key]
      const out =
        v === null
          ? 'none'
          : Array.isArray(v)
            ? v.join(' ')
            : typeof v === 'boolean'
              ? v
                ? 'yes'
                : 'no'
              : String(v)
      return `${f.key}: ${out}`
    })
    .join('\n')
}

export type CodeResult<K extends CodeKind> = { spec: SpecOf<K> } | { error: string }

export function codeToSpec<K extends CodeKind>(kind: K, code: string): CodeResult<K> {
  const text = code.trim()
  if (!text) return { error: 'Write some code first.' }
  let raw: Record<string, unknown> = {}
  if (text.startsWith('{')) {
    try {
      raw = JSON.parse(text)
    } catch {
      return { error: "That looks like JSON but it doesn't parse. Check the commas and quotes." }
    }
  } else {
    const list = fields(kind)
    const byKey = new Map(list.map((f) => [norm(f.key), f]))
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim()
      if (!line || line.startsWith('//')) continue
      const at = line.indexOf(':')
      if (at < 1) return { error: `Line ${i + 1}: write it like "name: value".` }
      const name = line.slice(0, at).trim()
      const value = line.slice(at + 1).trim()
      const f = byKey.get(norm(name))
      if (!f)
        return {
          error: `Line ${i + 1}: "${name}" isn't a setting here. You can use: ${list.map((x) => x.key).join(', ')}.`,
        }
      if (f.nullable && value.toLowerCase() === 'none') raw[f.key] = null
      else if (f.type === 'list') raw[f.key] = value.split(/[\s,]+/).filter(Boolean)
      else if (f.type === 'bool') {
        const v = value.toLowerCase()
        if (['yes', 'true', 'on'].includes(v)) raw[f.key] = true
        else if (['no', 'false', 'off'].includes(v)) raw[f.key] = false
        else return { error: `Line ${i + 1}: ${f.key} should be yes or no.` }
      } else if (f.type === 'number') {
        const n = Number(value)
        if (!Number.isFinite(n)) return { error: `Line ${i + 1}: ${f.key} should be a number.` }
        raw[f.key] = n
      } else raw[f.key] = value
    }
  }
  const r = SPEC_SCHEMAS[kind].safeParse(raw)
  if (r.success) return { spec: r.data as SpecOf<K> }
  const issue = r.error.issues[0]!
  const key = String(issue.path[0] ?? '')
  const where = key ? `${key}: ` : ''
  if (issue.code === 'invalid_format' && /color|bg|border|text/i.test(key))
    return { error: `${where}use colours like #ff5cc8 (a # and 6 letters or numbers).` }
  if (issue.code === 'invalid_format')
    return { error: `${where}theres a character in there that isn't allowed.` }
  if (issue.code === 'too_small') return { error: `${where}add a bit more.` }
  if (issue.code === 'too_big') return { error: `${where}thats too many or too long.` }
  if (issue.code === 'invalid_type' && issue.input === undefined)
    return { error: `${key} is missing. Add a line like "${key}: ..."` }
  return { error: `${where}${issue.message}` }
}
