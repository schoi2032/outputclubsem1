import { z } from 'zod'

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().default('postgres://quid:quid@localhost:5432/quid'),
    DATABASE_POOL_MAX: z.coerce.number().int().default(10),

    /** Origin of the web app, used in emails and for Origin checks. */
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    /** Public WebSocket URL of this API, handed to clients with their ticket. */
    PUBLIC_WS_URL: z.string().default('ws://localhost:4000/ws'),
    /** Extra origins allowed to open WebSocket connections (comma-separated). */
    EXTRA_ORIGINS: z.string().default(''),
    COOKIE_SECURE: bool.optional(),
    SESSION_TTL_DAYS: z.coerce.number().int().default(30),
    /** Trust X-Forwarded-* (Cloud Run, Next rewrites). */
    TRUST_PROXY: bool.default(true),

    /** 32-byte base64 key for AES-256-GCM credential encryption. */
    ENCRYPTION_KEY: z.string().optional(),
    /** Shared secret for /internal/* endpoints (Cloud Scheduler). */
    INTERNAL_TOKEN: z.string().optional(),

    EMAIL_PROVIDER: z.enum(['smtp', 'resend', 'brevo', 'console']).default('smtp'),
    EMAIL_FROM: z.string().default('WickyChat <no-reply@quid.local>'),
    SMTP_URL: z.string().default('smtp://localhost:1025'),
    RESEND_API_KEY: z.string().optional(),
    BREVO_API_KEY: z.string().optional(),

    STORAGE_DRIVER: z.enum(['local', 'gcs', 'blob']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('.storage'),
    GCS_BUCKET: z.string().optional(),

    EVENT_BUS: z.enum(['memory', 'redis', 'postgres']).default('memory'),
    /** Direct (non-pooled) Postgres URL for LISTEN/NOTIFY. Defaults to DATABASE_URL. */
    DATABASE_URL_UNPOOLED: z.string().optional(),
    REDIS_URL: z.string().optional(),

    /** Run the job poller in-process (dev). In prod Cloud Scheduler calls the tick endpoint. */
    JOBS_POLL: bool.default(true),

    LIVEKIT_URL: z.string().optional(),
    LIVEKIT_API_KEY: z.string().optional(),
    LIVEKIT_API_SECRET: z.string().optional(),

    /** Google sign-in (OAuth client of type "Web application"). Both or neither. */
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    /** Optional Google Safe Browsing key, used to screen plugin URLs. */
    SAFE_BROWSING_API_KEY: z.string().optional(),
    /** Comma-separated emails of WickyChat staff who review plugins. */
    PLATFORM_ADMIN_EMAILS: z.string().default(''),
    /** Where WickyChat's own plugin service (apps/plugins) runs, and the key both sides derive secrets from. */
    OFFICIAL_PLUGINS_URL: z.url().optional(),
    OFFICIAL_PLUGINS_KEY: z.string().min(16).optional(),

    /** WickyChat: the only email domain allowed to sign up, and the single organization. */
    SCHOOL_EMAIL_DOMAIN: z.string().default('chadwickschool.org'),
    SCHOOL_ORG_NAME: z.string().default('Chadwick International'),
    SCHOOL_ORG_SLUG: z.string().default('chadwick'),
    /** Comma-separated school emails that join as owners. The very first person to sign in is owner too. */
    SCHOOL_ADMIN_EMAILS: z.string().default(''),

    /** Allow anyone to register. Invites always work. */
    OPEN_REGISTRATION: bool.default(true),
  })
  .superRefine((env, ctx) => {
    // A chosen email API needs its key in every environment, or nothing is delivered.
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
      })
    }
    if (env.EMAIL_PROVIDER === 'brevo' && !env.BREVO_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['BREVO_API_KEY'],
        message: 'BREVO_API_KEY is required when EMAIL_PROVIDER=brevo',
      })
    }
    if (env.NODE_ENV !== 'production') return
    const required: (keyof typeof env)[] = ['ENCRYPTION_KEY', 'INTERNAL_TOKEN']
    if (env.STORAGE_DRIVER === 'gcs') required.push('GCS_BUCKET')
    if (env.EVENT_BUS === 'redis') required.push('REDIS_URL')
    for (const key of required) {
      if (!env[key])
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` })
    }
  })

export type Config = z.infer<typeof schema> & { cookieSecure: boolean; allowedOrigins: string[] }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
  }
  const c = parsed.data
  return {
    ...c,
    cookieSecure: c.COOKIE_SECURE ?? c.WEB_ORIGIN.startsWith('https://'),
    allowedOrigins: [
      c.WEB_ORIGIN,
      ...c.EXTRA_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ],
  }
}
