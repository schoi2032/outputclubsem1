'use client'
import { Button, Field, Input, Skeleton, Switch, Textarea, toast } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Copy, MinusCircle, Plus, Trash2, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { type Plugin, type PluginCheck, PluginIcon, StatusBadge } from '@/components/plugins/shared'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { errorMessage, get, post } from '@/lib/api'

function Checks({ checks }: { checks: PluginCheck[] }) {
  return (
    <ul className="flex flex-col gap-2 text-[13px]">
      {checks.map((c) => (
        <li key={c.id} className="flex gap-2">
          {c.status === 'passed' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          ) : c.status === 'failed' ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
          ) : (
            <MinusCircle className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          )}
          <span>
            {c.label}
            {c.detail && <span className="block text-xs text-fg-subtle">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Result({
  plugin,
  secret,
  onRecheck,
}: {
  plugin: Plugin
  secret?: string
  onRecheck: () => void
}) {
  const { base } = useOrgContext()
  const live = plugin.status === 'verified' || plugin.status === 'unverified'
  return (
    <>
      <SettingsCard title="Safety checks">
        <div className="mb-4 flex items-center gap-3">
          <PluginIcon p={plugin} />
          <span className="font-semibold">{plugin.name}</span>
          <StatusBadge p={plugin} />
        </div>
        <Checks checks={plugin.checks ?? []} />
        <p className="mt-4 text-[13px] text-fg-muted">
          {live
            ? plugin.private
              ? 'All checks passed. Admins of this workspace can install it now.'
              : 'All checks passed. It is listed as a community plugin; the WickyChat team reviews community plugins and marks them verified.'
            : 'Fix the failing checks on your server, then run them again.'}
        </p>
        <div className="mt-4 flex gap-2">
          <Button onClick={onRecheck}>Run checks again</Button>
          <Button asChild variant="primary">
            <Link href={`${base}/settings/plugins`}>Back to plugins</Link>
          </Button>
        </div>
      </SettingsCard>
      {secret && (
        <SettingsCard
          title="Signing secret"
          description="Shown once. Your server uses it to check that requests really come from WickyChat."
        >
          <span className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-bg-muted px-2 py-1 font-mono text-xs">
              {secret}
            </code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(secret)
                toast.success('Copied')
              }}
            >
              <Copy /> Copy
            </Button>
          </span>
        </SettingsCard>
      )}
      <SettingsCard title="How your server talks to WickyChat">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-fg-muted">
          <li>
            WickyChat POSTs JSON to <code>{'{base URL}'}/quid/verify</code>, <code>/install</code>,{' '}
            <code>/uninstall</code>, <code>/command</code> and <code>/events</code>.
          </li>
          <li>
            Each request has <code>x-quid-timestamp</code> and{' '}
            <code>x-quid-signature: sha256=HMAC(secret, timestamp + "." + body)</code>.
          </li>
          <li>
            <code>/verify</code>: reply <code>{'{ "challenge": "<the challenge>" }'}</code>.{' '}
            <code>/command</code>: reply{' '}
            <code>{'{ "text": "...", "visibility": "ephemeral" | "channel" }'}</code> within 5
            seconds.
          </li>
          <li>
            <code>/install</code> gives you a token. Post with{' '}
            <code>POST /api/plugin-api/v1/messages</code> and{' '}
            <code>Authorization: Bearer &lt;token&gt;</code>, body{' '}
            <code>{'{ "channelId", "text" }'}</code>.
          </li>
        </ul>
      </SettingsCard>
    </>
  )
}

function SubmitInner() {
  const { org, api } = useOrgContext()
  const params = useSearchParams()
  const existingId = params.get('id')
  const existing = useQuery({
    queryKey: ['plugins', org.id],
    queryFn: ({ signal }) =>
      get<{ enterprise: boolean; plugins: Plugin[] }>(`${api}/plugins`, signal),
  })
  const [form, setForm] = useState({
    name: '',
    tagline: '',
    description: '',
    developerName: '',
    developerEmail: '',
    homepageUrl: '',
    iconUrl: '',
    baseUrl: '',
    readsMessages: false,
    private: false,
  })
  const [commands, setCommands] = useState<{ name: string; description: string }[]>([
    { name: '', description: '' },
  ])
  const [result, setResult] = useState<{ plugin: Plugin; secret?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const shown = result?.plugin ?? existing.data?.plugins.find((p) => p.id === existingId)

  const recheck = async (p: Plugin) => {
    try {
      const fresh = await post<Plugin>(
        `${api}/plugins/${p.id}/recheck`,
        form.iconUrl ? { iconUrl: form.iconUrl } : {},
      )
      setResult((r) => ({ plugin: fresh, secret: r?.secret }))
      void existing.refetch()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (existingId && !shown) return <Skeleton className="h-60" />
  if (shown)
    return <Result plugin={shown} secret={result?.secret} onRecheck={() => recheck(shown)} />

  return (
    <form
      className="contents"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const r = await post<{ plugin: Plugin; signingSecret: string }>(`${api}/plugins`, {
            name: form.name,
            tagline: form.tagline,
            description: form.description,
            developerName: form.developerName,
            developerEmail: form.developerEmail,
            homepageUrl: form.homepageUrl || null,
            iconUrl: form.iconUrl || null,
            baseUrl: form.baseUrl,
            commands: commands
              .filter((c) => c.name.trim())
              .map((c) => ({ name: c.name.trim().replace(/^\//, ''), description: c.description })),
            events: form.readsMessages ? ['message.created'] : [],
            private: form.private,
          })
          setResult({ plugin: r.plugin, secret: r.signingSecret })
          void existing.refetch()
        } catch (err) {
          toast.error(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <SettingsCard title="Listing">
        <div className="flex flex-col gap-4">
          <Field label="Name">
            {(p) => (
              <Input {...p} required maxLength={40} value={form.name} onChange={set('name')} />
            )}
          </Field>
          <Field label="Tagline" hint="One sentence about what it does.">
            {(p) => (
              <Input
                {...p}
                required
                maxLength={90}
                value={form.tagline}
                onChange={set('tagline')}
              />
            )}
          </Field>
          <Field label="Description">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={set('description')}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Developer or company">
              {(p) => (
                <Input {...p} required value={form.developerName} onChange={set('developerName')} />
              )}
            </Field>
            <Field label="Contact email">
              {(p) => (
                <Input
                  {...p}
                  required
                  type="email"
                  value={form.developerEmail}
                  onChange={set('developerEmail')}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website" hint="Optional">
              {(p) => (
                <Input {...p} type="url" value={form.homepageUrl} onChange={set('homepageUrl')} />
              )}
            </Field>
            <Field label="Icon URL" hint="PNG, JPEG, WebP or GIF, up to 512 KB">
              {(p) => <Input {...p} type="url" value={form.iconUrl} onChange={set('iconUrl')} />}
            </Field>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Server"
        description="Where WickyChat sends commands and events. Must be HTTPS on a public address."
      >
        <Field label="Base URL">
          {(p) => (
            <Input
              {...p}
              required
              type="url"
              placeholder="https://plugin.example.com"
              value={form.baseUrl}
              onChange={set('baseUrl')}
            />
          )}
        </Field>
        <p className="mt-4 text-[13px] font-medium">Slash commands</p>
        <div className="mt-2 flex flex-col gap-2">
          {commands.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label="Command"
                placeholder="/command"
                className="w-40"
                value={c.name}
                onChange={(e) =>
                  setCommands((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <Input
                aria-label="What it does"
                placeholder="What it does"
                className="flex-1"
                value={c.description}
                onChange={(e) =>
                  setCommands((cs) =>
                    cs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                aria-label="Remove command"
                onClick={() => setCommands((cs) => cs.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {commands.length < 10 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setCommands((cs) => [...cs, { name: '', description: '' }])}
            >
              <Plus /> Add command
            </Button>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 text-[13px]">
          <span>
            Read new messages
            <span className="block text-xs text-fg-subtle">
              Receive messages posted in the channels it's added to.
            </span>
          </span>
          <Switch
            checked={form.readsMessages}
            onCheckedChange={(v) => setForm((f) => ({ ...f, readsMessages: v }))}
            label="Read new messages"
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 text-[13px]">
          <span>
            Private to {org.name}
            <span className="block text-xs text-fg-subtle">
              Only this workspace can see and install it.
            </span>
          </span>
          <Switch
            checked={form.private}
            disabled={!existing.data?.enterprise}
            onCheckedChange={(v) => setForm((f) => ({ ...f, private: v }))}
            label="Private plugin"
          />
        </div>
      </SettingsCard>
      <div className="mb-8 flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          Submit and run checks
        </Button>
      </div>
    </form>
  )
}

export default function SubmitPlugin() {
  return (
    <>
      <SettingsTitle
        title="Submit a plugin"
        description="Every plugin passes automatic safety checks before anyone can install it. Plugins run on your own server; no code is uploaded to WickyChat."
      />
      <Suspense fallback={<Skeleton className="h-60" />}>
        <SubmitInner />
      </Suspense>
    </>
  )
}
