import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import websocket from '@fastify/websocket'
import { createDb } from '@quid/db'
import { MAX_UPLOAD_BYTES } from '@quid/shared'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyBaseLogger, type FastifyReply, type FastifyRequest } from 'fastify'
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import pino from 'pino'
import { createEmailAdapter, type EmailAdapter } from './adapters/email'
import { type GoogleAuth, GoogleOidc } from './adapters/google'
import { createMediaProvider, type MediaProvider } from './adapters/media'
import { createStorage, type StorageAdapter } from './adapters/storage'
import { resolveSession, SESSION_COOKIE } from './core/auth'
import type { Config } from './core/config'
import { type AppContext, OnlineTracker } from './core/context'
import { SecretBox, safeEqual } from './core/crypto'
import { AppError } from './core/errors'
import { type EventBus, MemoryEventBus, PostgresEventBus, RedisEventBus } from './core/eventbus'
import { onTick, startPoller, tick } from './core/jobs'
import { resetLiveSessions } from './core/live-sessions'
import { cleanupTick } from './modules/admin/cleanup'
import { complianceRoutes } from './modules/admin/compliance'
import { adminRoutes } from './modules/admin/routes'
import { type AIFactory, createProvider } from './modules/ai/providers'
import { aiRoutes } from './modules/ai/routes'
import { googleRoutes } from './modules/auth/google'
import { authRoutes } from './modules/auth/routes'
import { callRoutes } from './modules/calls/routes'
import { leaveAllCalls } from './modules/calls/service'
import { channelRoutes } from './modules/channels/routes'
import { connectedAppRoutes } from './modules/connected-apps/routes'
import { expressionRoutes } from './modules/expressions/routes'
import { fileRoutes } from './modules/files/routes'
import { integrationRoutes } from './modules/integrations/routes'
import { mediaRoutes } from './modules/media/routes'
import { publicMeetingRoutes } from './modules/meetings/public-routes'
import { meetingRoutes } from './modules/meetings/routes'
import { leaveAllMeetings } from './modules/meetings/service'
import { messageRoutes } from './modules/messages/routes'
import { sendDueScheduled } from './modules/messages/scheduled'
import { moderationRoutes } from './modules/moderation/routes'
import { installEmailNotifications } from './modules/notifications/email'
import { notificationRoutes } from './modules/notifications/routes'
import { customizationRoutes } from './modules/orgs/customization'
import { orgRoutes } from './modules/orgs/routes'
import { pluginRoutes } from './modules/plugins/routes'
import { presenceRoutes } from './modules/presence/routes'
import { installPresenceTracking } from './modules/presence/service'
import { productivityRoutes } from './modules/productivity/routes'
import { searchRoutes } from './modules/search/routes'
import { voiceRoomRoutes } from './modules/voice-rooms/routes'
import { leaveAllRooms } from './modules/voice-rooms/service'
import { registerGateway } from './ws/gateway'

const BEARER_ONLY = ['/api/mcp', '/api/oauth/token', '/api/oauth/register', '/api/oauth/revoke']

export interface BuildOptions {
  email?: EmailAdapter
  storage?: StorageAdapter
  bus?: EventBus
  media?: MediaProvider
  google?: GoogleAuth | null
  ai?: AIFactory
}

const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.apiKey',
]

export async function buildApp(config: Config, opts: BuildOptions = {}) {
  const log = pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACT, censor: '[redacted]' },
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  })

  const { db, client } = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX })
  const bus =
    opts.bus ??
    (config.EVENT_BUS === 'redis'
      ? await RedisEventBus.connect(config.REDIS_URL!)
      : config.EVENT_BUS === 'postgres'
        ? await PostgresEventBus.connect(config.DATABASE_URL_UNPOOLED ?? config.DATABASE_URL)
        : new MemoryEventBus())

  const ctx: AppContext = {
    config,
    db,
    log,
    bus,
    email: opts.email ?? createEmailAdapter(config, log),
    storage: opts.storage ?? createStorage(config),
    media: opts.media ?? createMediaProvider(config),
    secrets: new SecretBox(config.ENCRYPTION_KEY, config.NODE_ENV === 'production'),
    google:
      opts.google !== undefined
        ? opts.google
        : config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
          ? new GoogleOidc(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)
          : null,
    ai: opts.ai ?? createProvider,
    online: new OnlineTracker(),
  }
  installPresenceTracking(ctx)
  if (config.NODE_ENV !== 'test' && config.EVENT_BUS === 'memory') await resetLiveSessions(ctx)
  // Someone whose connections all drop (tab closed, network lost) leaves their calls,
  // after a grace period so a quick reconnect doesn't hang up on them.
  ctx.online.onChange((userId, online) => {
    if (online) return
    setTimeout(() => {
      if (ctx.online.isOnline(userId)) return
      void leaveAllCalls(ctx, userId).catch((err) => log.warn({ err }, 'leaving calls failed'))
      void leaveAllMeetings(ctx, userId).catch((err) =>
        log.warn({ err }, 'leaving meetings failed'),
      )
      void leaveAllRooms(ctx, userId).catch((err) =>
        log.warn({ err }, 'leaving voice rooms failed'),
      )
    }, 15_000).unref()
  })
  onTick(sendDueScheduled)
  installEmailNotifications()
  onTick(cleanupTick)

  const app = Fastify({
    loggerInstance: log as FastifyBaseLogger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_000_000,
    disableRequestLogging: config.NODE_ENV === 'test',
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(helmet, {
    // The API only serves JSON and downloads; the web app sets its own CSP.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
  await app.register(cookie)
  await app.register(rateLimit, {
    // Per client IP. End-to-end runs raise it: every test browser reaches the API from one address.
    max: Number(process.env.RATE_LIMIT_PER_MINUTE) || 600,
    timeWindow: '1 minute',
    allowList: () => config.NODE_ENV === 'test',
  })
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } })
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } })

  if (config.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'WickyChat API',
          version: '0.1.0',
          description: 'WickyChat Chat REST API. Realtime events use /ws.',
        },
      },
      transform: jsonSchemaTransform,
    })
    await app.register(swaggerUi, { routePrefix: '/api/docs' })
  }

  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    req.user = await resolveSession(ctx, req.cookies[SESSION_COOKIE])
  })

  // CSRF defence: cookie-authenticated, state-changing requests must come from our own origin.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
    if (req.url.startsWith('/api/hooks/') || req.url.startsWith('/internal/')) return
    // Bearer-token and OAuth client endpoints never use the session cookie.
    if (BEARER_ONLY.some((p) => req.url === p || req.url.startsWith(`${p}?`))) return
    const origin = req.headers.origin
    if (origin && !config.allowedOrigins.includes(origin)) {
      return reply
        .code(403)
        .send({ error: { code: 'forbidden', message: 'Cross-origin request blocked' } })
    }
    if (!origin && req.headers['sec-fetch-site'] === 'cross-site') {
      return reply
        .code(403)
        .send({ error: { code: 'forbidden', message: 'Cross-origin request blocked' } })
    }
  })

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const first = err.validation[0]
      const field = first?.instancePath?.replace(/^\//, '').replace(/\//g, '.')
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: first ? `${field ? `${field}: ` : ''}${first.message}` : 'Invalid request',
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      })
    }
    if (err instanceof AppError) {
      return reply
        .code(err.status)
        .send({ error: { code: err.code, message: err.message, details: err.details } })
    }
    const status = (err as { statusCode?: number }).statusCode
    if (status === 429) {
      return reply.code(429).send({
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Slow down and try again shortly.',
        },
      })
    }
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: { code: 'bad_request', message: (err as Error).message } })
    }
    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send({
      error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' },
    })
  })

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }),
  )

  app.get('/healthz', async () => ({ ok: true }))
  app.get('/readyz', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`)
      return { ok: true }
    } catch {
      return reply.code(503).send({ ok: false })
    }
  })

  /** Called by Vercel Cron (GET, Authorization: Bearer CRON_SECRET) or manually (POST). */
  const cronTick = async (req: FastifyRequest, reply: FastifyReply) => {
    // Cloud Scheduler sends X-Internal-Token; Authorization: Bearer also works for manual calls.
    const header = req.headers['x-internal-token']
    const supplied =
      typeof header === 'string'
        ? header
        : (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const secret = config.INTERNAL_TOKEN ?? process.env.CRON_SECRET
    if (!secret || !supplied || !safeEqual(supplied, secret)) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Unauthorized' } })
    }
    return { processed: await tick(ctx) }
  }
  app.post('/internal/cron/tick', cronTick)
  app.get('/internal/cron/tick', cronTick)

  await authRoutes(app, ctx)
  await googleRoutes(app, ctx)
  await orgRoutes(app, ctx)
  await customizationRoutes(app, ctx)
  await channelRoutes(app, ctx)
  await messageRoutes(app, ctx)
  await fileRoutes(app, ctx)
  await expressionRoutes(app, ctx)
  await searchRoutes(app, ctx)
  await presenceRoutes(app, ctx)
  await notificationRoutes(app, ctx)
  await integrationRoutes(app, ctx)
  await aiRoutes(app, ctx)
  await mediaRoutes(app, ctx)
  await callRoutes(app, ctx)
  await meetingRoutes(app, ctx)
  await publicMeetingRoutes(app, ctx)
  await voiceRoomRoutes(app, ctx)
  await connectedAppRoutes(app, ctx)
  await adminRoutes(app, ctx)
  await moderationRoutes(app, ctx)
  await complianceRoutes(app, ctx)
  await pluginRoutes(app, ctx)
  await productivityRoutes(app, ctx)
  await registerGateway(app, ctx)

  let stopPoller: (() => void) | null = null
  if (config.JOBS_POLL && config.NODE_ENV !== 'test') stopPoller = startPoller(ctx)

  app.addHook('onClose', async () => {
    stopPoller?.()
    await bus.close()
    await client.end({ timeout: 5 })
  })

  return { app, ctx }
}
