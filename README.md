### Output Club 2026

## Current Project and future goals
This is a checklist to see how far we have gotten :)
- [x] Split Roles
- [ ] Reportable Messages/Users
- [ ] Swear word censor
- [ ] Doesn’t allow chat that has more than the 3 people (unless has a teacher)
- [ ] Can make a chat with ourselves
- [ ] Should have its own AI WICKYpedia
- [ ] Custom GIFs and Stickers of WICKY
- [ ] Tag AI-Generated Messages
- [ ] Prevents Spam by blocking messages that are sent 2-3 times in a row by the same user
- [ ] No AI-Slop Stickers or GIF
- [ ] Decent AI Moderation (self-trained)
- [ ] Intuitive UI & UX
- [ ] Customizability for ===POWER USERS===
- [ ] Home Screen with unread chat messages
- [ ] Teachers are automatically prompted to Owner/Manager of chat
- [ ] Students can create there own stickers that go through AI moderation
- [ ] All Images go through AI moderation

[demos/notes/lol.md](demos/notes/lol.md)

## Where we left off (Oct 13 2026)

The new app lives in `wicky/`. Its a fresh start, the old `sked` and `chat` stuff isnt used anymore. Read `wicky/README.md` to run it.

### Done
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

### Not done yet, start here next time
1. Write the `docs/` folder for the frontend people. One guide per endpoint and feature, how realtime works, the error codes, and a step by step frontend guide.
2. Make a Supabase project, apply the migration and turn on Google login with the school domain.
3. Add the env vars to Vercel and test the whole thing with real accounts.
4. Real frontend for everything the temp UI skips (stickers, images, reports, settings, mod pages, wiki).

The checklist boxes up top stay unchecked untill the frontend is done too.

