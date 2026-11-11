'use client'
import { Button } from '@quid/ui'
import Link from 'next/link'
import { useEffect } from 'react'
import { ErrorScreen } from '@/components/error-screen'

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="h-dvh">
      <ErrorScreen
        emoji="🙈"
        title="Oops, something broke"
        description="That’s on us, not you. Give it another try, and if it keeps happening, let us know."
        onRetry={retry}
        action={
          <Button asChild variant="ghost">
            <Link href="/">Take me home</Link>
          </Button>
        }
      />
    </main>
  )
}
