# Frontend guide

A step-by-step guide for building WickyChat pages. The frontend is **Next.js (App Router) + React + Tailwind + TanStack Query** in `apps/web`. It talks to the Fastify API in `apps/api`.

## 1. Run it locally

You need Node 24, pnpm and Postgres (Homebrew `postgresql@17` works).

```bash
. ~/.nvm/nvm.sh && nvm use 24
cd wickychat
pnpm install

# one-time database setup (creates user/db "quid", password "quid")
createuser quid --pwprompt        # type: quid
createdb -O quid quid
pnpm db:migrate                   # creates all the tables
pnpm db:seed                      # optional: demo "Acme Inc." data

pnpm dev                          # web on :3000, API on :4000
```

Open http://localhost:3000. Nothing needs a `.env` for local work, because every setting has a development default.

- Sign up with any `@chadwickschool.org` address.
- To skip the email step locally, start the API with `SKIP_EMAIL_VERIFICATION=true`.
- Or use `EMAIL_PROVIDER=console`: emails are printed in the API's terminal instead of sent, and you can copy the verify link from there.

## 2. Where things live

```
apps/web/src/
  app/
    (auth)/        login, register, forgot/reset password, verify email
    (site)/        public pages: developers, terms, privacy, changelog
    (app)/[orgSlug]/   the signed-in app; for WickyChat orgSlug is always "chadwick"
      c/[channelId]    a channel or DM
      home, activity, search, files, saved, drafts, tasks, people, browse,
      voice, meet, workflows, plugins, whats-new
      settings/…       profile, preferences, customization, members, ai, …
  components/      chat/, shell/ (sidebar, rail, command palette), dialogs/, settings-ui …
  lib/
    api.ts         fetch wrapper + ApiError
    queries.ts     React Query keys and hooks (useMe, useChannels, useMessages…)
    realtime.ts    the WebSocket client
    actions.ts     common mutations
packages/ui/src/   shared UI: Button, Input, Avatar, Spinner, toast, overlay, logo
packages/shared/src/  types, Zod schemas, permissions and realtime events (shared with the API)
```

**Rule of thumb:** if the API and the web app both need a type or a rule, it belongs in `packages/shared`. Import it from `@quid/shared` and never copy it.

## 3. Calling the API

The browser only talks to its own origin. Next.js forwards `/api/*` to the API (and on Vercel, `vercel.json` routes it). So the session cookie just works, and you never deal with tokens.

```ts
import { get, post, patch, del, ApiError } from '@/lib/api'

const me = await get<{ user: Me; orgs: OrgSummary[] }>('/api/me')

try {
  await post('/api/orgs/' + orgId + '/channels', { name: 'robotics', kind: 'public' })
} catch (e) {
  if (e instanceof ApiError) toast(e.message)   // messages are written for users
}
```

- `ApiError` has `status`, `code` and `message`. The message is always safe to show to a user.
- A network failure throws `code: 'network'` with "Can't reach WickyChat…".
- File uploads use `upload(path, file, onProgress)`, which returns `{ promise, abort }`.

### Error codes

Every error from the API looks like `{ "error": { "code": "…", "message": "…" } }`.

| Code | HTTP | What to do in the UI |
|---|---|---|
| `validation_error` | 400 | Show the message next to the form |
| `bad_request` | 400 | Show the message |
| `unauthorized` | 401 | Send the user to `/login` |
| `email_unverified` | 403 | Show "check your email" with a resend button (`POST /api/auth/resend-verification`) |
| `forbidden` | 403 | Show the message, e.g. "Only channel admins can post here." or the school-only message |
| `not_found` | 404 | Not found, **or** you don't have access (org and private routes return 404 on purpose) |
| `conflict` | 409 | Someone else changed it, or it already exists (e.g. a duplicate sign-up) |
| `payload_too_large` | 413 | File too big |
| `rate_limited` | 429 | Ask them to wait a moment |
| `internal` | 500 | "Something went wrong" and retry |

## 4. Reading data with React Query

Use the hooks and keys in `lib/queries.ts` so the realtime client can update the same cache:

```tsx
'use client'
import { useMe, useChannels, keys } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'

export function MyChannels({ orgId }: { orgId: string }) {
  const { data: channels, isLoading } = useChannels(orgId)
  if (isLoading) return <Spinner />
  return <ul>{channels?.map((c) => <li key={c.id}>#{c.name}</li>)}</ul>
}

// after a mutation, refresh anything affected:
const qc = useQueryClient()
await qc.invalidateQueries({ queryKey: keys.channels(orgId) })
```

If you add a new kind of data, add its key to `keys` and a hook next to the others. Don't build query keys inline.

## 5. Realtime

`lib/realtime.ts` opens **one WebSocket per tab** after sign-in:

1. `GET /api/realtime/ticket` returns a 30-second, single-use ticket and the socket URL (`PUBLIC_WS_URL`, `wss://wickychat.vercel.app/ws` in production).
2. It connects to `…/ws?ticket=…`. The server subscribes you to your user, your org and every channel you're in.
3. Incoming events (`message.created`, `reaction.updated`, `typing`, `presence`, `read.updated`, `notification.created`…) are written **straight into the React Query cache**. Any component using `useMessages`, `useChannels` and so on updates by itself.
4. On reconnect the cache is invalidated, so anything missed while offline gets refetched.

You usually don't touch the socket. If you add a new server event:

1. Add it to the `ServerEvent` union in `packages/shared/src/events.ts`.
2. Publish it from the API.
3. Handle it in the `switch` in `realtime.ts`.

To send something, use `send({ type: 'typing', channelId })`.

Useful hooks:
- `useRealtime((s) => s.status)` gives `'connecting' | 'open' | 'offline'`, for an offline banner.
- `useRealtime((s) => s.typing)` gives who is typing.

## 6. Permissions in the UI

`packages/shared/src/permissions.ts` has the role matrix:

```
owner 100 > admin 80 > dept_admin 60 > team_manager 40 > member 20 > guest 10
```

Use it to **hide** buttons people can't use. The API checks again on every request, so the UI is only for convenience, never for security.

## 7. Auth flow (what the pages do)

| Page | Calls | Notes |
|---|---|---|
| `/register` | `POST /api/auth/register` with `{ name, email, password, acceptTerms: true }` | `201 { status: "signed_in" }` means go to `/`. `202 { status: "verification_sent" }` means show "check your email" |
| `/login` | `POST /api/auth/login` with `{ email, password }` | Returns `{ user, orgs }`, or `403 email_unverified` |
| Google button | `GET /api/auth/providers` returns `{ google: boolean }` | The button only shows when `google` is true; it goes to `/api/auth/google/start?next=…` |
| `/verify-email?token=` | `POST /api/auth/verify-email` | |
| Log out | `POST /api/auth/logout` | |

After sign-in, `/` redirects to `/chadwick/home`, the only org's home screen.

## 8. Adding a page, step by step

Example: a "Clubs" page at `/chadwick/clubs`.

1. Create `apps/web/src/app/(app)/[orgSlug]/clubs/page.tsx`. Use `'use client'` if it uses hooks.
2. Get the current org from `useOrgContext()` in `components/org-context.tsx`.
3. Start the page with `PageHeader` from `components/page-header.tsx`, so it matches the rest of the app.
4. If it needs new data:
   - add a route in a module under `apps/api/src/modules/` and the Zod schema in `packages/shared/src/schemas.ts`;
   - add the response type in `packages/shared/src/types.ts`;
   - add a hook in `lib/queries.ts`.
5. Add a link in `components/shell/sidebar.tsx` (and in the command palette if people will search for it).
6. Check it:

   ```bash
   pnpm typecheck && pnpm lint
   ```

## 9. Styling and branding

- Tailwind classes plus the design tokens in `apps/web/src/app/globals.css`.
- The design rules are in `DESIGN.md` at the repo root.
- Use the shared components from `@quid/ui` before writing your own buttons and inputs.
- The logo is `QuidMark` / `QuidWordmark` in `packages/ui/src/logo.tsx`. Despite the names, they draw WickyChat.
- Themes, accent colour, font and density are user preferences (`packages/shared/src/preferences.ts`), so use the tokens instead of hard-coded colours, or dark mode will break.

## 10. Before you push

```bash
pnpm lint          # Biome; `pnpm exec biome check --write .` fixes formatting
pnpm typecheck
cd apps/api && pnpm exec vitest run       # API tests (needs Postgres)
pnpm e2e           # Playwright end-to-end, optional, slow
```
