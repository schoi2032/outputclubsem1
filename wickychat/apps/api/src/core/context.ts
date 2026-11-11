import type { Db } from '@quid/db'
import type { Logger } from 'pino'
import type { EmailAdapter } from '../adapters/email'
import type { GoogleAuth } from '../adapters/google'
import type { MediaProvider } from '../adapters/media'
import type { StorageAdapter } from '../adapters/storage'
import type { AIFactory } from '../modules/ai/providers'
import type { Config } from './config'
import type { SecretBox } from './crypto'
import type { EventBus } from './eventbus'

/** Everything a module needs, created once at startup and injected (easy to fake in tests). */
export interface AppContext {
  config: Config
  db: Db
  log: Logger
  bus: EventBus
  email: EmailAdapter
  storage: StorageAdapter
  media: MediaProvider
  secrets: SecretBox
  /** Google sign-in, when configured. */
  google: GoogleAuth | null
  /** Builds the AI provider for an organization's stored credentials. */
  ai: AIFactory
  /** Users with at least one live WebSocket connection on this instance. */
  online: OnlineTracker
}

export class OnlineTracker {
  private readonly counts = new Map<string, number>()
  private readonly listeners: ((userId: string, online: boolean) => void)[] = []

  /** Called when a user's first connection opens or last connection closes. */
  onChange(fn: (userId: string, online: boolean) => void) {
    this.listeners.push(fn)
  }

  private emit(userId: string, online: boolean) {
    for (const fn of this.listeners) fn(userId, online)
  }

  connect(userId: string) {
    const n = (this.counts.get(userId) ?? 0) + 1
    this.counts.set(userId, n)
    if (n === 1) this.emit(userId, true)
  }

  disconnect(userId: string) {
    const n = (this.counts.get(userId) ?? 1) - 1
    if (n <= 0) {
      this.counts.delete(userId)
      this.emit(userId, false)
    } else this.counts.set(userId, n)
  }

  isOnline(userId: string) {
    return this.counts.has(userId)
  }
}
