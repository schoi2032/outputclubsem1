import { QuidWordmark } from '@quid/ui'
import Link from 'next/link'
import { LegalLinks } from '@/components/site-chrome'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-bg-subtle">
      <header className="flex h-16 items-center px-6">
        <Link href="/" aria-label="WickyChat home">
          <QuidWordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
      <footer className="flex flex-col items-center gap-3 px-6 pb-6 text-xs text-fg-subtle">
        <LegalLinks />
        <span>© {new Date().getFullYear()} WickyChat</span>
      </footer>
    </div>
  )
}
