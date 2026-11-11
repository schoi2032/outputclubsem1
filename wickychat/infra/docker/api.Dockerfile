# Quid API: Fastify + WebSocket gateway. Also used for the migration job.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @quid/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @quid/api build
# Production node_modules for the API only (workspace packages are bundled).
RUN pnpm --filter @quid/api deploy --prod --legacy /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
