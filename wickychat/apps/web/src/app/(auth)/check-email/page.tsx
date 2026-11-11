'use client'
import { Button } from '@quid/ui'
import { MailCheck } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthCard } from '@/components/auth-card'
import { post } from '@/lib/api'

function CheckEmail() {
  const email = useSearchParams().get('email') ?? ''
  const [sent, setSent] = useState(false)
  return (
    <AuthCard title="Check your email">
      <div className="flex flex-col items-start gap-4 text-[13px] text-fg-muted">
        <MailCheck className="size-8 text-accent" />
        <p>
          If <span className="font-medium text-fg">{email || 'that address'}</span> can be used for
          a new account, we sent a verification link to it. The link expires in 48 hours.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={sent || !email}
            onClick={async () => {
              await post('/api/auth/resend-verification', { email }).catch(() => {})
              setSent(true)
            }}
          >
            {sent ? 'Sent' : 'Resend link'}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    </AuthCard>
  )
}

export default function Page() {
  return (
    <Suspense>
      <CheckEmail />
    </Suspense>
  )
}
