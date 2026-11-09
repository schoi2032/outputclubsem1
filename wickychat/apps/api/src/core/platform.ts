import type { AppContext } from './context'

/** WickyChat staff who review plugins (PLATFORM_ADMIN_EMAILS). */
export const isPlatformAdmin = (ctx: AppContext, email: string | undefined) =>
  !!email &&
  ctx.config.PLATFORM_ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
