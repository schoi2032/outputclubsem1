import { verifyEmail } from './adapters/email'
import { buildApp } from './app'
import { loadConfig } from './core/config'

const config = loadConfig()
const { app } = await buildApp(config)

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await app.listen({ port: config.PORT, host: config.HOST })
void verifyEmail(config, app.log as never)
