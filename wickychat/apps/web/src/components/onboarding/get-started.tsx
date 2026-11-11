'use client'
import { cn } from '@quid/ui'
import { Check, ChevronRight, Hash, Puzzle, Sparkles, Video, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useChannels } from '@/lib/queries'
import { useOrgContext } from '../org-context'
import { useInstalledPlugins } from '../plugins/sidebar-section'
import { tourDone } from './tour'

type Step = {
  id: string
  label: string
  detail: string
  icon: React.ReactNode
  done: boolean
  href?: string
  onClick?: () => void
}

/** A short checklist on Home for new workspaces; hides itself when done or dismissed. */
export function GetStarted({ hadMeeting }: { hadMeeting: boolean }) {
  const { org, me, base } = useOrgContext()
  const channels = useChannels(org.id)
  const { plugins, isSuccess: pluginsLoaded } = useInstalledPlugins()
  const isAdmin = org.role === 'owner' || org.role === 'admin'
  const key = `quid-get-started:${org.id}:${me.id}`
  const [hidden, setHidden] = useState(true)
  const [toured, setToured] = useState(true)

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(key) === '1')
    } catch {
      setHidden(false)
    }
    const check = () => setToured(tourDone(me.id))
    check()
    const t = setInterval(check, 2000)
    return () => clearInterval(t)
  }, [key, me.id])

  if (org.role === 'guest' || hidden || !channels.data || !pluginsLoaded) return null
  const joined = channels.data.filter(
    (c) => (c.kind === 'public' || c.kind === 'private') && c.membership,
  ).length
  const steps: Step[] = [
    {
      id: 'tour',
      label: 'Take the 1-minute tour',
      detail: 'A quick spin around the place.',
      icon: <Sparkles />,
      done: toured,
      onClick: () => window.dispatchEvent(new Event('quid:tour')),
    },
    {
      id: 'channels',
      label: 'Join a few channels',
      detail: 'Find your people and your topics.',
      icon: <Hash />,
      done: joined > 1,
      href: `${base}/browse`,
    },
    {
      id: 'plugins',
      label: isAdmin ? 'Add a plugin' : 'Try a plugin',
      detail: 'Polls, reminders, standups and more.',
      icon: <Puzzle />,
      done: plugins.length > 0,
      href: `${base}/plugins`,
    },
    {
      id: 'meet',
      label: 'Start a meeting',
      detail: 'Face time, right in the browser.',
      icon: <Video />,
      done: hadMeeting,
      href: `${base}/meet`,
    },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null

  const dismiss = () => {
    try {
      localStorage.setItem(key, '1')
    } catch {}
    setHidden(true)
  }

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border bg-bg">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">
            Let’s get you settled in{' '}
            <span aria-hidden="true" className="inline-block">
              🌱
            </span>
          </p>
          <p className="text-xs text-fg-subtle">
            {done} of {steps.length} done{done > 0 ? ', nice going!' : ''}
          </p>
        </div>
        <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-bg-muted sm:block">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide getting started"
          className="rounded-md p-1 text-fg-subtle transition-colors duration-150 hover:bg-bg-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </header>
      <ul className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
        {steps.map((s) => {
          const inner = (
            <>
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 ease-out group-hover:scale-110 [&>svg]:size-4',
                  s.done ? 'bg-success/15 text-success' : 'bg-accent-subtle text-accent-text',
                )}
              >
                {s.done ? <Check /> : s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-[13px] font-medium',
                    s.done && 'text-fg-subtle line-through',
                  )}
                >
                  {s.label}
                </span>
                <span className="block truncate text-xs text-fg-subtle">{s.detail}</span>
              </span>
              {!s.done && (
                <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform duration-150 group-hover:translate-x-0.5" />
              )}
            </>
          )
          const cls =
            'group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-bg-subtle'
          return (
            <li key={s.id}>
              {s.href ? (
                <Link href={s.href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button type="button" onClick={s.onClick} className={cls}>
                  {inner}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
