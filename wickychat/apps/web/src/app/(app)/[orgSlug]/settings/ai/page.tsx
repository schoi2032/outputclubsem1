'use client'
import { Badge, Button, Field, Input, Select, Skeleton, toast } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { del, errorMessage, get, post } from '@/lib/api'
import { relative } from '@/lib/format'

type Provider = {
  id: string
  provider: string
  model: string
  enabled: boolean
  dataAccessConsentAt: string | null
  createdAt: string
}

export default function AiSettings() {
  const { org, api } = useOrgContext()
  const list = useQuery({
    queryKey: ['ai', org.id],
    queryFn: ({ signal }) => get<Provider[]>(`${api}/ai/providers`, signal),
  })
  const [model, setModel] = useState('claude-opus-5-5')
  const [apiKey, setApiKey] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <SettingsTitle
        title="AI providers"
        description="Connect Claude to turn on Catch up summaries, @Claude in conversations and a private Claude DM for everyone. To use WickyChat from the Claude apps instead, see Settings → Connected apps."
      />
      <SettingsCard title="How organization data is protected">
        <ul className="flex flex-col gap-2 text-[13px] text-fg-muted">
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            Nothing is sent to an AI provider until an administrator explicitly authorizes it below.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            Assistants only read conversations the requesting person can already read.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            API keys are encrypted with AES-256-GCM. Configuration changes are audited.
          </li>
        </ul>
      </SettingsCard>
      <SettingsCard title="Configured providers">
        {list.isLoading ? (
          <Skeleton className="h-12" />
        ) : !list.data?.length ? (
          <p className="text-[13px] text-fg-subtle">No providers configured.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <Sparkles className="size-4" />
                <div className="flex-1">
                  <p className="text-[13px] font-medium capitalize">
                    {p.provider}{' '}
                    <span className="font-mono text-xs font-normal text-fg-muted">{p.model}</span>
                  </p>
                  <p className="text-xs text-fg-subtle">
                    Authorized {p.dataAccessConsentAt ? relative(p.dataAccessConsentAt) : '—'}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const r = await post<{ ok: boolean; model?: string; error?: string }>(
                        `${api}/ai/providers/${p.id}/test`,
                      )
                      if (r.ok) toast.success(`Connected to ${r.model}`)
                      else toast.error(r.error ?? 'Connection failed')
                    } catch (e) {
                      toast.error(errorMessage(e))
                    }
                  }}
                >
                  Test connection
                </Button>
                <Button
                  size="sm"
                  variant="danger-ghost"
                  onClick={async () => {
                    await del(`${api}/ai/providers/${p.id}`).catch((e) =>
                      toast.error(errorMessage(e)),
                    )
                    void list.refetch()
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
      <SettingsCard title="Add a provider">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await post(`${api}/ai/providers`, {
                provider: 'anthropic',
                model,
                apiKey,
                dataAccessConsent: consent,
              })
              setApiKey('')
              setConsent(false)
              void list.refetch()
              toast.success('Provider saved')
            } catch (err) {
              toast.error(errorMessage(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label="Provider">
            {(p) => (
              <Select {...p} value="anthropic" onChange={() => {}}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai" disabled>
                  OpenAI — coming soon
                </option>
              </Select>
            )}
          </Field>
          <Field label="Model">
            {(p) => (
              <Input
                {...p}
                className="font-mono"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            )}
          </Field>
          <Field label="API key">
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="off"
                required
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            )}
          </Field>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I authorize sending conversation content from {org.name} to this provider when members
              use AI features. <Badge tone="warning">Required</Badge>
            </span>
          </label>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busy} disabled={!consent || !apiKey}>
              Save provider
            </Button>
          </div>
        </form>
      </SettingsCard>
    </>
  )
}
