import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * from './schema'
export { schema }

export function createDb(url: string, opts: { max?: number } = {}) {
  // Cloud SQL connects over a Unix socket given in PGHOST (e.g. /cloudsql/project:region:instance).
  // URLs written without a host ("user:pass@/db") don't parse, so give them a placeholder host.
  const socket = process.env.PGHOST?.startsWith('/') ? process.env.PGHOST : undefined
  const client = postgres(url.replace('@/', '@localhost/'), {
    ...(socket && { host: socket }),
    max: opts.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Keep numeric ids/bigints as JS numbers where we asked for them.
    onnotice: () => {},
  })
  const db = drizzle(client, { schema, casing: 'snake_case' })
  return { db, client }
}

export type Db = ReturnType<typeof createDb>['db']
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
