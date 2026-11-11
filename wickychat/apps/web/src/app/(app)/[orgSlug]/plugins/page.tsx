'use client'
import { Button, EmptyState } from '@quid/ui'
import { BookOpen, Puzzle } from 'lucide-react'
import Link from 'next/link'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { PluginDirectory } from '@/components/plugins/directory'
import { PluginIcon } from '@/components/plugins/shared'
import { useInstalledPlugins } from '@/components/plugins/sidebar-section'

/** Plugins, one click from the sidebar: admins browse and install; everyone sees what's installed. */
export default function PluginsPage() {
  const { org } = useOrgContext()
  const isAdmin = org.role === 'owner' || org.role === 'admin'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Plugins" icon={<Puzzle />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-8">
          {isAdmin ? (
            <PluginDirectory
              header={(actions) => (
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.02em]">
                      Add plugins to {org.name}
                    </h2>
                    <p className="mt-1 max-w-lg text-[13px] text-fg-muted">
                      Polls, reminders, standups, translation and more, as slash commands in your
                      channels. Plugins only see the channels you add them to.
                    </p>
                  </div>
                  <div className="flex gap-2">{actions}</div>
                </div>
              )}
            />
          ) : (
            <MemberView />
          )}
        </div>
      </div>
    </div>
  )
}

function MemberView() {
  const { plugins, isLoading } = useInstalledPlugins()
  if (isLoading) return null
  return (
    <>
      <h2 className="text-xl font-semibold tracking-[-0.02em]">Plugins in this workspace</h2>
      <p className="mt-1 mb-6 text-[13px] text-fg-muted">
        Use them by typing their commands in a channel they're added to. Owners and admins can add
        more.
      </p>
      {!plugins.length ? (
        <EmptyState
          emoji="🧩"
          title="No plugins here yet"
          description="Ask an owner or admin to add a few, like Polls or Reminders."
          action={
            <Button asChild variant="ghost">
              <Link href="/developers">
                <BookOpen /> Build your own
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {plugins.map((p) => (
            <li key={p.id} className="flex gap-4 rounded-xl border border-border p-4">
              <PluginIcon p={p} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{p.name}</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {p.commands.map((c) => (
                    <li key={c.command} className="text-[13px] text-fg-muted">
                      <code className="mr-2 rounded bg-bg-muted px-1.5 py-0.5 font-mono text-xs text-fg">
                        /{c.command}
                        {c.usage ? ` ${c.usage}` : ''}
                      </code>
                      {c.description}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
