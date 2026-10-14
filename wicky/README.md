# Wicky Chat

The chat app for Chadwick, made by Output Club. Next.js + Supabase + AI SDK (through Vercel AI Gateway).

## Run it

```
npm install
npm run dev
```

You need a `.env.local` file in this folder, never commit it:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AI_GATEWAY_API_KEY=
```

`AI_MODEL` and `AI_VISION_MODEL` are optional, the default is `openai/gpt-5-mini`. Without an AI key the app still works but WICKYpedia is off, text moderation gets skipped and image uploads are blocked.

The database is in `supabase/migrations`. Apply it with `npx supabase db push`.

To make someone an admin the first time, run this in the Supabase SQL editor:

```
update profiles set role = 'admin' where email = 'someone@chadwickschool.org';
```

After that admins can change roles with `PATCH /api/admin/users/{id}/role`.

See the root README for whats done and whats next.
