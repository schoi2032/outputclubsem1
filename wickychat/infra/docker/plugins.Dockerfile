# Quid's official plugins (apps/plugins): one small service for all of them.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/plugins/package.json apps/plugins/
RUN pnpm install --frozen-lockfile --filter @quid/plugins...
COPY packages packages
COPY apps/plugins apps/plugins
RUN pnpm --filter @quid/plugins build
RUN pnpm --filter @quid/plugins deploy --prod --legacy /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/plugins/dist ./dist
COPY --from=build /repo/apps/plugins/icons ./icons
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
