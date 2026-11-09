# Quid web app: Next.js standalone server.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo

FROM base AS build
# Rewrites are resolved at build time, so the API origin is a build argument.
ARG API_URL
ENV API_URL=${API_URL}
# Which payment company public pages name (paypal or paddle).
ARG NEXT_PUBLIC_PAYMENT_PROCESSOR=paypal
ENV NEXT_PUBLIC_PAYMENT_PROCESSOR=${NEXT_PUBLIC_PAYMENT_PROCESSOR}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @quid/web...
COPY packages packages
COPY apps/web apps/web
RUN test -n "$API_URL" || (echo "API_URL build arg is required" && exit 1)
RUN pnpm --filter @quid/web build

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
