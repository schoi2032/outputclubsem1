import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/** URL-safe random token (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export interface Encrypted {
  ciphertext: string
  iv: string
  tag: string
  keyVersion: number
}

/**
 * AES-256-GCM envelope for integration credentials. The key comes from the
 * environment (Secret Manager in production) and never touches the database.
 */
export class SecretBox {
  private readonly key: Buffer

  constructor(base64Key: string | undefined, isProd: boolean) {
    if (base64Key) {
      this.key = Buffer.from(base64Key, 'base64')
      if (this.key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded')
    } else if (isProd) {
      throw new Error('ENCRYPTION_KEY is required in production')
    } else {
      // Deterministic dev key so local data survives restarts. Never used in production.
      this.key = createHash('sha256').update('quid-dev-only-encryption-key').digest()
    }
  }

  encrypt(plaintext: string): Encrypted {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyVersion: 1,
    }
  }

  decrypt(e: Pick<Encrypted, 'ciphertext' | 'iv' | 'tag'>): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(e.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(e.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }
}
