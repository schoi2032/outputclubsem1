# Database

PostgreSQL 17 with Drizzle ORM. The schema lives in `packages/db/src/schema.ts`, and migrations in `packages/db/drizzle`.

## Conventions

- **UUIDv7 primary keys.** They're time-ordered, so `id` doubles as the pagination cursor (`WHERE id < $cursor ORDER BY id DESC LIMIT n`). There are no offsets anywhere.
- **Every tenant-owned row has `org_id`**, and API queries always filter by it. Cross-tenant references are also blocked by checks in the service layer (see [SECURITY.md](SECURITY.md)).
- `timestamptz` everywhere. Soft deletes (`deleted_at`, `archived_at`, `deactivated_at`) where history matters.
- Lower-cased unique indexes for emails and channel and department names.

## Entities

| Area | Tables |
|---|---|
| Identity | `users`, `identities` (future OIDC/SAML/SCIM), `sessions` (hashed tokens), `email_tokens` |
| Organization | `organizations` (`settings.customization`: brand color, banner, onboarding, status presets, profile fields), `org_memberships` (role, title, department, `profile` answers), `invitations` (hashed tokens), `departments`, `teams`, `team_members` |
| Conversations | `channels` (`kind`: public, private, dm, group), `channel_members` (role, read state, mute, notify level) |
| Messages | `messages` (rich body, plain text, generated `tsvector`, thread fields, forward snapshot), `reactions`, `mentions`, `pins`, `bookmarks`, `drafts`, `scheduled_messages` |
| Files | `files` (storage key, MIME type sniffed from content, size, SHA-256, image dimensions, `animated`, purpose) |
| Expressions | `custom_emojis` (unique name per org), `soundboard_sounds`; `users.avatar_animated` marks GIF/WebP avatars, which clients show still until hovered |
| Presence and notifications | `presence`, `notifications` (group key, read state), `notification_preferences` |
| Voice and Meet (Stages C and D) | `calls`, `call_participants`, `voice_rooms`, `meetings`, `meeting_participants` |
| Integrations and AI | `integrations`, `integration_credentials` (AES-256-GCM ciphertext), `webhook_deliveries`, `ai_providers` (with consent record) |
| Operations | `audit_logs`, `jobs` |

## Indexes for large volumes

| Query | Index |
|---|---|
| Channel history (top-level messages) | `messages (channel_id, id DESC) WHERE parent_id IS NULL` |
| Thread replies | `messages (parent_id, id) WHERE parent_id IS NOT NULL` |
| Full-text search | GIN on `messages.search` (generated `to_tsvector('english', body_text)`) |
| Name search | trigram GIN on `users.name`, `channels.name`, `files.name` (`pg_trgm`) |
| Unread mentions | `mentions (user_id, org_id, message_id DESC)` |
| Notifications | `notifications (user_id, org_id, id DESC)` and a partial index on unread |
| Sidebar | `channel_members (user_id, org_id)` |
| Due work | partial indexes on `scheduled_messages.send_at` and `jobs.run_at` where pending |

Unread counts are computed per channel with a capped subquery (`LIMIT 100`) and shown as "99+". Clients never load whole histories: they page through them at 50 messages.

## Migrations

```bash
# after editing packages/db/src/schema.ts
pnpm db:generate     # writes a new SQL migration to packages/db/drizzle
pnpm db:migrate      # applies pending migrations (also creates the pg_trgm extension)
```

In production, migrations run as the `quid-migrate` Cloud Run job before each API rollout (`infra/gcp/deploy.sh`). Make migrations backward compatible: add columns as nullable or with defaults, backfill, then tighten in a later release.

## Seed data

`pnpm db:seed` creates an organization named **[DEV] Acme Demo** (`is_demo = true`) with sample people, departments, a team, channels and messages. It refuses to run when `NODE_ENV=production`.
