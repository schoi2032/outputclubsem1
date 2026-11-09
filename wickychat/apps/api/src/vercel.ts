/**
 * Vercel entrypoint. Vercel Functions take an exported http.Server and feed it both
 * HTTP requests and WebSocket upgrades, so we hand over Fastify's own server.
 */
import { buildApp } from './app'
import { loadConfig } from './core/config'

const { app } = await buildApp(loadConfig())
await app.ready()

export default app.server
