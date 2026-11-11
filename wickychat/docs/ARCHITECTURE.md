# Architecture

## Overview

```
 Browser ──HTTPS──▶ quid-web (Next.js, Cloud Run)
    │                   │  /api/*  rewrite (same origin, first-party cookie)
    │                   ▼
    │              quid-api (Fastify, Cloud Run) ──▶ Cloud SQL (Postgres 17)
    │                   │                         ──▶ Cloud Storage (files)
    └──WSS (ticket)────▶│                         ──▶ Resend (email)
                        │◀── Cloud Scheduler (POST /internal/cron/tick, every minute)
```

- **One modular API service.** Each domain is a module under `apps/api/src/modules`: auth, orgs, channels, messages, files, search, presence, notifications, integrations, ai, media. Modules talk to each other through exported service functions, never through each other's tables. When load requires it, a module can move into its own service behind the same interfaces.
- **The web app is a client of the API.** Next.js serves the UI and proxies `/api/*` to the API. The browser only ever talks to the web origin for HTTP, so the session cookie is first-party. That matters because `run.app` is a public suffix, so cookies can't be shared between two `run.app` services.
- **Shared contracts.** `packages/shared` holds the Zod request schemas, response types, the permission matrix, the rich-text validator and the realtime event union. Both the API and the web app import it, so client and server can't drift apart.

## Realtime

1. The client calls `GET /api/realtime/ticket` through the web origin and receives a 30-second, single-use HMAC-signed ticket plus the WebSocket URL.
2. It connects straight to `wss://<api>/ws?ticket=…`. The gateway verifies the ticket and the `Origin` header.
3. Each connection subscribes to topics: `user:<id>`, `org:<id>` for each organization, and `channel:<id>` for every channel the user belongs to. Subscriptions follow membership changes automatically. A user previewing a public channel they haven't joined can subscribe to it after an access check.
4. Services publish events to an **EventBus**. `MemoryEventBus` is used with a single instance. `RedisEventBus` (`EVENT_BUS=redis`) fans out across instances.
5. The client applies events directly to the React Query cache (`apps/web/src/lib/realtime.ts`). After a reconnect it invalidates the cache, which resyncs anything missed. Cloud Run ends requests after 60 minutes, so reconnects are routine.

Typing indicators are throttled on both ends. Presence combines live connections, client activity pings (idle after 10 minutes means "away") and the manually chosen status (active, away, do not disturb), with optional expiry.

**Scaling note:** presence connection counts and ticket single-use checks are per instance. The API is deployed with `max-instances=1` until Redis is added. Moving presence to Redis is the first task before scaling out.

## Voice calls

- **Quid owns call state; LiveKit only carries audio.** `modules/calls` stores who was invited, who joined and how the call ended (`calls`, `call_participants`). LiveKit sees only a room name (`call_<id>`) and short-lived (10-minute) join tokens that the API issues after the same channel-membership check used everywhere else.
- **DMs and group conversations ring.** Starting a call invites the other members (`call.ringing` event, an `incoming_call` notification and a 45-second timeout job). A 1:1 call ends when either side hangs up. A group call ends when the last person leaves. Unanswered calls become `missed` and notify the invitees, and declined 1:1 calls become `rejected`.
- **Channel calls are open rooms.** Nobody is rung. Members see a "Call in progress · Join" banner and can drop in.
- **Disconnects.** If all of a user's WebSocket connections drop for 15 seconds, the API leaves their calls for them. Closing the tab also sends a leave beacon.
- Every state change is broadcast as `call.updated` to the participants and the channel. System messages ("started a call", "Call ended · 4m 12s", "Missed call") keep a record in the conversation.
- The browser side lives in `apps/web/src/components/calls/`: `CallProvider` (LiveKit room, remote audio, speaking and mute state, device switching), the incoming-call card, the call bar and a synthesized ringtone.

## Voice rooms

- One persistent room per channel (`voice_rooms`, `voice_room_participants`), created on first use. Joining requires channel membership. Nobody is rung.
- **Modes.** `open`: everyone can talk. `stage`: only speakers talk. Listeners join without publish rights in their media token, can raise a hand, and a moderator can invite them to speak, which updates their LiveKit publish permission live. Moving someone back to listeners revokes it, and the media server stops their audio.
- **Moderators** are channel owners and admins, org owners and admins, and anyone in the room's `moderatorIds`. They can switch modes, mute, remove and change roles. Everything is enforced by the API and the media server.
- `voice_room.updated` events keep the room panel and the sidebar indicators live for channel members.

## Live sessions and restarts

Only one call, voice room or meeting is active per browser tab (`apps/web/src/lib/session.ts`). Joining a new one leaves the previous one. People whose connections all drop leave everything after a 15-second grace period. On startup, a single-instance API clears call, meeting and room state left by the previous process (`core/live-sessions.ts`), since those timers didn't survive it.

## Quid Meet

- **Meetings** (`meetings`, `meeting_participants`) have a readable code (`kmt-qrxe-wpa`) and live at `/<org>/meet/<code>`. Instant meetings start when the first person joins. Scheduled ones send in-app and email invitations. A meeting ends when the last person leaves or a moderator ends it for everyone, and its link can be used to start it again.
- **Who gets in.** Any member of the organization with the link can ask to join. Guests need an invitation. With the waiting room on, people who weren't invited wait until a host or co-host admits them (`meeting.updated` events tell the waiting browser to connect). Invitees, moderators and people already admitted go straight in. Removed people can't rejoin unless invited again.
- **Host controls** run on the server and on the media server: admit and deny, make or remove co-host, mute (LiveKit server-side mute), remove (LiveKit disconnect), and end for everyone (LiveKit room deletion). Moderators get `roomAdmin` in their media token. Nobody can remove the host.
- **Chat** in a meeting uses LiveKit data messages (`quid-chat` topic). It's visible to people in the meeting and isn't stored.
- **In the browser** (`apps/web/src/components/meet/`): a lobby with camera preview and device selection, `useMeetingRoom` (LiveKit room, tiles, screen share, chat, disconnect reasons), a stage with gallery and speaker layouts where screen shares and pinned tiles take the main view, and side panels for chat and people.
- **Guest links.** When the host enables guest access, `/join/<code>` lets people without an account ask to join. They always wait for a moderator (even if the waiting room is off), appear as "(guest)", and are stored in `meeting_guests`. They have no session: the public API (`/api/public/meetings/...`) gives each guest a per-guest HMAC token, and their browser polls for admission because it has no realtime connection. Moderators can admit, deny and remove guests (removal also disconnects them on the media server).
- **Email notifications.** When a mention, DM, thread reply, missed call or meeting invite arrives for someone with no Quid tab open, a `notify.offline_email` job is scheduled 5 minutes out (one pending job per person and organization). When it runs, it sends one email listing whatever is still unread, unless they've come back online. The daily summary goes out around 8 AM in each person's time zone, from the scheduler tick. Real providers (Brevo, Resend) skip reserved test domains like `.local` and `example.com`, so seed data never reaches them.
- **Captions and transcripts.** Each person opts in for their own voice. Their browser's speech recognition (Web Speech API) turns it into text, which is shared live over a LiveKit data topic (`quid-captions`), and finished lines are uploaded to `meeting_transcript_segments`. Only attendees and the host can read a transcript. There's no server-side speech-to-text yet, so captions need a browser with speech recognition (Chrome, Edge, Safari).
- **Recording.** Hosts and co-hosts record in their own browser (`use-recording.ts`): it captures the meeting tab with `getDisplayMedia`, mixes everyone's audio with Web Audio, and saves a WebM file locally with `MediaRecorder`. Nothing is uploaded. The recorder announces itself over a LiveKit data topic every 10 seconds, so everyone (guests included, and late joiners) sees a Recording badge, which disappears if the announcements stop.
- **Calendar.** Scheduled meetings send invitations with an `.ics` attachment (`METHOD:REQUEST`, which mail apps show as "Add to calendar"). Changing the time or title sends an update with a higher `SEQUENCE`, and canceling sends `METHOD:CANCEL`. The Meet page has a month view, Google and Outlook links, and an `.ics` download.
- **Calls become meetings.** `POST /calls/:id/upgrade` creates a meeting without a waiting room, invites everyone in the call (they get a notification with a link) and moves the caller there.

## Messaging model

- Channels, DMs and group conversations share one `channels` table (`kind`), so membership, read state, history, search and permissions work the same everywhere. A DM has a `dm_key` (sorted participant ids), so each pair has exactly one DM.
- Message bodies are a restricted ProseMirror JSON document. `sanitizeDoc` validates every body against a whitelist of nodes and marks (no HTML, links limited to http, https and mailto). The client renders it with React elements and never uses `innerHTML`.
- IDs are UUIDv7, which is time-ordered, so `id` is the keyset-pagination cursor. History is fetched 50 at a time (`before`, `after`, `around`).
- Threads use `parent_id`, with denormalized `reply_count`, `last_reply_at` and the last five repliers on the root.
- Forwarding stores a snapshot of the original, so readers of the target never need access to the source channel.
- Optimistic sends carry a client id that the server echoes back, so the pending bubble is replaced in place.

## Permissions

`packages/shared/src/permissions.ts` is the single source of truth:

- **Org roles** (owner > admin > dept_admin > team_manager > member > guest) map to org actions (`can(role, action)`), plus `assignableRoles` and `canActOnMember` for role changes.
- **Channel access** (`canInChannel`) covers read, join, post, reply, manage, add and remove members, pin, archive and delete. It combines the org role, the channel role (owner, admin, member), the channel kind, the posting policy (`everyone` or `admins`) and archive state.

The API enforces these on every request (`requireOrg`, `authorize`, `requireChannel`). The web app uses the same functions only to decide what to show. See [SECURITY.md](SECURITY.md).

## Background work

`jobs` is a small Postgres-backed queue (`FOR UPDATE SKIP LOCKED`, retries with backoff). In production, Cloud Scheduler calls `POST /internal/cron/tick` every minute, which sends due scheduled messages and runs queued jobs such as webhook deliveries. In development, an in-process poller ticks every five seconds. No always-on worker is needed. The tick also sends offline-notification emails and daily summaries, and once an hour deletes credentials that can no longer be used (expired sessions, used or expired OAuth codes, and app tokens that stopped working more than 30 days ago). Scheduled messages have one-minute precision in production.

## Extension points

| Interface | Location | Implementations |
|---|---|---|
| `StorageAdapter` | `apps/api/src/adapters/storage.ts` | Local filesystem, Google Cloud Storage (V4 signed URLs) |
| `EmailAdapter` | `apps/api/src/adapters/email.ts` | SMTP (Mailpit), Resend, console |
| `EventBus` | `apps/api/src/core/eventbus.ts` | In-memory, Redis |
| `SearchService` | `apps/api/src/modules/search/service.ts` | Postgres full-text search and trigram. Swap in Typesense or Elasticsearch behind the same visibility rule |
| `MediaProvider` | `apps/api/src/adapters/media.ts` | LiveKit token issuer (Stages C and D) |
| `InboundIntegration` | `apps/api/src/modules/integrations/providers.ts` | Incoming webhook, GitHub |
| `Deliverer` | `apps/api/src/modules/notifications/service.ts` | In-app today. Email and push plug in here |
| `AIProvider` | `apps/api/src/modules/ai/providers.ts` | Anthropic (official SDK) |

All cloud-specific code sits behind these interfaces and environment variables. Moving off Google Cloud means providing another `StorageAdapter` and pointing `DATABASE_URL` elsewhere.

## Frontend

- App Router with an `(auth)` group and an `(app)` group. `proxy.ts` (Next 16's middleware) redirects visitors without a session cookie to sign-in. The API remains the real authority.
- Layout: product rail (Chat, Voice, Meet, Activity, Files, Search, org switcher, account menu), sidebar (saved items, drafts, people, channels grouped by department and team, DMs), main pane and thread panel. On phones the sidebar becomes the Chat home, with a bottom tab bar.
- Design system in `packages/ui`: CSS-variable tokens for light and dark, Geist Sans and Mono, neutral greys with one cobalt accent, Radix primitives for dialogs, menus, popovers, tooltips, tabs and switches.

## Billing

`BILLING_PROVIDER` picks the payment provider: `paypal` (default for the hosted service), `paddle`, or `none`. Each organization has a `billing_accounts` row, created on first use with a trial ending `TRIAL_DAYS` after the organization was created. Subscriptions are stored in a provider-neutral form (`provider`, `subscription_id`, `customer_id`, plan, seats, period end). Small mappers (`fromPayPal`, `fromPaddle`) translate each provider's records into it.

- **PayPal.** The browser renders PayPal's subscription buttons, with the plan, the seat count as `quantity`, and `custom_id = orgId`. When the payer approves, the browser sends the subscription ID to `POST /billing/sync`. The server reads the subscription from PayPal and checks `custom_id`. Webhooks (`/api/billing/paypal/webhook`) are verified with PayPal's verify-webhook-signature API, and the subscription is always re-read from PayPal rather than trusted from the payload. PayPal requires the payer to approve seat changes, so admins click "Update seats". That calls the revise API and sends them to PayPal's approval page. Cancelling in Quid cancels at PayPal, and access continues until the end of the paid period.
- **Paddle.** Paddle's checkout overlay passes `customData.orgId`. Webhooks are HMAC-verified on the raw body. The scheduler tick syncs seats automatically, prorated onto the next bill.

**Plans.** There are two tiers: Pro ($4 / $40) and Enterprise+ ($8 / $80). The tier is derived from the subscription's plan or price ID (`catalog()` maps tiers and intervals to provider IDs). Trials include Enterprise+. `billingState()` caches whether a workspace is locked and whether it has Enterprise+. `assertEnterprise()` guards the Enterprise+ features: retention, audit export, require-Google, private and community plugins. `POST /billing/change-plan` upgrades or downgrades through PayPal's revise flow, which the payer approves, or through Paddle's item update.

**Compliance (Enterprise+).** Retention (`organizations.settings.retentionDays`, 30 days to 10 years) runs hourly on the tick. It deletes messages older than the limit, along with their files and the stored bytes. Retention pauses if the workspace drops below Enterprise+. "Require Google sign-in" checks how each session signed in (`sessions.method`) inside `requireOrg`. It can only be turned on from a Google session, so admins can't lock themselves out, and it's hidden until Google sign-in is configured. The audit log exports as CSV, with values quoted and spreadsheet formulas defused.

Common to both: a workspace whose trial ended, or whose subscription is suspended, paused or cancelled past its paid period, is read-only. A `preHandler` hook answers 402 to state-changing organization requests, and `createMessage` checks too, which covers the MCP server, incoming webhooks and scheduled messages. Billing, admin settings, removing people, revoking access and read markers keep working. A cancelled subscription never takes over a workspace that has none, because the workspace ID on a subscription comes from the browser. Lock state is cached for 30 seconds per instance. Demo organizations are never billed. `pnpm billing:setup` creates the product and plans with the configured provider. Public pages name the provider through `NEXT_PUBLIC_PAYMENT_PROCESSOR`, which the deploy script sets to match.

## Admin dashboard

Settings → Dashboard (owners and admins) shows counts only, never message content: members and how many were active in the last 7 days, messages per day for 30 days, channels, file storage, meetings and calls, and connected apps. Admins can turn connected apps off for the whole organization, which cuts off every existing connection at once, and can revoke any member's connection. Both actions are audited.

## Remaining work

**Quid Voice: remaining.** A TURN server for very restrictive networks, and LiveKit webhooks so the API learns about media disconnects directly (and can replace the single-instance startup cleanup).

**Quid Meet: remaining.** Server-side recording to Quid Files (LiveKit Egress and storage), server-side speech-to-text for captions in every browser (LiveKit Agents plus a provider), breakout rooms, persistent meeting chat, calendar integration, and large town halls (a LiveKit cluster).

**Quid MCP server.** `POST /api/mcp` speaks MCP over Streamable HTTP (stateless JSON responses, protocol versions 2025-06-18, 2025-03-26 and 2024-11-05). Tools: `list_channels`, `read_channel` (and threads), `search_messages`, `list_mentions` and `send_message`. Each tool runs as the token's owner through the same channel checks as the HTTP API, so private channels someone isn't in look like they don't exist.

Authorization follows the MCP spec. A 401 points to protected-resource metadata (RFC 9728). The authorization server metadata (RFC 8414) is served from the web origin, which proxies `/.well-known/*` to the API. Clients register dynamically (RFC 7591) as public clients, and must use PKCE (S256 only). Redirect URIs must be https, or http on loopback. People approve on `/oauth/authorize`: they pick one organization and whether the app may send messages (`read` is always included, `write` is optional, and guests can't grant it). Codes are single-use and last 10 minutes. Access tokens last an hour, and refresh tokens last 30 days and rotate on every use. Personal tokens (`quid_pat_…`) are for tools that can't do OAuth. Only SHA-256 hashes of codes and tokens are stored. A token stops working the moment it's revoked, its owner leaves the organization, or an admin turns connected apps off (`organizations.settings.connectedApps = false`). Authorizations, personal tokens, revocations and messages sent through apps are written to the audit log.

**Hardening and scale.**
- Running more than one API instance. Today these live in one process's memory: the event bus, who is online, the 15-second auto-leave timers, and the startup cleanup of live calls, meetings and rooms. Move the bus and presence to Redis (pub/sub plus keys with TTLs), turn auto-leave into a delayed job, and replace the startup cleanup with LiveKit webhooks. The Postgres job queue, sessions and everything else already work with several instances (rate limits are per instance).
- Push notifications (web push and mobile).
- Virtualized rendering for very long histories. History is paged at 50 messages, but loaded pages stay in memory for the session.
- Malware scanning of uploads, and data retention and export jobs.
- SAML, OIDC and SCIM: the `identities` table and session model are ready, but no IdP flows exist yet.
- More admin controls: data retention and export, enforced sign-in methods (SSO), and session management for members.
