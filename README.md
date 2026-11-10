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
