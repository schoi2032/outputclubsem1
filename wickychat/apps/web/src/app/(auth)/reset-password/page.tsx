'use client'
import { Button, Field, Input } from '@quid/ui'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthCard, FormError } from '@/components/auth-card'
import { errorMessage, post } from '@/lib/api'

function Reset() {
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <AuthCard title="Choose a new password" subtitle="You'll be signed out of every other device.">
      <FormError message={error} />
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (password !== confirm) return setError("The passwords don't match.")
          setBusy(true)
          setError(null)
          try {
            await post('/api/auth/reset-password', { token, password })
            window.location.href = '/'
          } catch (err) {
            setError(errorMessage(err))
            setBusy(false)
          }
        }}
      >
        <Field label="New password" hint="At least 10 characters.">
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label="Confirm password">
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!token}>
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  )
}
