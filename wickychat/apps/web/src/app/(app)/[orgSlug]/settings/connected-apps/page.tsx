'use client'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  toast,
} from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { Copy, KeyRound, Plug } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { del, errorMessage, get, post } from '@/lib/api'
import { relative } from '@/lib/format'

type ConnectedApp = {
  id: string
  name: string
  kind: 'oauth' | 'personal'
  scopes: ('read' | 'write')[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}
type Data = { enabled: boolean; mcpUrl: string; apps: ConnectedApp[] }

const copy = (text: string) => {
  void navigator.clipboard.writeText(text)
  toast.success('Copied')
}

export default function ConnectedAppsSettings() {
  const { org, api } = useOrgContext()
  const q = useQuery({
    queryKey: ['connected-apps', org.id],
    queryFn: ({ signal }) => get<Data>(`${api}/connected-apps`, signal),
  })
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [write, setWrite] = useState(false)
  const [days, setDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  return (
    <>
      <SettingsTitle
        title="Connected apps"
        description={`Let Claude and other AI apps work with your ${org.name} messages. They act as you and only see what you can see.`}
      />
      {!q.data ? (
        <Skeleton className="h-60" />
      ) : !q.data.enabled ? (
        <SettingsCard title="Turned off">
          <p className="text-[13px] text-fg-muted">
            An administrator has turned off connected apps for {org.name}.
          </p>
        </SettingsCard>
      ) : (
        <>
          <SettingsCard
            title="Connect Claude"
            description="WickyChat works as a remote MCP server."
          >
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] text-fg-muted">
              <li>
                In Claude, open{' '}
                <strong className="text-fg">Settings → Connectors → Add custom connector</strong>.
              </li>
              <li>
                Paste this URL:
                <span className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-bg-muted px-2 py-1 font-mono text-xs text-fg">
                    {q.data.mcpUrl}
                  </code>
                  <Button size="sm" onClick={() => copy(q.data!.mcpUrl)}>
                    <Copy /> Copy
                  </Button>
                </span>
              </li>
              <li>
                Claude sends you here to choose the organization and whether it may send messages.
              </li>
            </ol>
            <p className="mt-3 text-xs text-fg-subtle">
              Claude Code:{' '}
              <code className="font-mono">
                claude mcp add --transport http quid {q.data.mcpUrl}
              </code>
            </p>
          </SettingsCard>

          <SettingsCard title="Your connections">
            {!q.data.apps.length ? (
              <p className="text-[13px] text-fg-subtle">Nothing connected yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {q.data.apps.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-3 text-[13px]">
                    {a.kind === 'oauth' ? (
                      <Plug className="size-4 text-fg-subtle" />
                    ) : (
                      <KeyRound className="size-4 text-fg-subtle" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        {a.name}
                        <Badge>{a.scopes.includes('write') ? 'Read & send' : 'Read only'}</Badge>
                      </span>
                      <span className="block text-xs text-fg-subtle">
                        {a.kind === 'oauth' ? 'App' : 'Personal token'} · added{' '}
                        {relative(a.createdAt)}
                        {a.lastUsedAt ? ` · last used ${relative(a.lastUsedAt)}` : ' · never used'}
                        {a.expiresAt
                          ? ` · expires ${new Date(a.expiresAt).toLocaleDateString()}`
                          : ''}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        try {
                          await del(`${api}/connected-apps/${a.id}`)
                          toast.success(`${a.name} disconnected`)
                          void q.refetch()
                        } catch (e) {
                          toast.error(errorMessage(e))
                        }
                      }}
                    >
                      Disconnect
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>

          <SettingsCard
            title="Personal tokens"
            description="For tools that can't sign in with OAuth. Send as `Authorization: Bearer <token>` to the MCP URL."
          >
            <Button onClick={() => setCreating(true)}>
              <KeyRound /> Create token
            </Button>
          </SettingsCard>
        </>
      )}

      <Dialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o)
          if (!o) {
            setCreated(null)
            setName('')
          }
        }}
      >
        <DialogContent
          title={created ? 'Copy your token' : 'Create a personal token'}
          description={
            created
              ? "You won't see it again. Treat it like a password."
              : 'Acts as you in this organization.'
          }
        >
          {created ? (
            <span className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-bg-muted px-2 py-1 font-mono text-xs">
                {created}
              </code>
              <Button size="sm" onClick={() => copy(created)}>
                <Copy /> Copy
              </Button>
            </span>
          ) : (
            <div className="flex flex-col gap-4">
              <Field label="Name">
                {(p) => (
                  <Input
                    {...p}
                    value={name}
                    maxLength={60}
                    placeholder="e.g. Claude Desktop"
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Expires">
                {(p) => (
                  <Select {...p} value={days} onChange={(e) => setDays(e.target.value)}>
                    <option value="7">In 7 days</option>
                    <option value="30">In 30 days</option>
                    <option value="90">In 90 days</option>
                    <option value="365">In a year</option>
                    <option value="never">Never</option>
                  </Select>
                )}
              </Field>
              {org.role !== 'guest' && (
                <div className="flex items-center justify-between gap-4 text-[13px]">
                  <span>
                    Allow sending messages
                    <span className="block text-xs text-fg-subtle">
                      Otherwise the token is read-only.
                    </span>
                  </span>
                  <Switch
                    checked={write}
                    onCheckedChange={setWrite}
                    label="Allow sending messages"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {created ? (
              <Button variant="primary" onClick={() => setCreating(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button onClick={() => setCreating(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!name.trim()}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const r = await post<{ token: string }>(`${api}/connected-apps/tokens`, {
                        name: name.trim(),
                        scopes: write ? ['read', 'write'] : ['read'],
                        expiresInDays: days === 'never' ? null : Number(days),
                      })
                      setCreated(r.token)
                      void q.refetch()
                    } catch (e) {
                      toast.error(errorMessage(e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Create
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
