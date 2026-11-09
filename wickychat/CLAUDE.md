# Working on Quid

Quid is a Slack/Teams-style app: chat, voice rooms, calls, Meet, Claude MCP connector, billing.
The owner makes product calls and handles accounts and keys; Claude writes the code. See `docs/` for architecture, security and deployment.

## How the owner likes to work
- Keep replies short and casual. Build first, ask only real decisions.
- Never type, paste or print secrets (API keys, passwords, tokens). The owner puts them in `.env` themselves (local helper pages in `~/Downloads` generate the commands). Mask anything key-shaped in output.
- Commit after each feature; push to the private GitHub repo.

## Commands
- Every shell needs Node 24: `. ~/.nvm/nvm.sh && nvm use 24`.
- `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm e2e` (Playwright, own servers on 3100/4100/4300, runs serially).
- Official plugins service: `apps/plugins` (tests: `cd apps/plugins && pnpm exec vitest run`).
- API tests: `cd apps/api && pnpm exec vitest run`.
- Migrations: edit `packages/db/src/schema.ts`, then `cd packages/db && pnpm exec drizzle-kit generate --name <x> && pnpm migrate`. Don't remove and add columns in one go (drizzle-kit prompts); do additive first, drop later.
- Local infra is rootless Podman (`quid-postgres`, `quid-mailpit`, `quid-livekit`); Docker isn't available.

## Gotchas
- Biome reformats on `biome check --write`; scripted string replacements must assert they matched.
- Drizzle raw `sql` templates don't serialize `Date` with postgres.js; use `lt`/`gt` helpers.
- E2E tests share seeded users (ada, ben…), so `workers: 1`.
- Don't edit `infra/gcp/deploy.sh` while a deploy is running from it.

## Production
- Site: https://quidchat.pages.dev (Cloudflare Pages proxy in `infra/cloudflare`) → Cloud Run in `asia-northeast3` (quid-web, quid-api, quid-plugins). LiveKit on a GCE VM (`infra/livekit`).
- Redeploy: `PROJECT_ID=<project> ENV_FILE=.env ./infra/gcp/deploy.sh` (gcloud is at `~/google-cloud-sdk/bin`). It keeps the live web address and reads only provider keys from `.env`.
- Billing: PayPal by default (`BILLING_PROVIDER=paypal`); Paddle is kept and switchable. Public pages name the provider via `NEXT_PUBLIC_PAYMENT_PROCESSOR`.
