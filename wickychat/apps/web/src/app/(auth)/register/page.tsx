'use client'
import { Button, Field, Input } from '@quid/ui'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthCard, FormError } from '@/components/auth-card'
import { GoogleButton, useAuthProviders } from '@/components/google-button'
import { ApiError, post } from '@/lib/api'

function RegisterForm() {
  const router = useRouter()
  const params = useSearchParams()
  const invite = params.get('invite')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const providers = useAuthProviders()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await post<{ status: 'signed_in' | 'verification_sent' }>('/api/auth/register', {
        name,
        email,
        password,
        acceptTerms: agreed,
        ...(invite && { inviteToken: invite }),
      })
      if (r.status === 'signed_in') window.location.href = '/'
      else router.push(`/check-email?email=${encodeURIComponent(email)}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed.')
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle={
        invite
          ? 'Finish signing up to join your team.'
          : 'WickyChat is for Chadwick International. Use your @chadwickschool.org account.'
      }
    >
      <FormError message={error} />
      {providers.data?.google && (
        <>
          <GoogleButton label="Sign up with Google" next={invite ? `/invite/${invite}` : '/'} />
          <div className="my-5 flex items-center gap-3 text-xs text-fg-subtle">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Full name">
          {(p) => (
            <Input
              {...p}
              autoComplete="name"
              required
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="School email" hint="Must end in @chadwickschool.org.">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              required
              placeholder="you@chadwickschool.org"
              pattern="^[^@\s]+@[Cc][Hh][Aa][Dd][Ww][Ii][Cc][Kk][Ss][Cc][Hh][Oo][Oo][Ll]\.[Oo][Rr][Gg]$"
              title="Use your @chadwickschool.org school email"
              value={email}
              readOnly={!!invite && !!params.get('email')}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <label className="flex items-start gap-2.5 text-[13px] text-fg-muted">
          <input
            type="checkbox"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--q-accent)]"
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="font-medium text-fg underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="font-medium text-fg underline">
              Privacy rules
            </Link>
            .
          </span>
        </label>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!agreed}
          className="mt-1"
        >
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-fg-muted">
        Already have an account?{' '}
        <Link
          href={invite ? `/invite/${invite}` : '/login'}
          className="font-medium text-fg hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthCard>
  )
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}
