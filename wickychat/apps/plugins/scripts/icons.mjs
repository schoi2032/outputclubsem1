// Builds the official plugin icons (apps/plugins/icons/*.png) from Lucide icons.
//   node apps/plugins/scripts/icons.mjs   (needs ImageMagick with librsvg)
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '../../web/package.json'))
const lucide = join(dirname(require.resolve('lucide-react')), '../esm/icons')

const ICONS = {
  'quid-polls': ['chart-column', '#3b50d8', '#6b7bf2'],
  'quid-reminders': ['alarm-clock', '#d97706', '#f59e0b'],
  'quid-standup': ['users-round', '#059669', '#34d399'],
  'quid-translate': ['languages', '#0284c7', '#38bdf8'],
  'quid-world-clock': ['earth', '#7c3aed', '#a78bfa'],
  'quid-dice': ['dices', '#e11d48', '#fb7185'],
}

const attrs = (o) =>
  Object.entries(o)
    .filter(([k]) => k !== 'key')
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')

for (const [slug, [name, from, to]] of Object.entries(ICONS)) {
  const src = readFileSync(join(lucide, `${name}.mjs`), 'utf8')
  const { node } = Function(`return ${/const __iconData = (\{[\s\S]*?\n\});/.exec(src)[1]}`)()
  const shapes = node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${to}"/><stop offset="1" stop-color="${from}"/></linearGradient></defs>
  <rect width="256" height="256" rx="56" fill="url(#g)"/>
  <g transform="translate(56 56) scale(6)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>
</svg>`
  const tmp = join(here, `../icons/${slug}.svg`)
  writeFileSync(tmp, svg)
  execFileSync('magick', ['-background', 'none', tmp, '-strip', join(here, `../icons/${slug}.png`)])
  execFileSync('rm', [tmp])
  console.log(`icons/${slug}.png`)
}
