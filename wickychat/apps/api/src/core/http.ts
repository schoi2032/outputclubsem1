import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>

/** Query-string boolean. (z.coerce.boolean would turn "false" into true.) */
export const queryBool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

export const orgParams = z.object({ orgId: z.uuid() })
export const idParams = z.object({ id: z.uuid() })
export const orgIdParams = z.object({ orgId: z.uuid(), id: z.uuid() })

/** Stricter limits for credential endpoints. */
/** Sign-in and similar endpoints. Raised only for local end-to-end runs, which sign in many times a minute. */
export const authRateLimit = {
  config: {
    rateLimit: {
      max: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE) || 10,
      timeWindow: '1 minute',
    },
  },
}
