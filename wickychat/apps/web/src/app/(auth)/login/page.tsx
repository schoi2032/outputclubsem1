'use client'
import { Button, Field, Input } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthCard, FormError } from '@/components/auth-card'
import { GoogleButton, useAuthProviders } from '@/components/google-button'
import { ApiError, post } from '@/lib/api'
import { keys } from '@/lib/queries'

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_expired: 'That sign-in attempt expired. Please try again.',
  google_failed: "We couldn't sign you in with Google. Please try again.",
  google_unverified: "Your Google account's email address isn't verified.",
  school_only:
    'WickyChat is only for @chadwickschool.org accounts. Sign in with your school Google account.',
  google_unavailable: "Google sign-in isn't set up on this server.",
  invite_only: 'This WickyChat is invitation only. Ask your admin for an invitation first.',
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    () => GOOGLE_ERRORS[params.get('error') ?? ''] ?? null,
  )
  const providers = useAuthProviders()
  const [unverified, setUnverified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)
  const next = params.get('next')
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setUnverified(false)
    try {
      const me = await post('/api/auth/login', { email, password })
      qc.setQueryData(keys.me, me)
      router.replace(safeNext)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_unverified') setUnverified(true)
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  return (
    <AuthCard title="Sign in to WickyChat" subtitle="Welcome back. Use your work email.">
      <FormError message={error} />
      {unverified && (
        <p className="-mt-2 mb-4 text-[13px] text-fg-muted">
          {resent ? (
            'We sent a new verification link.'
          ) : (
            <button
              type="button"
              className="font-medium text-accent-text hover:underline"
              onClick={async () => {
                await post('/api/auth/resend-verification', { email }).catch(() => {})
                setResent(true)
              }}
            >
              Resend verification email
            </button>
          )}
        </p>
      )}
      {providers.data?.google && (
        <>
          <GoogleButton next={safeNext} />
          <div className="my-5 flex items-center gap-3 text-xs text-fg-subtle">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={
            <span className="flex justify-between">
              Password
              <Link href="/forgot-password" className="font-normal text-fg-muted hover:text-fg">
                Forgot?
              </Link>
            </span>
          }
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-fg-muted">
        New to WickyChat?{' '}
        <Link href="/register" className="font-medium text-fg hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
