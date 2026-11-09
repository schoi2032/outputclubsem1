# Security

Quid does not hold any compliance certification (SOC 2, ISO 27001, HIPAA, etc.). This document describes the controls that are actually implemented.

## Authentication

- Passwords are hashed with **argon2id** (`@node-rs/argon2`). The minimum length is 10 characters.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` on https). Only the SHA-256 hash is stored, and expiry slides forward on use (30 days by default). People can see and revoke their sessions. A password change signs out every other session, and a password reset signs out all of them.
- **Email verification** is required before sign-in. Accepting an invitation proves ownership of the mailbox, so invited users are verified on sign-up.
- **No account enumeration:** sign-up and password-reset responses are identical whether or not the email exists (the owner gets an email instead). Login errors are generic and take constant time (a dummy argon2 verify runs when the user doesn't exist).
- Email, reset and invitation tokens are random, stored hashed, single use and short-lived (verify 48 hours, reset 1 hour, invite 7 days).
- Bot accounts can never sign in.
- **Sign in with Google** uses OpenID Connect with the authorization code flow, PKCE (S256), and a random `state` and `nonce`. These are kept for 10 minutes in an `HttpOnly`, `SameSite=Lax` cookie scoped to `/api/auth/google`, and the callback rejects any mismatch, which stops login CSRF. The ID token comes straight from Google's token endpoint over TLS, and its issuer, audience, expiry and nonce are checked. Accounts are matched by Google's stable subject (`identities`), not by email. A Google account can claim an existing Quid account only when Google has verified the email. If the Quid account was never verified, its password is removed and its sessions end, so whoever pre-registered someone else's address loses access. New accounts follow `OPEN_REGISTRATION` (invite-only servers accept only invited addresses). `next` redirects are same-site paths only.
- `identities` leaves room for SAML and SCIM.

## Authorization and tenant isolation

- Every org route resolves the caller's active membership first (`requireOrg`). Non-members get **404**, not 403, so the API never confirms that an organization exists.
- Role checks use the shared permission matrix on the server. Admins can't create owners, can't act on peers or superiors, and the last owner can't be demoted or removed.
- Channel checks (`requireChannel`) run on every channel, message, file, pin, reaction, thread and search operation. Private channels are invisible to non-members, **including org admins**. Guests see only channels and people they were explicitly added to, and never see email addresses.
- Every message and file lookup is scoped by `org_id` *and* re-checked against the channel. Tests cover reading, reacting to and searching another organization's data with a valid session (`apps/api/test/tenancy.test.ts`).
- Scheduled messages re-check permissions when they're sent. Removing someone from an org removes their channel memberships immediately.

## Web protections

- **CSRF:** `SameSite=Lax` cookies plus an `Origin` check on every state-changing request (cross-site `Sec-Fetch-Site` is rejected too).
- **XSS:** message bodies are structured JSON validated against a whitelist (`sanitizeDoc`). Links are limited to http, https and mailto. The client renders them with React and never uses `innerHTML`.
- **Headers:** the API uses Helmet with `default-src 'none'`. The web app sends `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions policy.
- **WebSockets:** connections require a 30-second single-use signed ticket and an allowed `Origin`. Frames over 4 KB from clients are ignored.
- **Rate limiting:** global per-IP limit, tighter limits on authentication (10/min), messages (60/min), uploads (30/min), invitations and search.
- **Validation:** every body, query and path parameter is validated with Zod. Unknown fields are dropped.

## Files

- Size limit 25 MB (5 MB for avatars and logos). The type is **sniffed from the file's bytes**, and only an allowlist of types is accepted. SVG and HTML are never accepted.
- Storage keys are generated server-side (`orgs/<org>/files/<uuid>`), never derived from user input. Local storage resolves paths safely.
- Downloads are authorized against the channel. Non-images are served as `attachment` with `nosniff` and `Content-Security-Policy: sandbox`. On GCS, downloads use 5-minute V4 signed URLs from a private bucket.
- Images are re-encoded into WebP thumbnails, with decompression-bomb limits.
- Not yet implemented: antivirus or malware scanning.

## Secrets and credentials

- Runtime secrets come from environment variables (Secret Manager in production) and are validated at startup. Production refuses to start without `ENCRYPTION_KEY` and `INTERNAL_TOKEN`.
- Integration and AI credentials are encrypted with **AES-256-GCM**. The key never touches the database. Secrets are shown once at creation.
- Incoming webhook URLs contain a random token that's stored hashed. GitHub webhooks are additionally verified with `X-Hub-Signature-256`.
- Outgoing webhooks are signed (HMAC-SHA256 over `timestamp.body`), use https only, and are blocked from private and loopback addresses (SSRF). Private channels are sent only when an admin explicitly selects them.

## Calls and meetings

- Media tokens are issued only after the same membership checks as the rest of the API. They're valid for 10 minutes and scoped to a single room. LiveKit keys never reach the browser.
- Meetings are visible only inside their organization. Guests can't see or join meetings they weren't invited to. The waiting room is on by default for new meetings.
- Guest links are off by default and only reach meetings whose host enabled them. Guests always wait for a moderator, can't see the organization's directory or channels, and can only act through a per-guest token. Public endpoints are rate limited.
- Host actions are enforced by the API and applied on the media server. A removed participant is disconnected and can't rejoin with the same link.
- Captions are opt-in per person and only ever transcribe your own voice. The first time, a notice explains that the browser's speech service (Google in Chrome, Microsoft in Edge) processes the audio. Transcripts are readable only by attendees and the host, and are deleted with the meeting.
- Recording happens only in a host or co-host's browser, after a confirmation, and is saved to their device. Everyone in the meeting, guests included, sees a Recording indicator while it runs.
- Connected apps (the MCP server) act as one person in one organization, with read-only access unless that person also allows sending. They see only what that person can see. OAuth uses PKCE with dynamically registered public clients and loopback or https redirect URIs. Tokens are stored hashed, expire, rotate, and can be revoked by their owner. They stop working when the person leaves or an admin turns connected apps off. The bearer endpoints never accept the session cookie. Tool results tell the model that message text is untrusted content, not instructions.
- In-meeting chat travels over the media server's encrypted data channel and isn't stored. Media is encrypted in transit (DTLS-SRTP). Quid servers never record calls or meetings.

## AI and organization data

No organization content is sent to any AI provider in this release. Configuring a provider requires an administrator to explicitly authorize data access, which is recorded with who and when and written to the audit log. The context service only reads conversations the requesting person can already read.

## Billing

Card and bank details never touch Quid: PayPal (or Paddle) collects them. Only owners and admins can link a payment to a workspace, and only when the provider's record carries that workspace's ID. PayPal webhooks are checked with PayPal's verification API, and subscription state is then read from PayPal itself. Paddle webhooks need a valid `Paddle-Signature`, an HMAC-SHA256 of the raw body with a timestamp no older than 5 minutes. API secrets and webhook secrets are server-side secrets. The PayPal client ID and Paddle client token are public by design.

## Plugins

Plugins never run code inside Quid or in browsers. Quid makes signed HTTPS calls to the developer's server (HMAC-SHA256 with a per-plugin secret), and outbound URLs are checked against private and internal networks, which blocks SSRF. Submissions pass automatic checks: a public HTTPS address, proof the developer controls the server, a safe raster icon copied into Quid (no SVG), honest listing text, and an optional Google Safe Browsing lookup. Plugins that pass are listed as Unverified until the Quid team reviews them. Installing a community plugin needs Enterprise+ and an explicit acknowledgement. A plugin sees only the channels an admin adds it to, and posts as its own bot account with a hashed per-install token. Suspending a plugin stops its commands, events and API access everywhere at once. Plugin icons are served with `nosniff` and a locked-down CSP.

## Logging and audit

- pino structured logs with redaction of cookies, authorization headers, passwords, tokens and API keys. Message content is never logged.
- The audit log records: org creation and settings changes, invitations sent, accepted and revoked, role and department changes, member removal, channel creation, archiving, deletion, permission and membership changes, integrations created, enabled, disabled and removed, AI provider configuration, and announcements.

## Prepared for, not yet built

SAML SSO and Microsoft sign-in, SCIM provisioning, data retention policies, data export, data residency (choose the deploy region), and enterprise audit log export. The schema and module boundaries leave room for each.

## Reporting a vulnerability

Please email the maintainers privately rather than opening a public issue.
