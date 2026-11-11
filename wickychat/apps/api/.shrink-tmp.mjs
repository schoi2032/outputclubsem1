import sharp from 'sharp'
import { readdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
const [dir, extra] = process.argv.slice(2)
const jobs = readdirSync(dir).filter((f) => f.endsWith('.webp')).map((f) => join(dir, f))
if (extra) jobs.push(extra)
for (const src of jobs) {
  const name = src.split('/').pop()
  const out = join(dir, `${name}.tmp`)
  await sharp(src, { animated: true }).resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 62, effort: 6 }).toFile(out)
  renameSync(out, join(dir, name))
  console.log(name, Math.round(statSync(join(dir, name)).size / 1024) + 'KB')
}
