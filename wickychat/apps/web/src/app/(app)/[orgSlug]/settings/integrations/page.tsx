'use client'
import type { Integration } from '@quid/shared'
import { WEBHOOK_EVENTS } from '@quid/shared'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Switch,
  toast,
} from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { Copy, GitPullRequest as Github, Trash2, Webhook } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { del, errorMessage, get, patch, post } from '@/lib/api'
import { channelRef } from '@/lib/channels'
import { relative } from '@/lib/format'
import { useChannels } from '@/lib/queries'

type Kind = 'incoming_webhook' | 'github' | 'outgoing_webhook'
const KIND_LABEL: Record<Integration['kind'], string> = {
  incoming_webhook: 'Incoming webhook',
  github: 'GitHub',
  outgoing_webhook: 'Outgoing webhook',
  bot: 'Bot',
  plugin: 'Plugin',
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium">{label}</p>
      <div className="flex gap-1.5">
        <Input
          readOnly
          value={value}
          className="font-mono text-xs"
          onFocus={(e) => e.target.select()}
        />
        <IconButton
          label="Copy"
          onClick={() => {
            void navigator.clipboard.writeText(value)
            toast.success('Copied')
          }}
        >
          <Copy />
        </IconButton>
      </div>
    </div>
  )
}

export default function IntegrationsSettings() {
  const { org, api, me } = useOrgContext()
  const channels = useChannels(org.id)
  const list = useQuery({
    queryKey: ['integrations', org.id],
    queryFn: ({ signal }) => get<Integration[]>(`${api}/integrations`, signal),
  })
  const [creating, setCreating] = useState<Kind | null>(null)
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['message.created'])
  const [created, setCreated] = useState<Integration | null>(null)
  const [busy, setBusy] = useState(false)
  const postable = (channels.data ?? []).filter(
    (c) => (c.kind === 'public' || c.kind === 'private') && !c.archivedAt,
  )

  const create = async () => {
    setBusy(true)
    try {
      const r =
        creating === 'outgoing_webhook'
          ? await post<Integration>(`${api}/integrations/outgoing-webhooks`, {
              name,
              url,
              events,
              channelIds: channelId ? [channelId] : [],
            })
          : await post<Integration>(`${api}/integrations/incoming-webhooks`, {
              name,
              channelId,
              kind: creating,
            })
      setCreating(null)
      setCreated(r)
      void list.refetch()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const start = (k: Kind) => {
    setName(k === 'github' ? 'GitHub' : '')
    setChannelId(postable[0]?.id ?? '')
    setUrl('')
    setEvents(['message.created'])
    setCreating(k)
  }

  return (
    <>
      <SettingsTitle
        title="Integrations"
        description="Connect other tools through a standard interface. Secrets are encrypted at rest and shown only once."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {(
          [
            [
              'incoming_webhook',
              Webhook,
              'Incoming webhook',
              'Post messages into a channel from any system.',
            ],
            ['github', Github, 'GitHub', 'Pushes, pull requests, issues and releases.'],
            [
              'outgoing_webhook',
              Webhook,
              'Outgoing webhook',
              'Send signed events to your own services.',
            ],
          ] as const
        ).map(([k, Icon, title, desc]) => (
          <button
            key={k}
            type="button"
            onClick={() => start(k)}
            className="q-lift flex flex-col items-start gap-1 rounded-xl border border-border p-4 text-left hover:border-border-strong hover:bg-bg-subtle"
          >
            <Icon className="mb-1 size-5" />
            <span className="text-[13px] font-semibold">{title}</span>
            <span className="text-xs text-fg-muted">{desc}</span>
          </button>
        ))}
      </div>
      <p className="mb-6 text-xs text-fg-subtle">
        Google Drive, Calendar, Notion, Jira, Figma and AI assistants will plug into the same
        interface in later releases.
      </p>

      <SettingsCard title="Installed">
        {list.isLoading ? (
          <Skeleton className="h-16" />
        ) : !list.data?.length ? (
          <p className="text-[13px] text-fg-subtle">No integrations yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((i) => {
              const ch = channels.data?.find((c) => c.id === i.channelId)
              return (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  {i.kind === 'github' ? (
                    <Github className="size-4" />
                  ) : (
                    <Webhook className="size-4" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">
                      {i.name} <Badge>{KIND_LABEL[i.kind]}</Badge>
                    </p>
                    <p className="truncate text-xs text-fg-subtle">
                      {ch ? channelRef(ch, me.id) : ((i.config.url as string) ?? '')} · added{' '}
                      {relative(i.createdAt)}
                    </p>
                  </div>
                  <Switch
                    checked={i.enabled}
                    label={i.enabled ? 'Disable' : 'Enable'}
                    onCheckedChange={async (v) => {
                      await patch(`${api}/integrations/${i.id}`, { enabled: v }).catch((e) =>
                        toast.error(errorMessage(e)),
                      )
                      void list.refetch()
                    }}
                  />
                  <IconButton
                    label={`Remove ${i.name}`}
                    size="sm"
                    onClick={async () => {
                      await del(`${api}/integrations/${i.id}`).catch((e) =>
                        toast.error(errorMessage(e)),
                      )
                      void list.refetch()
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              )
            })}
          </ul>
        )}
      </SettingsCard>

      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent title={creating ? `Add ${KIND_LABEL[creating].toLowerCase()}` : ''}>
          <div className="flex flex-col gap-4">
            <Field label="Name" hint="Shown as the bot's name on posted messages.">
              {(p) => (
                <Input
                  {...p}
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            {creating === 'outgoing_webhook' && (
              <>
                <Field
                  label="Endpoint URL"
                  hint="Must be https. Requests are signed with HMAC-SHA256."
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="url"
                      placeholder="https://example.com/quid"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  )}
                </Field>
                <fieldset>
                  <legend className="mb-1.5 text-[13px] font-medium">Events</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {WEBHOOK_EVENTS.map((ev) => (
                      <label key={ev} className="flex items-center gap-1.5 text-[13px]">
                        <input
                          type="checkbox"
                          checked={events.includes(ev)}
                          onChange={(e) =>
                            setEvents((s) =>
                              e.target.checked ? [...s, ev] : s.filter((x) => x !== ev),
                            )
                          }
                        />
                        <code className="text-xs">{ev}</code>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            <Field
              label={creating === 'outgoing_webhook' ? 'Channel (optional)' : 'Post to channel'}
              hint={
                creating === 'outgoing_webhook'
                  ? 'Leave empty to send events from all public channels. Private channels are only sent when selected.'
                  : undefined
              }
            >
              {(p) => (
                <Select {...p} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                  {creating === 'outgoing_webhook' && <option value="">All public channels</option>}
                  {postable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {channelRef(c, me.id)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreating(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={
                !name.trim() ||
                (creating !== 'outgoing_webhook' && !channelId) ||
                (creating === 'outgoing_webhook' && (!url || !events.length))
              }
              onClick={create}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent
          title={`${created?.name} is ready`}
          description="Copy these values now. For your security they won't be shown again."
        >
          {created?.secretUrl && (
            <Secret
              label={
                created.kind === 'github'
                  ? 'Payload URL (content type: application/json)'
                  : 'Webhook URL'
              }
              value={created.secretUrl}
            />
          )}
          {created?.signingSecret && (
            <Secret
              label={created.kind === 'github' ? 'Secret' : 'Signing secret'}
              value={created.signingSecret}
            />
          )}
          {created?.kind === 'incoming_webhook' && (
            <pre className="mt-4 overflow-x-auto rounded-md bg-bg-subtle p-3 font-mono text-xs">{`curl -X POST -H 'Content-Type: application/json' \\\n  -d '{"text":"Hello from my script"}' \\\n  '${created.secretUrl}'`}</pre>
          )}
          {created?.kind === 'outgoing_webhook' && (
            <p className="mt-3 text-xs text-fg-muted">
              Verify requests by computing HMAC-SHA256 of{' '}
              <code>{'{X-WickyChat-Timestamp}.{body}'}</code> with the signing secret and comparing
              it to <code>X-WickyChat-Signature</code>.
            </p>
          )}
          <DialogFooter>
            <Button variant="primary" onClick={() => setCreated(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
