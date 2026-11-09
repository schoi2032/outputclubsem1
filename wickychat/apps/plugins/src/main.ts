import { fileURLToPath } from 'node:url'
import { buildApp, runCron } from './app'
import { googleTranslator } from './handlers/translate'
import { connect, migrate } from './store'

const env = process.env
const key = env.OFFICIAL_PLUGINS_KEY
if (!key || key.length < 16) throw new Error('OFFICIAL_PLUGINS_KEY (16+ characters) is required')
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const sql = connect(env.DATABASE_URL)
await migrate(sql)

const { app, deps } = buildApp({
  key,
  sql,
  translate: googleTranslator({
    apiKey: env.GOOGLE_TRANSLATE_API_KEY,
    // On Cloud Run (K_SERVICE is set) the service account's token is used.
    metadata: !!env.K_SERVICE,
  }),
  iconsDir: env.ICONS_DIR ?? fileURLToPath(new URL('../icons', import.meta.url)),
  logger: true,
})

// Locally there's no Cloud Scheduler, so run reminders and standups here too.
if (!env.K_SERVICE)
  setInterval(() => void runCron(deps).catch((e) => app.log.error(e)), 30_000).unref()

await app.listen({ host: '0.0.0.0', port: Number(env.PORT ?? env.PLUGINS_PORT ?? 4200) })
