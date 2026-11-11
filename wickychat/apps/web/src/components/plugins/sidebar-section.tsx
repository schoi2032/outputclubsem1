'use client'
import { cn, Popover, PopoverContent, PopoverTrigger } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Plus, Puzzle } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { PluginCommand } from '@/lib/actions'
import { get } from '@/lib/api'
import { useChannels } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { PluginIcon } from './shared'

export const pluginCommandsKey = (orgId: string) => ['plugin-commands', orgId] as const

/** Installed plugins (from their commands), for everyone in the workspace. */
export function useInstalledPlugins() {
  const { org, api } = useOrgContext()
  const q = useQuery({
    queryKey: pluginCommandsKey(org.id),
    queryFn: ({ signal }) => get<PluginCommand[]>(`${api}/plugin-commands`, signal),
    staleTime: 60_000,
  })
  const byPlugin = new Map<
    string,
    PluginCommand['plugin'] & { commands: PluginCommand[]; channelIds: string[] }
  >()
  for (const c of q.data ?? []) {
    const p = byPlugin.get(c.plugin.id) ?? { ...c.plugin, commands: [], channelIds: c.channelIds }
    p.commands.push(c)
    byPlugin.set(c.plugin.id, p)
  }
  return { ...q, plugins: [...byPlugin.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

function PluginRow({ p }: { p: ReturnType<typeof useInstalledPlugins>['plugins'][number] }) {
  const { org } = useOrgContext()
  const channels = useChannels(org.id)
  const names = p.channelIds
    .map((id) => channels.data?.find((c) => c.id === id)?.name)
    .filter(Boolean)
  return (
    <li>
      <Popover>
        <PopoverTrigger className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-fg-muted transition-colors outline-none hover:bg-bg-muted data-[state=open]:bg-bg-emphasis data-[state=open]:text-fg">
          <span className="flex size-5 shrink-0 items-center justify-center">
            <PluginIcon p={p} size={18} />
          </span>
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-72 p-0">
          <div className="flex items-center gap-3 border-b border-border p-3">
            <PluginIcon p={p} size={32} />
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[13.5px] font-semibold">
                {p.name}
                {p.verified && <BadgeCheck className="size-3.5 text-accent-text" />}
              </p>
              <p className="truncate text-xs text-fg-subtle">
                {names.length ? `In ${names.map((n) => `#${n}`).join(', ')}` : 'Installed'}
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-2 p-3">
            {p.commands.map((c) => (
              <li key={c.command} className="text-[13px]">
                <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-xs">
                  /{c.command}
                  {c.usage ? ` ${c.usage}` : ''}
                </code>
                <p className="mt-0.5 text-xs text-fg-muted">{c.description}</p>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-3 py-2 text-xs text-fg-subtle">
            Type a command in the message box of a channel it's in.
          </p>
        </PopoverContent>
      </Popover>
    </li>
  )
}

/** The sidebar's Plugins section: what's installed, and a way to add more. */
export function PluginsSidebarItems() {
  const { base, org } = useOrgContext()
  const pathname = usePathname()
  const { plugins } = useInstalledPlugins()
  const isAdmin = org.role === 'owner' || org.role === 'admin'
  if (org.role === 'guest' && !plugins.length) return null
  return (
    <>
      {plugins.map((p) => (
        <PluginRow key={p.id} p={p} />
      ))}
      <li>
        <Link
          href={`${base}/plugins`}
          aria-current={pathname === `${base}/plugins` ? 'page' : undefined}
          className={cn(
            'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-subtle hover:bg-bg-muted hover:text-fg',
            pathname === `${base}/plugins` && 'bg-bg-emphasis text-fg',
          )}
        >
          <span className="flex size-5 items-center justify-center rounded-[5px] bg-bg-muted">
            {plugins.length || !isAdmin ? (
              <Plus className="size-3.5" />
            ) : (
              <Puzzle className="size-3.5" />
            )}
          </span>
          {isAdmin ? 'Add plugins' : 'Browse plugins'}
        </Link>
      </li>
    </>
  )
}
