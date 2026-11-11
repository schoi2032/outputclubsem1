import { runMigrations } from '@quid/db/migrate'
import postgres from 'postgres'

export const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgres://quid:quid@localhost:5432/quid_test'

export default async function setup() {
  const sql = postgres(TEST_DB, { max: 1, onnotice: () => {} })
  await sql`drop schema if exists public cascade`
  await sql`drop schema if exists drizzle cascade`
  await sql`create schema public`
  await sql.end()
  await runMigrations(TEST_DB)
}
