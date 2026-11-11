# Building a Quid plugin

The public developer guide lives at `/developers` (apps/web/src/app/(site)/developers); keep it in step with this file.

A Quid plugin is a small web service you run. Quid sends it signed HTTPS requests when someone runs one of its slash commands or posts in a channel it was added to, and the plugin replies or posts messages back. **No plugin code runs inside Quid or in people's browsers.**

## Lifecycle

1. **Submit** from Plugins (sidebar → Add plugins, or Settings → Plugins) → Submit a plugin, with a name, tagline, developer details, base URL, optional icon, slash commands, and whether you want new messages. You get a **signing secret** once.
2. **Automatic safety checks** run right away:
   - The base URL is HTTPS on a public address. Private and internal networks are refused.
   - Your server echoes a one-time challenge, which proves you control it.
   - The icon is a real PNG, JPEG, WebP or GIF under 512 KB. SVG is refused, and the icon is copied into Quid so it's never loaded from your server.
   - The listing text doesn't claim to be official or verified, and contains no links or HTML.
   - Google Safe Browsing lists none of your URLs as dangerous, when the server has a key configured.
3. If every check passes, the plugin is listed as **Unverified** (community). Workspaces on Enterprise+ can install it after an explicit warning.
4. The Quid team reviews community plugins and marks them **Verified**. Any workspace can install verified plugins. The team can also **suspend** or **reject** a plugin, which stops it working everywhere at once.
5. **Private** plugins (Enterprise+) are visible to and installable by only the workspace that submitted them.

## Requests from Quid

Quid POSTs JSON to `{baseUrl}/quid/{verify|install|uninstall|command|events}` with these headers:

```
x-quid-timestamp: 1791234567
x-quid-signature: sha256=<hex HMAC-SHA256(signing secret, timestamp + "." + raw body)>
```

Check the signature and reject timestamps more than 5 minutes old. (`verify` runs before you have the secret, so you can skip checking it there.)

| Path | Body | Your reply |
|---|---|---|
| `/quid/verify` | `{ "type": "url_verification", "challenge": "…" }` | `{ "challenge": "…" }` (the same value) |
| `/quid/install` | `{ "type": "installed", "installId", "workspace": { "id" }, "channels": [{ "id", "name" }], "token", "apiBase" }` | any 2xx. Store the token for this install |
| `/quid/uninstall` | `{ "type": "uninstalled", "installId" }` | any 2xx. Forget the token |
| `/quid/command` | `{ "type": "command", "installId", "command", "text", "user": { "id", "name" }, "channel": { "id", "name" }, "threadId" }` | within 5 s: `{ "text": "…", "visibility": "ephemeral" \| "channel" }` |
| `/quid/events` | `{ "type": "event", "event": "message.created", "installId", "message": { "id", "channelId", "authorId", "authorName", "text", "threadId", "createdAt" } }` | any 2xx (retried with backoff) |

`ephemeral` replies are shown only to the person who ran the command. `channel` replies are posted as your plugin.

## Posting messages

```
POST {apiBase}/messages
Authorization: Bearer <install token>
Content-Type: application/json

{ "channelId": "…", "text": "Deploy finished ✅", "threadId": null }
```

Plugins can post only in channels a workspace admin added them to. Up to 60 messages a minute per install.

## Official plugins

Quid's own plugins live in `apps/plugins`, one service for all of them: Polls (`/poll`, `/vote`), Reminders (`/remind`), Standup (`/standup`), Translate (`/translate`, Google Cloud Translation), World Clock (`/time`) and Dice & Decide (`/roll`, `/flip`, `/pick`). They're listed in `packages/shared/src/official-plugins.ts`.

- The API lists them as **Official** and verified when `OFFICIAL_PLUGINS_URL` and `OFFICIAL_PLUGINS_KEY` are set. Each plugin's signing secret is `qps_` + HMAC-SHA256(key, `plugin:<slug>`), so the service knows it without copying secrets around.
- They use the same protocol as everyone else (signed calls, install tokens, the plugin API). Reminders and standups run from `POST /cron` (Cloud Scheduler, every minute).
- Community plugins can't use the Quid name or claim to be official.
- Run locally with `pnpm dev` (port 4200). Icons are rebuilt with `node apps/plugins/scripts/icons.mjs`.
