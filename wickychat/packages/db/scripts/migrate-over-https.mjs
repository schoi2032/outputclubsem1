// Applies the drizzle migrations to a Neon database over HTTPS (port 443) instead of the
// Postgres port (5432). Use it when your network blocks 5432, as the school network does.
// It does exactly what `pnpm migrate` does: same files, same drizzle.__drizzle_migrations table.
//
//   vercel env pull /tmp/prod.env --environment=production --yes
//   node packages/db/scripts/migrate-over-https.mjs /tmp/prod.env
//   rm /tmp/prod.env
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const envFile = process.argv[2]
if (!envFile) {
  console.error('usage: node migrate-over-https.mjs <env file with DATABASE_URL_UNPOOLED>')
  process.exit(1)
}
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]
    }),
)
const conn = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL
if (!conn) throw new Error('No DATABASE_URL_UNPOOLED or DATABASE_URL in that file')
const host = new URL(conn).hostname.replace('-pooler', '')
const endpoint = `https://${host}/sql`
const headers = { 'Neon-Connection-String': conn, 'Content-Type': 'application/json' }

async function call(body) {
  const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.message ?? JSON.stringify(j))
  return j
}
const one = (query, params = []) => call({ query, params })

const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
await one('create extension if not exists pg_trgm')
await one('create schema if not exists "drizzle"')
await one(
  'create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)',
)
const last = (
  await one(
    'select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1',
  )
).rows[0]
const lastAt = last ? Number(last.created_at) : -1

const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'))
for (const e of journal.entries) {
  if (e.when <= lastAt) continue
  const sql = readFileSync(join(folder, `${e.tag}.sql`), 'utf8')
  const stmts = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
  // One HTTP batch = one transaction: the migration's statements plus its bookkeeping row.
  await call({
    queries: [
      ...stmts.map((q) => ({ query: q, params: [] })),
      {
        query: 'insert into "drizzle"."__drizzle_migrations" ("hash","created_at") values ($1,$2)',
        params: [createHash('sha256').update(sql).digest('hex'), String(e.when)],
      },
    ],
  })
  console.log(`applied ${e.tag}`)
}
const n = await one('select count(*)::int as n from "drizzle"."__drizzle_migrations"')
console.log(`up to date: ${n.rows[0].n} migrations`)
