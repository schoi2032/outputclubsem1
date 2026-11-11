# API

The API is served under `/api` (proxied by the web app) plus `/ws` for realtime. In development, an interactive OpenAPI reference generated from the Zod schemas is at **http://localhost:4000/api/docs**. It's disabled in production.

## Conventions

- JSON in and out. Authentication is the `quid_session` cookie. State-changing requests must come from an allowed `Origin`.
- Org-scoped routes look like `/api/orgs/:orgId/...`. Callers who aren't members get `404`.
- Errors always look like this:
  ```json
  { "error": { "code": "forbidden", "message": "Only channel admins can post here." } }
  ```
  Codes: `validation_error`, `bad_request`, `unauthorized`, `email_unverified`, `forbidden`, `not_found`, `conflict`, `payload_too_large`, `rate_limited`, `internal`.
- Lists use keyset cursors (`before`, `after`, `around`, or `cursor` and `nextCursor`). There are no offsets.

## Main resources

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/forgot-password`, `/auth/reset-password` |
| Me | `GET/PATCH /me`, `POST /me/password`, `GET /me/sessions`, `DELETE /me/sessions/:id`, `PUT /me/presence` |
| Orgs | `POST /orgs`, `GET/PATCH/DELETE /orgs/:orgId`, `GET /orgs/slug-available` |
| Members | `GET /orgs/:orgId/members`, `PATCH/DELETE /orgs/:orgId/members/:userId` |
| Invitations | `GET/POST /orgs/:orgId/invitations`, `DELETE …/:id`, `GET /invitations/:token`, `POST /invitations/:token/accept` |
| Structure | `…/departments`, `…/teams`, `PUT/DELETE …/teams/:id/members[/:userId]` |
| Channels | `GET …/channels/mine`, `GET …/channels/browse`, `POST …/channels`, `GET/PATCH/DELETE …/channels/:id`, `POST …/:id/{join,leave,archive,unarchive,read}`, `GET/POST …/:id/members`, `PATCH/DELETE …/:id/members/:userId`, `PATCH …/:id/prefs` |
| Conversations | `POST …/conversations` (DM or group), `PATCH …/conversations/:id` |
| Messages | `GET/POST …/channels/:id/messages`, `GET/PATCH/DELETE …/messages/:id`, `GET …/messages/:id/thread`, `POST/DELETE …/messages/:id/{reactions,pin,bookmark}`, `POST …/messages/:id/forward` |
| Drafts and scheduling | `GET …/drafts`, `PUT/DELETE …/channels/:id/draft`, `GET/POST …/scheduled`, `DELETE …/scheduled/:id` |
| Files | `POST …/files` (multipart, `?purpose=attachment\|avatar\|logo\|emoji\|sound&channelId=`), `GET /files/:id/content`, `GET …/channels/:id/files`, `DELETE …/files/:id` |
| Customization | `PATCH /orgs/:orgId/customization` (admins; any of `brandColor`, `banner`, `welcomeMessage`, `autoJoinChannelIds`, `statusPresets`, `replaceDefaultStatuses`, `profileFields`, `expressionsPolicy`; returned to members as `customization` on each org in `GET /me`), `PUT /orgs/:orgId/profile` (your answers to the org's profile fields; also on `Member.profile`) |
| Custom emoji | `GET/POST …/emojis` (`{ name, fileId }` from an `emoji` upload; used as `:name:` in messages and reactions), `DELETE …/emojis/:id` (creator or admin) |
| Soundboard | `GET/POST …/sounds` (`{ name, emoji, fileId, volume }` from a `sound` upload: MP3/WAV/OGG up to 1 MB), `PATCH/DELETE …/sounds/:id`. Playback goes peer to peer over the voice room's LiveKit data channel (topic `quid.soundboard`), not through the API |
| Search | `GET …/search?q=&type=all\|messages\|channels\|people\|files` |
| Notifications | `GET …/notifications`, `GET …/notifications/unread-count`, `POST …/notifications/read`, `GET/PUT …/notification-preferences`, `POST …/announcements` |
| Integrations | `GET …/integrations`, `POST …/integrations/{incoming-webhooks,outgoing-webhooks}`, `PATCH/DELETE …/integrations/:id`, `GET …/integrations/:id/deliveries` |
| AI | `GET/POST …/ai/providers`, `POST …/ai/providers/:id/test`, `DELETE …/ai/providers/:id`, `GET …/ai/status`, `POST …/ai/summarize` (catch-up for a channel since a message or N hours, or a thread), `GET/POST …/meetings/:meeting/notes`, `POST …/meetings/:meeting/notes/share` |
| Canvases | `GET/POST …/channels/:id/canvases`, `GET/PATCH/DELETE …/canvases/:id` (PATCH sends the `version` it edited; a stale save gets 409). Bodies allow headings, checklists and dividers on top of the message format |
| Tasks | `GET …/tasks?channelId=` or `?mine=assigned\|created`, `POST …/tasks` (optionally from a `messageId`), `PATCH/DELETE …/tasks/:id`. Assignees are notified, and again within an hour of the due time |
| Reminders | `GET/POST …/reminders` (about a `messageId` or free `text`), `PATCH …/reminders/:id` (`done`, or a new `dueAt` to snooze), `DELETE …/reminders/:id`. Delivered as `reminder` notifications |
| Workflows | `GET …/workflows` (or `?shortcutsIn=channelId`), `POST …/workflows`, `PUT/PATCH/DELETE …/workflows/:id`, `POST …/workflows/:id/run` (shortcut, with form `values`). Triggers: shortcut, channel_join, workspace_join, schedule, keyword. Steps: message, dm, task. Bots never trigger workflows |
| Realtime | `GET /realtime/ticket` |

## Realtime protocol

Connect to the URL from `/api/realtime/ticket` as `wss://…/ws?ticket=…`. The full event union is `ServerEvent` and `ClientEvent` in `packages/shared/src/events.ts`.

Server to client: `hello`, `message.created`, `message.updated`, `message.deleted`, `thread.updated`, `reaction.updated`, `pin.updated`, `typing`, `presence`, `channel.updated`, `channel.joined`, `channel.left`, `channel.member_joined`, `channel.member_left`, `read.updated`, `notification.created`, `org.updated`, `resync`, `pong`.

Client to server: `typing { channelId, parentId? }`, `subscribe { channelId }` (preview a public channel), `unsubscribe`, `activity` (presence heartbeat), `ping`.

## Incoming webhooks

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"text":"Deploy finished ✅"}' \
  'https://<your-quid>/api/hooks/<token>'
```

GitHub: set the payload URL to the `…/github` URL shown at creation, content type `application/json`, and the secret shown with it.

## Outgoing webhooks

`POST` to your https endpoint with these headers: `X-Quid-Event`, `X-Quid-Delivery`, `X-Quid-Timestamp`, and `X-Quid-Signature: sha256=<hex>`, where the signature is `HMAC_SHA256(secret, timestamp + "." + rawBody)`. Reject requests with stale timestamps. Failed deliveries retry with exponential backoff, up to five attempts.
