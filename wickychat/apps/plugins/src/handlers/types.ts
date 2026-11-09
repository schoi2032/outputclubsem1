import type { Install, Poster } from '../quid'
import type { Sql } from '../store'

export interface CommandInput {
  installId: string
  command: string
  text: string
  user: { id: string; name: string }
  channel: { id: string; name: string }
  threadId: string | null
}

export interface Reply {
  text: string
  visibility?: 'ephemeral' | 'channel'
}

export type Translator = (text: string, target: string) => Promise<string>

export interface Deps {
  sql: Sql
  post: Poster
  translate: Translator | null
  now: () => Date
  /** Loads an install (with its decrypted token). */
  install: (installId: string) => Promise<Install | null>
}

export interface PluginImpl {
  command(deps: Deps, input: CommandInput): Promise<Reply>
  /** Runs about once a minute. */
  cron?(deps: Deps): Promise<void>
}

export const ephemeral = (text: string): Reply => ({ text, visibility: 'ephemeral' })
export const channel = (text: string): Reply => ({ text, visibility: 'channel' })
