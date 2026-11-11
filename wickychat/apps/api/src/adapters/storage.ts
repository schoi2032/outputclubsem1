/**
 * Object storage abstraction. Local filesystem in development, Google Cloud
 * Storage in production. This is the seed of WickyChat Drive, so keys are opaque and
 * never derived from user input.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Config } from '../core/config'

export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<{ stream: Readable; size: number }>
  delete(key: string): Promise<void>
  /** A short-lived direct download URL, or null when files must be streamed through the API. */
  signedUrl(
    key: string,
    opts: { filename: string; inline: boolean; contentType: string },
  ): Promise<string | null>
}

export class LocalStorage implements StorageAdapter {
  private readonly root: string
  constructor(dir: string) {
    this.root = resolve(dir)
  }

  private path(key: string) {
    const p = resolve(this.root, key)
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key')
    return p
  }

  async put(key: string, body: Buffer) {
    const p = this.path(key)
    await mkdir(dirname(p), { recursive: true })
    await pipeline(async function* () {
      yield body
    }, createWriteStream(p))
  }

  async get(key: string) {
    const p = this.path(key)
    const s = await stat(p)
    return { stream: createReadStream(p), size: s.size }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true })
  }

  async signedUrl() {
    return null
  }
}

export class GcsStorage implements StorageAdapter {
  private bucket: Promise<import('@google-cloud/storage').Bucket>
  constructor(bucketName: string) {
    this.bucket = import('@google-cloud/storage').then((m) => new m.Storage().bucket(bucketName))
  }

  async put(key: string, body: Buffer, contentType: string) {
    await (await this.bucket).file(key).save(body, { contentType, resumable: false })
  }

  async get(key: string) {
    const file = (await this.bucket).file(key)
    const [meta] = await file.getMetadata()
    return { stream: file.createReadStream(), size: Number(meta.size ?? 0) }
  }

  async delete(key: string) {
    await (await this.bucket).file(key).delete({ ignoreNotFound: true })
  }

  async signedUrl(key: string, opts: { filename: string; inline: boolean; contentType: string }) {
    const disposition = `${opts.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(opts.filename)}`
    const [url] = await (await this.bucket).file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 5 * 60_000,
      responseDisposition: disposition,
      responseType: opts.contentType,
    })
    return url
  }
}

/**
 * Vercel Blob, used when WickyChat runs on Vercel. Keys are random ids, never user input.
 * Files are streamed through the API so access checks stay on our side.
 */
export class BlobStorage implements StorageAdapter {
  private readonly blob = import('@vercel/blob')

  async put(key: string, body: Buffer, contentType: string) {
    const { put } = await this.blob
    await put(key, body, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  }

  async get(key: string) {
    const { head } = await this.blob
    const meta = await head(key)
    const res = await fetch(meta.url)
    if (!res.ok || !res.body) throw new Error(`Blob fetch failed: ${res.status}`)
    const { Readable } = await import('node:stream')
    return {
      stream: Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      size: meta.size,
    }
  }

  async delete(key: string) {
    const { del, head } = await this.blob
    try {
      await del((await head(key)).url)
    } catch {}
  }

  async signedUrl() {
    return null
  }
}

export function createStorage(config: Config): StorageAdapter {
  if (config.STORAGE_DRIVER === 'blob') return new BlobStorage()
  return config.STORAGE_DRIVER === 'gcs'
    ? new GcsStorage(config.GCS_BUCKET!)
    : new LocalStorage(config.STORAGE_LOCAL_DIR)
}
