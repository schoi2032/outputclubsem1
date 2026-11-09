/**
 * The plugin service keeps its own small tables in the `official_plugins` schema of
 * WickyChat's database. Install tokens are encrypted with a key derived from OFFICIAL_PLUGINS_KEY.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import postgres from 'postgres'

export type Sql = ReturnType<typeof postgres>

export function connect(url: string): Sql {
  // Cloud SQL connects over a Unix socket given in PGHOST; see packages/db createDb.
  const socket = process.env.PGHOST?.startsWith('/') ? process.env.PGHOST : undefined
  return postgres(url.replace('@/', '@localhost/'), {
    ...(socket && { host: socket }),
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  })
}

export async function migrate(sql: Sql) {
  await sql.unsafe(`
    create schema if not exists official_plugins;
    create table if not exists official_plugins.installs (
      install_id text primary key,
      plugin text not null,
      workspace_id text not null,
      token text not null,
      api_base text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists official_plugins.polls (
      id serial primary key,
      install_id text not null references official_plugins.installs(install_id) on delete cascade,
      channel_id text not null,
      question text not null,
      options jsonb not null,
      created_by text not null,
      closed boolean not null default false,
      created_at timestamptz not null default now()
    );
    create index if not exists polls_channel_idx on official_plugins.polls (install_id, channel_id, id desc);
    create table if not exists official_plugins.votes (
      poll_id int not null references official_plugins.polls(id) on delete cascade,
      user_id text not null,
      option int not null,
      primary key (poll_id, user_id)
    );
    create table if not exists official_plugins.reminders (
      id serial primary key,
      install_id text not null references official_plugins.installs(install_id) on delete cascade,
      channel_id text not null,
      thread_id text,
      user_id text not null,
      user_name text not null,
      text text not null,
      due_at timestamptz not null,
      sent_at timestamptz
    );
    create index if not exists reminders_due_idx on official_plugins.reminders (due_at) where sent_at is null;
    create table if not exists official_plugins.standups (
      install_id text not null references official_plugins.installs(install_id) on delete cascade,
      channel_id text not null,
      at_time text not null,
      tz text not null,
      last_run text,
      primary key (install_id, channel_id)
    );
  `)
}

/** AES-256-GCM for install tokens at rest. */
export function tokenBox(key: string) {
  const k = createHmac('sha256', key).update('token-encryption').digest()
  return {
    seal(plain: string) {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', k, iv)
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.')
    },
    open(sealed: string) {
      const [iv, tag, ct] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'))
      const d = createDecipheriv('aes-256-gcm', k, iv!)
      d.setAuthTag(tag!)
      return Buffer.concat([d.update(ct!), d.final()]).toString('utf8')
    },
  }
}
