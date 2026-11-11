import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './index'

export async function runMigrations(url: string) {
  const { db, client } = createDb(url, { max: 1 })
  try {
    // Extensions are created outside drizzle-kit so they work on managed Postgres too.
    await client`create extension if not exists pg_trgm`
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) })
  } finally {
    await client.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL || 'postgres://quid:quid@localhost:5432/quid'
  runMigrations(url)
    .then(() => console.log('Migrations applied'))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
