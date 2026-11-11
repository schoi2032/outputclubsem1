### Output Club 2026

## Current Project and future goals
All Main Tasks have been completed!

## Done 
- Database in `wicky/supabase/migrations/20261013000000_wicky.sql`. Tested on a local Postgres and the rules all work: only school emails can sign up, the 3 people limit, teachers becoming owner, spam blocking and unread counts.
- Every checklist feature has a backend now (the API routes are in `wicky/src/app/api`):
  - Roles: student, teacher, moderator and admin
  - Report messages and users, plus a moderator queue
  - Swear word censor in `wicky/src/lib/censor.ts`
  - 3 people max per chat unless theres a teacher in it
  - Chat with yourself (notes to self)
  - WICKYpedia AI with wiki pages that teachers and mods can edit
  - Stickers and GIFs, official WICKY ones are marked `is_official`
  - AI tags on messages: `bot`, `likely_ai` and `self_tagged`
  - The same message 3 times in a row gets blocked
  - Stickers that look like AI slop get rejected
  - AI moderation that learns from moderator corrections, and you can export it as JSONL to train a real model later
  - Settings for power users (theme, accent, font, custom CSS and more)
  - Home screen endpoint with unread counts
  - Teachers become owner of a chat automaticly
  - Student stickers and all images go through AI moderation
- A temporary retro IBM style frontend, it only does login, chat list, reading and sending, and `/wicky question`.
- `npm run lint`, `tsc` and `npm run build` all pass.

## Next Steps
- Work on a more clean design
- Better UI/UX
- Notification System - Designed for checking chats better
- Add administrator and student roles to chat to incorporate organization

---

## WickyChat (wicky-backend)

The app now lives in `wickychat/`. It replaces the old `wicky/` folder, so the `wicky/...` paths above no longer exist. The features listed there are now in `wickychat/`, like the swear filter, which moved to `wickychat/packages/shared/src/profanity.ts`.

WickyChat is our school chat, built on the Quid monorepo:
- **School only**: just `@chadwickschool.org` emails, and everyone joins one Chadwick org with `#general` and `#announcements`
- **Teachers run channels**: only admins and owners (teachers) can create channels, and admins can delete any channel
- **Group chat rule**: group chats with more than 3 people need a teacher in them
- **Swear filter**: catches l33t, stretched and spaced-out words, and teachers see who it caught in **Settings → Rule breakers**
- **Reporting**: report messages to teachers, and teachers can put people in timeouts
- **Read receipts** on announcements, for teachers
- **Profiles**: profile cards, round avatars with animated decorations, profile effects and name plates
- **Wicky Coins**: daily streaks, badges and a leaderboard, plus the **Wicky Shop** with themes, a student cosmetics marketplace (teachers review), gifting and reselling
- **Polls and quizzes** with coin rewards
- **Help page** at `/help` with guides for students and teachers

### Where things are

```
wickychat/   main app: Next.js web + Fastify API + Postgres (see wickychat/README.md)
wickychat/docs/WICKY.md       what we changed for the school
wickychat/docs/FRONTEND.md    guide for frontend people
lite/        small standalone chat server (node lite/server.js)
api/         AI moderation endpoint (api/moderate.js)
index.html, script.js, style.css   early Wicky Chat frontend
```

The files `AI WICKYpedia`, `Customizability`, `Tagging AI Messages` and `Teacher Automaticly Becoming Leader` are prototypes from main and aren't wired into `wickychat/` yet.

### Running it

See `wickychat/README.md` for local setup (`pnpm install`, `pnpm infra:up`, `pnpm db:migrate`, `pnpm dev`).
