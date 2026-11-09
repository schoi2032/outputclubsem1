'use client'
import { Button, QuidWordmark } from '@quid/ui'

/** WickyChat has one organization. Anyone landing here isn't a member of it (yet). */
export default function NewOrgPage() {
  return (
    <div className="flex min-h-full flex-col bg-bg-subtle">
      <header className="flex h-16 items-center px-6">
        <QuidWordmark />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-[12vh]">
        <div className="w-full max-w-[440px] text-center">
          <h1 className="text-2xl font-semibold tracking-[-0.025em]">
            You're not in Chadwick International yet
          </h1>
          <p className="mt-3 text-[13px] text-fg-muted">
            WickyChat has one organization, Chadwick International, and only @chadwickschool.org
            accounts can join. If you just verified your email, sign in again. If an admin
            deactivated your account, ask them to turn it back on.
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild variant="primary">
              <a href="/login">Sign in again</a>
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
