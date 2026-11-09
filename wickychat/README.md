# Quid

Quid is a communication platform for organizations. This repository contains
**Quid Chat** (Stage A foundation and Stage B chat), with the architecture in
place for Quid Voice, Quid Meet and the wider Quid ecosystem (Drive, Docs, Mail,
Calendar, Tasks, AI, Flow, Apps).

## What works today

- **Accounts**: Sign in with Google, email and password sign-up, email verification, sign-in, sign-out, password reset, session management across devices.
- **Organizations**: create and switch between several organizations, invite people by email, departments, teams, a people directory, six roles (owner, admin, department admin, team manager, member, guest), organization settings, an admin dashboard with usage metrics and connected-app controls, and an audit log.
- **Chat**: public and private channels, DMs and group conversations, realtime delivery over WebSockets, threads, reactions, rich text and code blocks, @mentions and #channel links, file and image attachments, pins, saved items, forwarding, drafts synced across devices, scheduled messages, read state with a "New" divider, typing indicators, presence and custom status, and archiving.
- **Search** across messages, channels, people and files, with `from:`, `in:`, `before:`, `after:`, `on:` and `has:file` filters.
- **Activity**: notifications for mentions, DMs, thread replies and announcements, with preferences, muting and grouping. Email summaries of what you missed while away, and an optional daily summary each morning.
- **Integrations**: incoming webhooks, GitHub webhooks, signed outgoing webhooks and bot identities, with encrypted credential storage.
- **AI groundwork**: a provider abstraction (Anthropic first), encrypted keys, explicit admin consent before any data leaves Quid, and a permission-aware context service.
- **Voice calls**: one-to-one and group calls in DMs and group conversations, which ring the other people, and open calls in channels that members can join. Incoming-call card with accept and decline, mute, microphone and speaker selection, live speaking indicators, call timer, missed-call notifications and call history. Audio runs through a self-hosted LiveKit server.
- **Quid Meet**: instant and scheduled video meetings with shareable links and codes, a pre-join preview with device selection, waiting room, host and co-host controls (admit, deny, mute, remove, end for everyone), camera, microphone, screen sharing, in-meeting chat, gallery and speaker views, a participant list, email and in-app invitations, history, one-click moving of a voice call into a meeting, guest links so people without a Quid account can join (always through the waiting room), live captions with saved transcripts, recording (in the host's browser, saved to their computer, with a visible indicator for everyone), and calendar invites (Google, Outlook, .ics) with update and cancellation emails.
- **Billing**: a 14-day free trial with every feature, then Quid Pro ($4 per member per month, $40 per year) or Quid Enterprise+ ($8 / $80), with guests free. Enterprise+ adds message retention rules, audit log export, require-Google sign-in, and private and community plugins. Payments go through PayPal (Paddle is supported too, switchable with one setting). Seats follow your member count, and a lapsed workspace turns read-only, never deleted. Billing is off unless configured.
- **Plugins**: slash commands and automations from other developers, which run on their own servers and use signed requests. Every plugin passes automatic safety checks, listed plugins are **Verified** (reviewed by the Quid team) or **Unverified** (community), and Enterprise+ adds private plugins and community installs. See `docs/PLUGINS.md`.
- **Connect Claude (MCP)**: Quid is a remote MCP server. Add `<your Quid URL>/api/mcp` as a custom connector in Claude (or `claude mcp add --transport http quid <url>` in Claude Code), approve it on Quid's consent page, and Claude can list your channels, read conversations and threads, search, see your mentions and, if you allowed it, send messages as you. It only sees what you can see. Manage connections and personal tokens in Settings → Connected apps.
- **Voice rooms**: every channel has an always-on audio room people drop into without ringing anyone. Open mode (everyone talks) or stage mode (speakers and listeners, raise hand, moderators invite people to speak), moderator mute and remove, and live indicators in the sidebar.

## Repository layout

```
apps/web         Next.js 16 web app (React 19, Tailwind v4, TanStack Query, Tiptap)
apps/api         Fastify 5 API + WebSocket gateway (modular monolith)
apps/e2e         Playwright end-to-end tests
packages/db      Drizzle schema, migrations, dev seed
packages/shared  Zod schemas, permission matrix, rich-text validator, realtime event types
packages/ui      Design tokens and components
packages/config  Shared TypeScript config
infra/           docker-compose (dev), Dockerfiles, GCP deploy script
docs/            Architecture, database, deployment, security, environment, API
```

## Local development

Requirements: Node 24 (`nvm use`), pnpm 10, and Docker or Podman.

```bash
pnpm install
cp .env.example .env
pnpm infra:up            # Postgres 17 + Mailpit (docker compose)
docker compose -f infra/docker-compose.yml --profile media up -d livekit   # voice calls
pnpm db:migrate
pnpm db:seed             # optional: "[DEV] Acme Demo" workspace
pnpm dev                 # web on :3000, API on :4000
```

- App: http://localhost:3000
- Emails (verification, invites, resets): http://localhost:8025 (Mailpit, a local test inbox). To send to real inboxes, see [Email](docs/DEPLOYMENT.md#email) and check it with `pnpm email:test you@example.com`.
- API reference (OpenAPI): http://localhost:4000/api/docs

The seed creates `ada@dev.quid.local` (owner) and five teammates with the password
`quid-dev-password`. The organization is labelled **[DEV] Acme Demo** and the seed
refuses to run when `NODE_ENV=production`.

> **No Docker access?** Rootless Podman works with the same images:
> `podman run -d --name quid-postgres -e POSTGRES_USER=quid -e POSTGRES_PASSWORD=quid -e POSTGRES_DB=quid -p 5432:5432 docker.io/library/postgres:17-alpine`
> and `podman run -d --name quid-mailpit -p 1025:1025 -p 8025:8025 docker.io/axllent/mailpit`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the web app and API with hot reload |
| `pnpm build` | Production builds (API bundle, Next standalone) |
| `pnpm typecheck` | TypeScript across the monorepo |
| `pnpm lint` / `pnpm format` | Biome lint and format |
| `pnpm test` | Unit tests plus API integration tests against a real Postgres (`quid_test` database) |
| `pnpm e2e` | Playwright: sign up and chat live, a voice call, a voice room and a video meeting. Starts its own servers on ports 3100/4100 that always use the local test inbox (needs `pnpm db:seed`, Mailpit and LiveKit) |
| `pnpm email:test you@example.com` | Sends one real email with the current email settings |
| `pnpm db:generate` | Generates a migration from schema changes |
| `pnpm db:migrate` / `pnpm db:seed` | Applies migrations / seeds dev data |

Integration tests use `TEST_DATABASE_URL` (default `postgres://quid:quid@localhost:5432/quid_test`).
Create the database once with `createdb quid_test`, or `podman exec quid-postgres psql -U quid -c "create database quid_test"`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): system design, realtime, modules, extension points, remaining work
- [Database](docs/DATABASE.md): schema, indexes, pagination, migrations
- [Deployment](docs/DEPLOYMENT.md): Google Cloud setup, costs, operations
- [Security](docs/SECURITY.md): authentication, authorization, tenant isolation, data handling
- [Environment](docs/ENVIRONMENT.md): every configuration variable
- [API](docs/API.md): REST conventions, realtime protocol, webhooks
