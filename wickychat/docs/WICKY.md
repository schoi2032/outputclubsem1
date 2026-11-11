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

## Who can do what with channels

- **Only admins and owners (teachers) can create channels**, public or private (`channels.create` in `packages/shared/src/permissions.ts`). Students can still start DMs and group chats with **New message**. The app hides "Create channel" from students, and the server rejects it with `403`.
- **Admins can delete any channel**, including ones they didn't make, private ones they aren't in, and the default `#general` and `#announcements`. Use the trash icon in **Browse channels** or **Delete channel** in a channel's settings. Admins also see every private channel in Browse.
- **No invitations.** Everyone with a school email joins automatically, so the "Invite people" buttons were removed.

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

## Rule breakers log

Code:
- `recordSwears` in `apps/api/src/modules/messages/service.ts`
- `apps/api/src/modules/moderation/routes.ts`
- `apps/web/src/app/(app)/[orgSlug]/settings/moderation/page.tsx`

- **What gets logged.** Whenever the swear filter hides words in a new message, an edit or a scheduled message, a `moderation_events` row is saved. It records who wrote it, the chat, the message, the words as typed, and the original text (up to 2000 characters). Drafts and bot messages aren't logged. Logging never blocks a message: if it fails, the message still posts and a warning is logged.
- **Who can see it.** Org admins and owners (`audit.read`), which is how teachers are set up. Members get `403`.
- **Where.** In the app at **Settings → Rule breakers**:
  - a "most caught" ranking (last 7 days, last 30 days, or all time) with each person's top words;
  - every incident, newest first, with the caught words highlighted. Click a person to filter.
- **The API:**
  - `GET /api/orgs/:orgId/moderation/offenders?range=7d|30d|all`
  - `GET /api/orgs/:orgId/moderation/events?userId=&before=&limit=`
- **Privacy.** DMs and private chats are logged too, and the Help page tells students that. Deleting a user deletes their incidents. Deleting a message keeps the incident, but its link is removed.

## Profiles, Wicky Coins and the Shop

Code:
- `packages/shared/src/wicky.ts`: coin rules, the catalog, cosmetic and profile-style types
- `apps/api/src/modules/coins/`: wallet, shop, gifting, cosmetics and review
- `packages/ui/src/avatar.tsx` and `.q-deco-*` in `packages/ui/src/styles.css`: decorations on avatars
- `apps/web/src/components/profile/`: the profile card, its editor and styled names
- `apps/web/src/app/(app)/[orgSlug]/shop/page.tsx`: the Shop
- `apps/web/src/app/(app)/[orgSlug]/settings/cosmetics/page.tsx`: the teacher review page

### Profiles

People's avatars are round, Discord-style. Organization logos stay square (`shape="square"`). Click a name or avatar in chat to open the profile card. It shows:
- a banner: an uploaded image (GIFs animate) or a colour
- the avatar with its decoration
- the name in its chosen font and colour, or a two-colour gradient
- pronouns, role (🍎 Teacher for admins and owners), status, "About me" in its chosen font, and join date
- an optional two-colour card theme
- buttons: **Message**, **🎁 gift a decoration**, and for teachers **Reward** with coins

Styles live in `users.profile_style` and are cleaned by `cleanProfileStyle`, so only known fonts and `#rrggbb` colours are stored. The name font and colour also show next to the name in chat (`UserSummary.nameStyle`). The fonts are Google Fonts under the SIL Open Font License, loaded with `next/font` in `src/lib/profile-fonts.ts`:

| Option | Font |
|---|---|
| Rounded | Nunito |
| Serif | Playfair Display |
| Typewriter | Space Mono |
| Handwritten | Caveat |
| Pixel | Press Start 2P |
| Bold Display | Bungee |
| Futuristic | Orbitron |

### Wicky Coins

| How | Coins |
|---|---|
| Daily bonus | +25 |
| Each message | +2 (up to 50 a day) |
| Each swear | −5 |
| Teacher reward | 1–1000, written to the audit log |
| Someone buys your cosmetic | 90% of the price |

Every change goes in `coin_transactions`. The reasons are `daily`, `message`, `swear`, `purchase`, `gift`, `sale` and `gift_item`.

### Built-in decorations

There are 24, from Neon Pulse (60) to Royal Crown (800). Each is a CSS ring (`.q-deco-<id>`) plus an animated sticker at `apps/web/public/decorations/<id>.webp`. The stickers are [Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/) by Google under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), resized to 128px. The credit is at the bottom of the Shop, and it must stay there.

To add a built-in decoration:
1. Add it to `DECORATIONS`.
2. Put a `<id>.webp` in `public/decorations`.
3. Optionally add a ring colour or sticker position in `styles.css`.

### Student-made cosmetics

Anyone can create one in **Shop → Create**, with:
- a **frame**: a square PNG, GIF or WebP covering the decoration area, transparent in the middle;
- and/or a **sticker**: a small image placed at one of 8 positions.

Images are up to 2 MB each (`purpose=cosmetic` uploads). Or upload a pack, which is a `cosmetic.json` plus the images it names:

```json
{
  "name": "Galaxy Ring",
  "description": "Stars all around you",
  "price": 150,
  "frame": "frame.gif",
  "sticker": "star.png",
  "stickerPosition": "tr"
}
```

The rules:
- **Price:** 10 to 2000 coins.
- **Name and description:** must pass the swear filter.
- **Limit:** at most 5 waiting for review at a time.
- **Review:** new cosmetics are `pending` until a teacher approves them in **Settings → Cosmetics review**. Approving gives the creator their own copy.
- **Take-downs:** a teacher can take one off sale later, and buyers keep it.
- **Approved cosmetics** can't be edited or deleted.

On avatars they're stored as `u:<id>|f:<frame file>|s:<sticker file>:<pos>`, and `Avatar` draws that.

### Gifting

Buy any decoration (built-in or student-made) for someone else in the same school. Use the 🎁 button in the Shop, or the 🎁 on their profile card, which opens the Shop in gift mode (`?gift=<userId>`). It shows up in their collection as "🎁 from <name>". You can't gift something they already own, or gift to yourself.

### API

- `GET /api/me/wallet`
- `POST /api/me/wallet/daily`
- `POST /api/me/shop/:itemId/buy` with `{ giftTo? }`
- `PUT /api/me/decoration` with `{ itemId | null }`
- `GET /api/orgs/:orgId/cosmetics?view=shop|mine|review`
- `POST /api/orgs/:orgId/cosmetics`
- `POST /api/orgs/:orgId/cosmetics/:id/review` with `{ approve, note? }`
- `DELETE /api/orgs/:orgId/cosmetics/:id`
- `POST /api/orgs/:orgId/members/:id/coins`
- `PATCH /api/me` with `bio`, `pronouns`, `bannerColor`, `bannerFileId` and `profileStyle`

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
