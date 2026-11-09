import { QuidMark, QuidWordmark } from '@quid/ui'
import Link from 'next/link'

export const CONTACT_EMAIL = 'teum2032@chadwickschool.org'
export const OPERATOR = 'Output Club'
export const OPERATOR_COUNTRY = 'Chadwick International'

/** Header for public pages (rules, privacy, changelog). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="WickyChat home">
          <QuidWordmark />
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link
            href="/login"
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg hover:bg-accent-hover"
          >
            Log in
          </Link>
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs text-fg-subtle sm:flex-row sm:items-center sm:px-6">
        <span className="flex items-center gap-3">
          <QuidMark className="size-5" title="" />
          WickyChat, made by {OPERATOR} at {OPERATOR_COUNTRY}
        </span>
        <LegalLinks className="sm:ml-auto" />
      </div>
    </footer>
  )
}

/** Typography for policy pages. */
export function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-2 text-sm text-fg-subtle">Last updated {updated}</p>
      <div className="mt-8 flex flex-col gap-4 text-[14.5px] leading-relaxed text-fg-muted [&_a]:text-accent-text [&_a]:underline [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </article>
  )
}

/** Rules, privacy and contact. Shown at the bottom of every public page. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Legal"
      className={`flex flex-wrap justify-center gap-x-4 gap-y-2 ${className ?? ''}`}
    >
      <Link href="/terms" className="hover:text-fg">
        Rules
      </Link>
      <Link href="/privacy" className="hover:text-fg">
        Privacy
      </Link>
      <Link href="/changelog" className="hover:text-fg">
        Changelog
      </Link>
      <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-fg">
        Contact Output Club
      </a>
    </nav>
  )
}
