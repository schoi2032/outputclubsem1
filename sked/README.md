# Sked

The schedule dashboard from Output Club. It puts your classes, tests, clubs, Google Classroom work, Gmail and Google Chat in one place, and you can ask Gemini about your day. There's a website and a terminal app.

## What's connected

| Source | Status |
| --- | --- |
| Google Classroom, Gmail, Google Chat | Live, after you sign in with Google |
| Gemini | Live when `GEMINI_API_KEY` is set |
| ManageBac, Veracross | Sample data until the school gives us API tokens |

## Run it locally

```
npm install
npm run dev
```

It needs a `.env.local` file with these variables:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GEMINI_API_KEY=
SCHOOL_TZ=Asia/Seoul
```

Never commit this file.

## Terminal app

```
npm link
sked login <token from the website>
sked
```

The commands are `today`, `week`, `tests`, `clubs`, `mail`, `ask <question>`, `sys` (CPU, memory and battery), `watch` (live system monitor) and `dashboard`.

## Database

The tables are in `supabase/migrations`. Run `npx supabase db push` to apply them.
