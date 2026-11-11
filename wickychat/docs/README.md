# WickyChat docs

WickyChat is Chadwick International's school chat app, built by Output Club. It started as a copy of Quid (a Slack/Teams-style app), trimmed down and locked to one school.

Live site: **https://wickychat.vercel.app**

## Start here

| If you want to… | Read |
|---|---|
| Know what makes WickyChat different from Quid, and how far the feature checklist has got | [WICKY.md](WICKY.md) |
| Run it on your laptop and build frontend pages | [FRONTEND.md](FRONTEND.md) |
| Look up an API endpoint, error code or realtime event | [API.md](API.md) |
| Deploy, or fix the live site | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Find out what an environment variable does | [ENVIRONMENT.md](ENVIRONMENT.md) |
| Understand how the pieces fit together | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Change the database | [DATABASE.md](DATABASE.md) |
| Check how logins, permissions and files are protected | [SECURITY.md](SECURITY.md) |
| Build a plugin or bot | [PLUGINS.md](PLUGINS.md) |

## Names you'll see in the code

The code still uses Quid's internal names, and that's fine. Users never see them:

- Packages are `@quid/shared`, `@quid/ui`, `@quid/db`, `@quid/web`, `@quid/api`.
- The session cookie is `quid_session`, and webhook headers are `X-Quid-*`.
- Some components are called `QuidMark` and `QuidWordmark`, but they draw the WickyChat logo.

Renaming them would touch hundreds of files for no visible change, so leave them unless there's a real reason.
