import { Button, Mascot, Sparkles } from '@quid/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ErrorScreen } from '@/components/error-screen'

export const metadata: Metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <main className="h-dvh">
      <ErrorScreen
        illustration={
          <span className="relative px-8 py-3">
            <Sparkles />
            <Mascot kind="bubble" mood="wow" float className="relative size-24" />
          </span>
        }
        title="Well, this is awkward"
        description="We looked everywhere, but this page doesn’t exist. It may have moved, or the link has a typo."
        action={
          <Button asChild variant="primary">
            <Link href="/">Take me home</Link>
          </Button>
        }
      />
    </main>
  )
}
