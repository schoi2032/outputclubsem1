/**
 * Google sign-in (OpenID Connect, authorization code + PKCE).
 *
 * The ID token comes straight from Google's token endpoint over TLS, so per
 * OIDC Core 3.1.3.7 the TLS connection authenticates it; we still check the
 * issuer, audience, expiry and nonce.
 */
export interface GoogleProfile {
  sub: string
  email: string
  emailVerified: boolean
  name: string
  nonce: string | undefined
}

export interface GoogleAuth {
  authorizeUrl(p: {
    state: string
    nonce: string
    codeChallenge: string
    redirectUri: string
    hd?: string
  }): string
  exchange(code: string, codeVerifier: string, redirectUri: string): Promise<GoogleProfile>
}

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export class GoogleOidc implements GoogleAuth {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(p: {
    state: string
    nonce: string
    codeChallenge: string
    redirectUri: string
    hd?: string
  }) {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    u.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      ...(p.hd ? { hd: p.hd } : {}),
    }).toString()
    return u.toString()
  }

  async exchange(code: string, codeVerifier: string, redirectUri: string): Promise<GoogleProfile> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const body = (await res.json().catch(() => null)) as {
      id_token?: string
      error?: string
    } | null
    if (!res.ok || !body?.id_token)
      throw new Error(`Google token exchange failed: ${body?.error ?? res.status}`)
    const payload = JSON.parse(
      Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    if (!ISSUERS.includes(String(payload.iss))) throw new Error('Unexpected ID token issuer')
    const aud = payload.aud
    if (aud !== this.clientId && !(Array.isArray(aud) && aud.includes(this.clientId)))
      throw new Error('ID token audience mismatch')
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now() - 60_000)
      throw new Error('ID token expired')
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string')
      throw new Error('ID token missing subject or email')
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      name:
        typeof payload.name === 'string' && payload.name.trim()
          ? payload.name.trim().slice(0, 80)
          : payload.email.split('@')[0]!,
      nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
    }
  }
}
