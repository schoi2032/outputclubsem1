# Environment variables

Local development reads the repository-root `.env` (copy `.env.example`). In production, values come from Cloud Run environment variables and Secret Manager (see `infra/gcp/deploy.sh`). The API validates its configuration at startup and refuses to boot when required production values are missing.

## API (`apps/api`)

| Variable | Default | Production | Description |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | Enables production checks |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | `8080` | Listen address |
| `LOG_LEVEL` | `info` | `info` | pino level |
| `DATABASE_URL` | `postgres://quid:quid@localhost:5432/quid` | secret | Postgres connection string. For Cloud SQL sockets, leave the host empty and set `PGHOST` |
| `PGHOST` | — | `/cloudsql/<connection>` | Cloud SQL Unix socket directory |
| `DATABASE_POOL_MAX` | `10` | | Connection pool size |
| `WEB_ORIGIN` | `http://localhost:3000` | web URL | Used in email links, origin checks and the cookie `Secure` flag |
| `PUBLIC_WS_URL` | `ws://localhost:4000/ws` | `wss://<api>/ws` | Handed to clients with their ticket |
| `EXTRA_ORIGINS` | — | | Comma-separated extra allowed origins |
| `COOKIE_SECURE` | derived from `WEB_ORIGIN` | | Force the `Secure` cookie flag |
| `SESSION_TTL_DAYS` | `30` | | Sliding session lifetime |
| `TRUST_PROXY` | `true` | | Trust `X-Forwarded-*` |
| `ENCRYPTION_KEY` | dev-only key | **required**, secret | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts integration credentials and signs WebSocket tickets |
| `INTERNAL_TOKEN` | — | **required**, secret | Shared secret for `/internal/cron/tick` |
| `OFFICIAL_PLUGINS_URL` | — | plugins service URL | Where Quid's official plugins (`apps/plugins`) run. With `OFFICIAL_PLUGINS_KEY`, they're listed as verified and official |
| `OFFICIAL_PLUGINS_KEY` | — | secret | Shared with the plugin service; each official plugin's signing secret is derived from it |
| `EMAIL_PROVIDER` | `smtp` | `brevo` | `smtp`, `brevo`, `resend` or `console` (log only) |
| `EMAIL_FROM` | `Quid <no-reply@quid.local>` | your sender | From address |
| `SMTP_URL` | `smtp://localhost:1025` | secret | Any SMTP server. Mailpit locally, Gmail with an app password (`smtps://you%40gmail.com:pass@smtp.gmail.com:465`), etc. Check it with `pnpm email:test you@example.com` |
| `BREVO_API_KEY` | — | secret | Required when `EMAIL_PROVIDER=brevo`. `EMAIL_FROM` must be a sender address verified in Brevo |
| `RESEND_API_KEY` | — | secret | Required when `EMAIL_PROVIDER=resend` (needs a verified domain) |
| `STORAGE_DRIVER` | `local` | `gcs` | `local` or `gcs` |
| `STORAGE_LOCAL_DIR` | `.storage` | | Relative to the API's working directory |
| `GCS_BUCKET` | — | bucket name | Required when `STORAGE_DRIVER=gcs` |
| `EVENT_BUS` | `memory` | `memory` | `redis` to fan out across instances |
| `REDIS_URL` | — | | Required when `EVENT_BUS=redis` |
| `JOBS_POLL` | `true` | `true` | In-process job poller (Cloud Scheduler also ticks) |
| `BILLING_PROVIDER` | `none` | `paypal` (or `paddle`) to charge | `none` gives every workspace full access. `paypal` or `paddle` turns on trials and Quid Pro with that provider |
| `PAYPAL_ENV` | `sandbox` | `live` when live | Which PayPal environment the app credentials belong to |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | unset | with PayPal | REST app credentials (developer.paypal.com → Apps & Credentials). The secret is secret, the client ID is public |
| `PAYPAL_WEBHOOK_ID` | unset | with PayPal | ID of the app's webhook for `<WEB_ORIGIN>/api/billing/paypal/webhook` (`BILLING.SUBSCRIPTION.*`, `PAYMENT.SALE.COMPLETED`) |
| `PAYPAL_PLAN_MONTHLY` / `PAYPAL_PLAN_YEARLY` | unset | with PayPal | Pro plan IDs printed by `pnpm billing:setup` |
| `PAYPAL_PLAN_ENT_MONTHLY` / `PAYPAL_PLAN_ENT_YEARLY` | unset | to offer Enterprise+ | Enterprise+ plan IDs ($8 / $80), also printed by `pnpm billing:setup`. Paddle uses `PADDLE_PRICE_ENT_MONTHLY` / `PADDLE_PRICE_ENT_YEARLY` |
| `PAYPAL_PLAN_INTRO_MONTHLY` / `PAYPAL_PLAN_ENT_INTRO_MONTHLY` | unset | for the welcome offer | Monthly plans whose first 2 months are 20% off, printed by `pnpm billing:setup`. When set, workspaces that never subscribed get the offer until a week after their trial (shown in the app and in trial emails) |
| `PAYPAL_PROMO_PLANS` | unset | for promo codes | `CODE:tier:planId` pairs, comma-separated, printed by `pnpm billing:setup`. Codes themselves (discount, months, expiry) live in `apps/api/src/modules/billing/promos.ts`; admins apply them in Settings → Billing or via a `?promo=CODE` link |
| `PADDLE_ENV` | `sandbox` | `production` when live | Which Paddle environment the keys belong to |
| `PADDLE_API_KEY` | unset | with Paddle | Server API key (secret) |
| `PADDLE_CLIENT_TOKEN` | unset | with Paddle | Client-side token for Paddle.js (public) |
| `PADDLE_WEBHOOK_SECRET` | unset | with Paddle | Secret of the notification destination `<WEB_ORIGIN>/api/billing/paddle/webhook` (subscription events) |
| `PADDLE_PRICE_MONTHLY` / `PADDLE_PRICE_YEARLY` | unset | with Paddle | Price IDs printed by `pnpm billing:setup` ($4 per member per month, $40 per year) |
| `TRIAL_DAYS` | `14` | | Free trial length for new workspaces |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | to enable Google sign-in | OAuth client (type *Web application*) from Google Cloud Console → APIs & Services → Credentials. Authorized redirect URI: `<WEB_ORIGIN>/api/auth/google/callback`. Set both, or neither; the secret belongs in Secret Manager |
| `OPEN_REGISTRATION` | `true` | your choice | `false` makes sign-up invitation-only |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | dev: `ws://localhost:7880`, `devkey`, `secret` | secrets from `infra/livekit/deploy.sh` | LiveKit server for voice calls. When unset, calls show as unavailable |

## Web (`apps/web`)

| Variable | When | Description |
|---|---|---|
| `API_URL` | **build time** | Where `/api/*` is proxied. Next.js resolves rewrites at build time, so it's a Docker build argument |
| `PORT` | runtime | Defaults to 3000 (8080 in the container) |

## Tests

| Variable | Default | Description |
|---|---|---|
| `TEST_DATABASE_URL` | `postgres://quid:quid@localhost:5432/quid_test` | Integration tests drop and recreate the `public` schema here. **Never point it at real data.** |
| `E2E_BASE_URL` | — | Run Playwright against an already-running deployment instead of starting dev servers |
| `MAILPIT_URL` | `http://localhost:8025` | Where E2E tests read emails |

## Official plugins (`apps/plugins`)

| Variable | Default | Production | Description |
|---|---|---|---|
| `OFFICIAL_PLUGINS_KEY` | — | secret | Same value as the API's |
| `DATABASE_URL` / `PGHOST` | — | secret / socket | Same database as the API; the service keeps its tables in the `official_plugins` schema |
| `PORT` | `4200` | `8080` | Listen address |
| `GOOGLE_TRANSLATE_API_KEY` | — | | For `/translate` outside Cloud Run. On Cloud Run the service account is used |
