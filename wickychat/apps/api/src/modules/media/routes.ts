import { requireUser } from '../../core/auth'
import type { AppContext } from '../../core/context'
import type { App } from '../../core/http'

/**
 * WickyChat Voice and WickyChat Meet ship in later stages. This endpoint lets the web
 * app show an honest status instead of controls that don't work.
 */
export async function mediaRoutes(app: App, ctx: AppContext) {
  app.get('/api/media/status', async (req) => {
    requireUser(req)
    return {
      provider: ctx.media.name,
      configured: ctx.media.configured,
      voice: { available: ctx.media.configured },
      meet: { available: ctx.media.configured },
    }
  })
}
