# Deployment (Google Cloud)

`infra/gcp/deploy.sh` provisions and deploys everything. It's idempotent: run it again to ship a new version.

## What gets created

| Resource | Purpose | Notes |
|---|---|---|
| Artifact Registry `quid` | Container images | |
| Cloud Run `quid-api` | API + WebSocket gateway | min 1, **max 1** instance (in-memory event bus), 60-minute request timeout, session affinity |
| Cloud Run `quid-web` | Next.js app, proxies `/api/*` | scales to zero, up to 3 instances |
| Cloud Run job `quid-migrate` | Applies migrations | runs before each API rollout |
| Cloud SQL `quid-pg` | PostgreSQL 17, `db-f1-micro`, 10 GB SSD, daily backups | reached over the Cloud SQL Unix socket |
| Cloud Storage bucket | Uploaded files | private, uniform access; downloads use 5-minute signed URLs |
| Secret Manager | `quid-database-url`, `quid-encryption-key`, `quid-internal-token`, plus email, Google and Paddle settings when given | generated on first run |
| Cloud Scheduler `quid-tick` | Every minute: scheduled messages, webhook retries | |
| Service accounts | `quid-api` (Cloud SQL client, secret accessor, bucket object admin, signs its own URLs), `quid-web` (no extra roles) | |

Created separately: the LiveKit VM for voice calls (next section). Not created yet, on purpose: Memorystore (Redis). See "Scaling up" below.

## Prerequisites

1. A GCP project with billing enabled. The $300 credit covers several months at the costs below.
2. The [gcloud CLI](https://cloud.google.com/sdk/docs/install), signed in: `gcloud auth login`.
3. `openssl` and `git` (used by the script).
4. A way to send email (see **Email** below). Without one, emails are written to the logs instead of sent, so verification links and invitations won't reach people.

## Deploy

```bash
# Preview every command without changing anything:
DRY_RUN=1 PROJECT_ID=your-project ./infra/gcp/deploy.sh

# Deploy:
PROJECT_ID=your-project \
BREVO_API_KEY=xkeysib-... \
EMAIL_FROM="Quid <you@gmail.com>" \
./infra/gcp/deploy.sh
```

Options (environment variables): `REGION` (default `asia-northeast3` Seoul; `us-central1` is cheaper), `SQL_TIER`, `OPEN_REGISTRATION=false` (invite-only), `WEB_URL` (if you map a custom domain).

The script prints the web URL when it finishes. Sign up, create your organization, then invite your team.

### Reading settings from `.env`

`ENV_FILE=.env` makes the script read these names from your `.env`, if you haven't exported them already: email (`BREVO_API_KEY`, `SMTP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`), Google sign-in, Paddle and `OPEN_REGISTRATION`. Nothing else in the file is read, localhost SMTP URLs are skipped, and values go straight into Secret Manager without being printed. Values are kept as secrets, so later runs don't need them again.

```bash
PROJECT_ID=your-project ENV_FILE=.env ./infra/gcp/deploy.sh
```

When it finishes, the script prints the addresses to register with Google and Paddle.

### Sign in with Google

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) for the same project, open **Google Auth Platform**. Set up branding with the app name *Quid* and a support email, choose audience **External**, then publish the app. Only the basic `openid email profile` scopes are used, so Google's verification review isn't required.
2. Go to **Clients → Create client → Web application**. Add the authorized redirect URI the deploy script printed: `https://quid-web-….run.app/api/auth/google/callback`. For local development, also add `http://localhost:3000/api/auth/google/callback`.
3. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, then run the deploy again with `ENV_FILE=.env`.

### Billing (PayPal)

Quid Pro is $4 per member per month, or $40 per year, after a 14-day trial. Guests are free.

1. At [developer.paypal.com](https://developer.paypal.com), sign in with your PayPal account. Go to **Apps & Credentials** and make sure **Sandbox** is selected, then **Create App**. Copy the **Client ID** and **Secret** into `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, with `PAYPAL_ENV=sandbox` and `BILLING_PROVIDER=paypal`.
2. Run `pnpm billing:setup`. It creates the *Quid Pro* product and both per-member plans, and prints `PAYPAL_PLAN_MONTHLY` and `PAYPAL_PLAN_YEARLY` for `.env`.
3. In the app's settings, add a **webhook** for `https://<your Quid URL>/api/billing/paypal/webhook` with the `BILLING.SUBSCRIPTION.*` and `PAYMENT.SALE.COMPLETED` events. Copy its **Webhook ID** into `PAYPAL_WEBHOOK_ID`.
4. Run the deploy with `ENV_FILE=.env`. Test with a sandbox buyer account (developer dashboard → Sandbox accounts).
5. To go live, switch the dashboard to **Live**, then repeat steps 1 to 3 with the live credentials and `PAYPAL_ENV=live`.

To switch to Paddle instead, set `BILLING_PROVIDER=paddle` with the Paddle values below. Public pages then name Paddle automatically.

### Billing (Paddle)

Quid Pro is $4 per member per month, or $40 per year, after a 14-day trial. Guests are free.

1. Create a [Paddle](https://www.paddle.com) account (it must belong to an adult or a registered business). Start with a **sandbox** account at sandbox-vendors.paddle.com to test with test cards.
2. **Developer tools → Authentication:** create an API key (`PADDLE_API_KEY`) and a client-side token (`PADDLE_CLIENT_TOKEN`).
3. Put both in `.env` with `PADDLE_ENV=sandbox`, then run `pnpm billing:setup`. It creates the *Quid Pro* product and both prices, and prints `PADDLE_PRICE_MONTHLY` and `PADDLE_PRICE_YEARLY` for `.env`.
4. **Checkout → Checkout settings:** set the default payment link to your Quid URL. In live mode, also add it under approved websites.
5. **Developer tools → Notifications:** add a destination for `https://quid-web-….run.app/api/billing/paddle/webhook` with the `subscription.*` events. Copy its secret key into `PADDLE_WEBHOOK_SECRET`.
6. Set `BILLING_PROVIDER=paddle` and run the deploy again with `ENV_FILE=.env`. Billing turns on only when all five Paddle values are present.

To go live, repeat steps 2 to 5 in the live dashboard and set `PADDLE_ENV=production`. Live and sandbox keys aren't interchangeable.

### Email

Quid sends verification links, invitations, password resets and meeting invitations. Pick one:

| Option | Needs | Limits |
|---|---|---|
| **Brevo API key** (easiest) | A free [Brevo](https://www.brevo.com) account. Verify your own email address as a sender (no domain needed) and create an API key | 300 emails a day free. Mail is sent from the address you verified |
| **Gmail SMTP** | A Google account with 2-Step Verification and an [app password](https://myaccount.google.com/apppasswords) | About 500 recipients a day. Mail is sent from your Gmail address |
| **Resend** | A domain you control: add its DNS records at [resend.com/domains](https://resend.com/domains) | Free tier 3,000 emails a month. Sends from your own domain |
| Any SMTP service | SMTP credentials (SendGrid, Mailgun, Amazon SES, Google Workspace…) | The provider's limits |

**Locally:** set the values in `.env` (examples in `.env.example`), restart `pnpm dev`, then run:

```bash
pnpm email:test you@example.com
```

It sends one real email and prints the exact error if delivery fails. The API also logs which provider is active at startup and warns if the SMTP login doesn't work.

For Gmail, the URL looks like `smtps://you%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465`. Write the `@` in the address as `%40`, and remove the spaces from the app password. Set `EMAIL_FROM` to the same Gmail address, or Gmail rewrites it.

**In production:** pass `BREVO_API_KEY` (or `SMTP_URL`, or `RESEND_API_KEY`) and `EMAIL_FROM` to `deploy.sh` once. The credential is stored in Secret Manager (`quid-brevo-api-key`, `quid-smtp-url` or `quid-resend-api-key`) and reused on later deploys. Pass it again to rotate it.

### Enable voice calls and meetings

Voice calls and Quid Meet need a LiveKit media server. `infra/livekit/deploy.sh` creates one on a small VM, with no domain needed:

```bash
PROJECT_ID=your-project ./infra/livekit/deploy.sh   # static IP, firewall, VM, keys in Secret Manager
PROJECT_ID=your-project ./infra/gcp/deploy.sh       # re-run so the API picks up the LiveKit settings
```

It creates a static IP, a firewall rule (TCP 80, 443, 7881 and UDP 50000–60000), a Container-Optimized OS VM (`e2-small` by default, `LIVEKIT_MACHINE` to change it) running LiveKit and Caddy, and three secrets (`quid-livekit-url`, `-key`, `-secret`). The VM reads its keys from Secret Manager at boot. Caddy gets a Let's Encrypt certificate for `livekit.<ip-with-dashes>.sslip.io`. Until LiveKit is configured, the app shows voice calls as unavailable instead of failing.

Very restrictive corporate networks that block UDP may need a TURN server (LiveKit's built-in TURN/TLS on 443 needs its own domain and certificate). Most networks work with UDP or the TCP 7881 fallback.

### Custom domain later

Map a domain to `quid-web` (Cloud Run domain mappings, or a load balancer), then re-run with `WEB_URL=https://chat.yourdomain.com` so cookies, email links and origin checks use it.

## Estimated monthly cost

Rough estimates for a small team (under 50 people) in `asia-northeast3`, before taxes. Check current prices with the [GCP pricing calculator](https://cloud.google.com/products/calculator).

| Item | Estimate |
|---|---|
| Cloud SQL `db-f1-micro` + 10 GB SSD + backups | $11–15 |
| Cloud Run API, 1 warm instance (CPU only allocated during requests and WebSockets) | $8–20 |
| Cloud Run web (scales to zero) | $0–5 |
| Cloud Storage, Artifact Registry, Secret Manager, Scheduler | $1–3 |
| Cloud Build (deploys; first 2,500 build-minutes a month free on e2-standard-2) | $0–2 |
| LiveKit VM `e2-small` + static IP (calls and small meetings) | $15–20 + network egress for media |
| **Total** | **≈ $35–65 / month** with voice, **≈ $20–45** without |

Adding later:

| Item | Estimate |
|---|---|
| Larger LiveKit VM for busy video meetings (`e2-standard-2`, set `LIVEKIT_MACHINE`) | ≈ $50–60 + egress |
| Memorystore Redis basic 1 GB | ≈ $35–50 |

Cost levers: pick `us-central1`, set the API to `--min-instances 0` (adds cold starts and reconnects), or stop the SQL instance when it isn't in use.

## Operations

- **Logs:** Cloud Logging, as structured JSON from pino. Cookies, authorization headers, passwords and tokens are redacted.
- **Health:** `GET /healthz` (process) and `GET /readyz` (database) on the API.
- **Rollback:** `gcloud run services update-traffic quid-api --to-revisions=<previous>=100` (same for `quid-web`). Migrations are forward-only, so keep them backward compatible.
- **Backups:** Cloud SQL automated daily backups, 7 retained. Restore with `gcloud sql backups restore`.
- **Rotating secrets:** add a new secret version and redeploy. `ENCRYPTION_KEY` rotation also requires re-encrypting `integration_credentials` (`key_version` is stored for this).

## Scaling up

1. **More than one API instance:** create Memorystore (or Upstash), set `EVENT_BUS=redis` and `REDIS_URL`, move presence to Redis (see ARCHITECTURE.md), then raise `--max-instances`.
2. **Database:** move to `db-custom-1-3840` or larger, add a read replica for search, and consider a connection pooler.
3. **Search:** switch `SearchService` to Typesense or Elasticsearch when Postgres full-text search stops being enough.

## Teardown

```bash
gcloud run services delete quid-web quid-api --region $REGION
gcloud run jobs delete quid-migrate --region $REGION
gcloud scheduler jobs delete quid-tick --location $REGION
gcloud sql instances delete quid-pg            # deletes all data
gcloud storage rm -r gs://$PROJECT_ID-quid-files
gcloud secrets delete quid-database-url quid-encryption-key quid-internal-token
gcloud artifacts repositories delete quid --location $REGION
```

## WickyChat on Vercel: voice with LiveKit Cloud

WickyChat runs on Vercel, so instead of the VM above it uses LiveKit Cloud (free tier is fine
for a school). The API only needs three settings; until they're set, calls show as unavailable.

1. Create a project at https://cloud.livekit.io (region near Korea, e.g. Tokyo).
2. Settings → Keys → create a key.
3. In your own terminal: `./scripts/setup-livekit.sh`. It asks for the URL, key and secret,
   saves them as Vercel production variables (`LIVEKIT_URL`, `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET`, the secret marked sensitive) and redeploys.

No webhook is needed.
