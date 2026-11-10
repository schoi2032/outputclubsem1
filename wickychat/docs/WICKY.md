# What's special about WickyChat

Everything Quid does still works (channels, DMs, threads, files, search, voice rooms, calls, plugins…). This page covers what was changed for the school.

## One school, one organization

Code: `apps/api/src/core/school.ts`

- **Only school emails.** Sign-up, login and Google sign-in all reject any address that isn't `@chadwickschool.org` (`SCHOOL_EMAIL_DOMAIN`). The error users see is *"WickyChat is only for @chadwickschool.org accounts."*
- **Everyone lands in the same place.** There's exactly one organization, "Chadwick International" (`SCHOOL_ORG_NAME`, slug `chadwick`). It's created automatically the first time anyone signs in, together with two channels:
  - `#general`: anyone can post.
  - `#announcements`: only admins and owners can post.
- **Joining is automatic.** Each time a signed-in request comes in, `ensureSchoolMember` makes sure the user is a member (see `core/auth.ts`). Someone an admin deactivated stays deactivated; existing memberships are never touched.
- **Who becomes owner:**
  - The **very first person** to sign in, and
  - anyone listed in `SCHOOL_ADMIN_EMAILS` (comma-separated).
  - Everyone else joins as a normal member. Owners can promote people later in Settings → Members.

> ⚠️ Because the first sign-in becomes owner, make sure the right person signs up first on a fresh database. If a test account grabs it, delete that user and the `chadwick` organization from the database. Then **redeploy**, because each server instance caches the organization's ID in memory (`cachedOrgId`).

## Swear filter

Code: `packages/shared/src/profanity.ts` (tests in `profanity.test.ts`)

- Every message is cleaned **on the server before it's saved** (`censorDoc` in `apps/api/src/modules/messages/service.ts`). So swears are replaced with `***` for everyone, and you can't get around it by editing the frontend.
- It catches disguises:
  - CAPS
  - l33t letters (`sh1t`, `@ss`, `$hit`)
  - stretched letters (`fuuuuck`)
  - letters split with dots, dashes or spaces (`f.u.c.k`, `s-h-i-t`)
- It also catches multi-word phrases.
- The word list started from Output Club's "bad words" list. Everyday words that were on it (baby, dog, fish, nobody…) were taken out so normal chat isn't censored. An `ALLOWED` list protects innocent words that contain a swear inside them.
- To add or remove words, edit:
  - `ROOTS`: matched anywhere inside a word, e.g. "fucking" or "bullshit".
  - `WORDS`: whole words only, plus endings like -s, -ed, -ing.
  - `PHRASES`: multi-word phrases.
  - `ALLOWED`: innocent words to never censor.

  Then run the tests: `cd packages/shared && pnpm exec vitest run`.

## Email check switch (temporary)

`SKIP_EMAIL_VERIFICATION=true` is **on in production right now**, because there's no email service yet.

| | Switch on (now) | Switch off (default) |
|---|---|---|
| Sign up | Signed in immediately | Account created, verification email sent |
| Same email twice | `409` "An account with this email already exists. Sign in instead." | `202`, and the owner gets an email about it (so nobody can tell the account exists) |
| Login before verifying | n/a (everyone is verified) | `403 email_unverified` |
| Forgot password | Sends nothing | Sends a reset email |

**The risk:** while it's on, anyone can sign up using *any* `@chadwickschool.org` address, including a teacher's. Before real students use the app, do one of these and then delete the variable from Vercel:

1. **Google sign-in (best fit).** It's already built, and it's locked to the school domain both in the Google prompt (`hd=chadwickschool.org`) and on the server. Create an OAuth client in Google Cloud Console (type *Web application*) with the redirect URI `https://wickychat.vercel.app/api/auth/google/callback`. Then add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel. The "Continue with Google" button appears by itself once `/api/auth/providers` returns `{"google":true}`.
2. **An email service.** Brevo's free plan (300 emails/day) works without owning a domain. Set `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, and an `EMAIL_FROM` address you verified in Brevo.

## What was removed from Quid

- Billing (PayPal and Paddle), pricing, refunds, trials and paid plans. Every feature is free.
- Platform analytics and the admin analytics page.
- The desktop app.
- The Google Cloud and Cloudflare deploy scripts. WickyChat runs on Vercel instead (see [DEPLOYMENT.md](DEPLOYMENT.md)).

The `billing_accounts` table is still in the database (old migrations), but nothing uses it.

## Feature checklist

This is Output Club's checklist, checked against the WickyChat code (not the older `wicky/` prototype, whose backend code is still in git history on the `wicky-backend` branch).

| Feature | Status in WickyChat |
|---|---|
| Split roles (student / teacher / moderator / admin) | ❌ Only Quid's org roles exist (owner, admin, dept_admin, team_manager, member, guest) |
| Reportable messages and users | ❌ |
| Swear word censor | ✅ |
| No chats over 3 people unless a teacher is in it | ❌ |
| Chat with yourself | ✅ Quid has a self-DM ("notes to self") |
| WICKYpedia AI | ❌ (Quid's AI assistant and summaries exist, not a wiki) |
| Custom WICKY GIFs and stickers | 🟡 Custom emoji and expressions exist; no official WICKY pack yet |
| Tag AI-generated messages | 🟡 Bot messages are marked as bots; no "likely AI" detection |
| Block the same message sent 2–3 times in a row | ❌ |
| No AI-slop stickers or GIFs | ❌ |
| AI moderation (self-trained) | ❌ |
| Intuitive UI and UX | ✅ Quid's full UI |
| Customizability for power users | ✅ Themes, accent, font, density and more in Settings |
| Home screen with unread messages | ✅ `/chadwick/home` and the Activity page |
| Teachers automatically owner/manager of chats | ❌ No teacher role yet |
| Student stickers go through AI moderation | ❌ |
| All images go through AI moderation | ❌ |

Missing features with old backend code to start from are in `git show c5d6e2d` (the `wicky/` app). Its rules were written for Supabase and would have to be rebuilt as API modules here.
