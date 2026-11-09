'use client'
import { Button, Spinner } from '@quid/ui'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { AuthCard } from '@/components/auth-card'
import { errorMessage, post } from '@/lib/api'

function Verify() {
  const token = useSearchParams().get('token')
  const [error, setError] = useState<string | null>(
    token ? null : 'This verification link is incomplete.',
  )
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    post('/api/auth/verify-email', { token })
      .then(() => {
        window.location.href = '/'
      })
      .catch((e) => setError(errorMessage(e)))
  }, [token])

  if (error) {
    return (
      <AuthCard title="We couldn't verify your email" subtitle={error}>
        <Button asChild variant="primary">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="Verifying your email">
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Spinner /> One moment…
      </div>
    </AuthCard>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  )
}
