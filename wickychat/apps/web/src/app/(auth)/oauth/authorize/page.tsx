'use client'
import { Button, Field, Select, Skeleton, Switch } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { Check, Eye, Send } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { errorMessage, get, post } from '@/lib/api'
import { useMe } from '@/lib/queries'

type ClientInfo = { clientId: string; name: string; redirectHost: string }

/** OAuth consent: lets an app such as Claude use WickyChat as you, in one organization. */
function Consent() {
  const params = useSearchParams()
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const state = params.get('state') ?? undefined
  const challenge = params.get('code_challenge') ?? ''
  const method = params.get('code_challenge_method') ?? ''
  const requested = (params.get('scope') ?? 'read write').split(/\s+/)
  const me = useMe()
  const client = useQuery({
    queryKey: ['oauth-client', clientId, redirectUri],
    queryFn: ({ signal }) =>
      get<ClientInfo>(
        `/api/oauth/clients/${encodeURIComponent(clientId)}?redirect_uri=${encodeURIComponent(redirectUri)}`,
        signal,
      ),
    enabled: !!clientId && !!redirectUri,
    retry: false,
  })
  const [orgId, setOrgId] = useState('')
  const [write, setWrite] = useState(requested.includes('write'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orgs = me.data?.orgs ?? []
  const org = orgs.find((o) => o.id === orgId)
  useEffect(() => {
    if (!orgId && orgs[0]) setOrgId(orgs[0].id)
  }, [orgId, orgs])

  const paramProblem =
    params.get('response_type') !== 'code'
      ? 'This app asked for an unsupported response type.'
      : !challenge || method !== 'S256'
        ? 'This app must use PKCE (S256).'
        : null

  const deny = () => {
    if (!client.data) return
    const u = new URL(redirectUri)
    u.searchParams.set('error', 'access_denied')
    if (state) u.searchParams.set('state', state)
    window.location.href = u.toString()
  }

  if (!clientId || !redirectUri || client.isError || paramProblem) {
    return (
      <div className="rounded-xl border border-border bg-bg p-6">
        <h1 className="text-lg font-semibold">This link can't be used</h1>
        <p className="mt-2 text-[13px] text-fg-muted">
          {paramProblem ??
            (client.error ? errorMessage(client.error) : 'The request is missing details.')}{' '}
          Try connecting again from the app.
        </p>
      </div>
    )
  }
  if (!client.data || !me.data) return <Skeleton className="h-80" />

  return (
    <div className="rounded-xl border border-border bg-bg p-6">
      <h1 className="text-lg font-semibold">Connect {client.data.name} to WickyChat</h1>
      <p className="mt-1 text-[13px] text-fg-muted">
        Signed in as {me.data.user.email}. {client.data.name} will act as you and can only see what
        you can see.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        <Field label="Organization">
          {(p) => (
            <Select {...p} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ul className="flex flex-col gap-3 text-[13px]">
          <li className="flex gap-3">
            <Eye className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
            <span>
              Read your channels, DMs and threads, search messages and see your mentions
              <span className="block text-xs text-fg-subtle">Always included</span>
            </span>
            <Check className="ml-auto size-4 shrink-0 text-success" />
          </li>
          <li className="flex items-center gap-3">
            <Send className="size-4 shrink-0 text-fg-subtle" />
            <span>
              Send messages as you
              <span className="block text-xs text-fg-subtle">
                {org?.role === 'guest' ? "Guests can't grant this" : 'Only when you ask it to'}
              </span>
            </span>
            <span className="ml-auto">
              <Switch
                checked={write && org?.role !== 'guest'}
                disabled={org?.role === 'guest'}
                onCheckedChange={setWrite}
                label="Send messages as you"
              />
            </span>
          </li>
        </ul>
        <p className="text-xs text-fg-subtle">
          You'll be sent back to {client.data.redirectHost}. You can disconnect any time in Settings
          → Connected apps.
        </p>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={deny}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!orgId}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const r = await post<{ redirectTo: string }>('/api/oauth/authorize', {
                  clientId,
                  redirectUri,
                  state,
                  codeChallenge: challenge,
                  codeChallengeMethod: 'S256',
                  orgId,
                  scopes: write ? ['read', 'write'] : ['read'],
                })
                window.location.href = r.redirectTo
              } catch (e) {
                setError(errorMessage(e))
                setBusy(false)
              }
            }}
          >
            Allow
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={<Skeleton className="h-80" />}>
      <Consent />
    </Suspense>
  )
}
