/** Org customization (admins) and members' answers to the org's profile fields. */
import { channels, organizations, orgMemberships } from '@quid/db'
import {
  cleanProfileValues,
  type OrgCustomization,
  profileValuesSchema,
  resolveCustomization,
  topics,
  updateCustomizationSchema,
} from '@quid/shared'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { audit } from '../../core/audit'
import { authorize, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, forbidden } from '../../core/errors'
import type { App } from '../../core/http'
import { orgParams } from '../../core/http'

export async function loadCustomization(ctx: AppContext, orgId: string) {
  const org = await ctx.db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { settings: true },
  })
  return resolveCustomization(org?.settings.customization)
}

export async function customizationRoutes(app: App, ctx: AppContext) {
  app.patch(
    '/api/orgs/:orgId/customization',
    { schema: { params: orgParams, body: updateCustomizationSchema } },
    async (req): Promise<OrgCustomization> => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      authorize(scope, 'org.update')
      const current = await loadCustomization(ctx, scope.orgId)
      const { banner, ...rest } = req.body
      const next: OrgCustomization = { ...current, ...rest }

      if (banner !== undefined) {
        const same =
          banner &&
          current.banner &&
          banner.text === current.banner.text &&
          banner.tone === current.banner.tone &&
          (banner.linkUrl ?? null) === (current.banner.linkUrl ?? null) &&
          (banner.linkLabel ?? null) === (current.banner.linkLabel ?? null)
        // A changed banner gets a new id, so people who dismissed the old one see it.
        next.banner = banner ? { ...banner, id: same ? current.banner!.id : uuidv7() } : null
      }

      if (rest.autoJoinChannelIds?.length) {
        const ok = await ctx.db
          .select({ id: channels.id })
          .from(channels)
          .where(
            and(
              eq(channels.orgId, scope.orgId),
              eq(channels.kind, 'public'),
              isNull(channels.archivedAt),
              inArray(channels.id, rest.autoJoinChannelIds),
            ),
          )
        if (ok.length !== new Set(rest.autoJoinChannelIds).size)
          throw badRequest('New members can only be added to public channels.')
      }

      await ctx.db
        .update(organizations)
        .set({
          settings: sql`${organizations.settings} || ${JSON.stringify({ customization: next })}::jsonb`,
        })
        .where(eq(organizations.id, scope.orgId))
      await audit(ctx.db, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'org.customization_updated',
        metadata: { fields: Object.keys(req.body) },
        ip: req.ip,
      })
      await ctx.bus.publish(topics.org(scope.orgId), { type: 'org.updated', orgId: scope.orgId })
      return next
    },
  )

  app.put(
    '/api/orgs/:orgId/profile',
    { schema: { params: orgParams, body: profileValuesSchema } },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      if (scope.role === 'guest') throw forbidden('Guests don’t have a profile in this workspace.')
      const { profileFields } = await loadCustomization(ctx, scope.orgId)
      const profile = cleanProfileValues(profileFields, req.body)
      await ctx.db
        .update(orgMemberships)
        .set({ profile })
        .where(and(eq(orgMemberships.orgId, scope.orgId), eq(orgMemberships.userId, scope.userId)))
      return { profile }
    },
  )
}
