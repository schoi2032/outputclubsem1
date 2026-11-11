import type { AppContext } from '../../core/context'
import type { App } from '../../core/http'
import { canvasRoutes } from './canvases'
import { reminderRoutes } from './reminders'
import { taskRoutes } from './tasks'
import { workflowRoutes } from './workflows'

/** Canvases, tasks, reminders and the workflow builder. */
export async function productivityRoutes(app: App, ctx: AppContext) {
  await canvasRoutes(app, ctx)
  await taskRoutes(app, ctx)
  await reminderRoutes(app, ctx)
  await workflowRoutes(app, ctx)
}
