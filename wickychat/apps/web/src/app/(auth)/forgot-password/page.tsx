'use client'
import { Button, Field, Input } from '@quid/ui'
import Link from 'next/link'
import { useState } from 'react'
import { AuthCard, FormError } from '@/components/auth-card'
import { errorMessage, post } from '@/lib/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (done) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If an account exists for ${email}, we sent a link to reset the password. It expires in one hour.`}
      >
        <Button asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </AuthCard>
    )
  }
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
    >
      <FormError message={error} />
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await post('/api/auth/forgot-password', { email })
            setDone(true)
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Email">
          {(p) => (
            <Input
              {...p}
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px]">
        <Link href="/login" className="text-fg-muted hover:text-fg">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  )
}
