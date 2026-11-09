'use client'
import { Avatar } from '@quid/ui'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOrgContext } from '../org-context'

const NEW_FOR_MS = 30 * 86_400_000
const key = (orgId: string) => `quid-welcome-dismissed:${orgId}`

/** The org's welcome note, with links clickable. Plain text otherwise. */
export function WelcomeText({ text }: { text: string }) {
  return (
    <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-fg-muted">
      {text.split(/(https?:\/\/[^\s<>"')\]]+)/g).map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent-text underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  )
}

export function WelcomeCard({
  name,
  logoUrl,
  orgId,
  message,
  onDismiss,
}: {
  name: string
  logoUrl: string | null
  orgId: string
  message: string
  onDismiss?: () => void
}) {
  return (
    <section className="relative rounded-2xl border border-accent/25 bg-bg p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="mb-2 flex items-center gap-2.5">
        <Avatar name={name} id={orgId} src={logoUrl} size="md" />
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Welcome to {name} 👋</h3>
      </div>
      <WelcomeText text={message} />
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss welcome message"
          onClick={onDismiss}
          className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
      )}
    </section>
  )
}

/** Shown on Home to people who joined in the last 30 days, until they dismiss it. */
export function HomeWelcome() {
  const { org } = useOrgContext()
  const message = org.customization.welcomeMessage
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(key(org.id)) === '1'
    } catch {}
    const isNew = !!org.joinedAt && Date.now() - Date.parse(org.joinedAt) < NEW_FOR_MS
    setHidden(dismissed || !isNew)
  }, [org.id, org.joinedAt])
  if (!message || hidden) return null
  return (
    <div className="mt-5">
      <WelcomeCard
        name={org.name}
        logoUrl={org.logoUrl}
        orgId={org.id}
        message={message}
        onDismiss={() => {
          setHidden(true)
          try {
            localStorage.setItem(key(org.id), '1')
          } catch {}
        }}
      />
    </div>
  )
}
