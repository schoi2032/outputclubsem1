'use client'
import type { InvitationPreview, OrgSummary } from '@quid/shared'
import { ROLE_LABEL } from '@quid/shared'
import { Button, Skeleton } from '@quid/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { use, useState } from 'react'
import { AuthCard, FormError } from '@/components/auth-card'
import { GoogleButton } from '@/components/google-button'
import { errorMessage, get, post } from '@/lib/api'
import { useMe } from '@/lib/queries'

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const me = useMe()
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => get<InvitationPreview>(`/api/invitations/${token}`),
    retry: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (preview.isLoading || me.isLoading) {
    return (
      <AuthCard title="Loading invitation">
        <Skeleton className="h-5 w-3/4" />
      </AuthCard>
    )
  }
  if (preview.isError) {
    return (
      <AuthCard
        title="Invitation not found"
        subtitle="This link may be mistyped, revoked or replaced by a newer invitation. Ask your administrator to send a new one."
      >
        <Button asChild>
          <Link href="/">Go to WickyChat</Link>
        </Button>
      </AuthCard>
    )
  }
  const inv = preview.data!
  if (inv.expired || inv.accepted) {
    return (
      <AuthCard
        title={inv.accepted ? 'Invitation already used' : 'Invitation expired'}
        subtitle={
          inv.accepted
            ? `This invitation to ${inv.orgName} has already been accepted.`
            : `Ask someone at ${inv.orgName} to invite you again.`
        }
      >
        <Button asChild>
          <Link href="/">Go to WickyChat</Link>
        </Button>
      </AuthCard>
    )
  }

  const user = me.data?.user
  const wrongAccount = user && user.email.toLowerCase() !== inv.email.toLowerCase()
  return (
    <AuthCard
      title={`Join ${inv.orgName}`}
      subtitle={
        <>
          {inv.invitedByName ?? 'Someone'} invited{' '}
          <span className="font-medium text-fg">{inv.email}</span> to join as{' '}
          {ROLE_LABEL[inv.role].toLowerCase()}.
        </>
      }
    >
      <FormError message={error} />
      {!user ? (
        <div className="flex flex-col gap-2">
          <Button asChild variant="primary" size="lg">
            <Link href={`/register?invite=${token}&email=${encodeURIComponent(inv.email)}`}>
              Create account and join
            </Link>
          </Button>
          <Button asChild size="lg">
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
              I already have an account
            </Link>
          </Button>
          <GoogleButton next={`/invite/${token}`} />
        </div>
      ) : wrongAccount ? (
        <div className="flex flex-col gap-3 text-[13px] text-fg-muted">
          <p>
            You're signed in as <span className="font-medium text-fg">{user.email}</span>. Sign in
            with {inv.email} to accept this invitation.
          </p>
          <Button
            onClick={async () => {
              await post('/api/auth/logout')
              window.location.href = `/login?next=${encodeURIComponent(`/invite/${token}`)}`
            }}
          >
            Switch account
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              const r = await post<{ org: Pick<OrgSummary, 'slug'> }>(
                `/api/invitations/${token}/accept`,
              )
              window.location.href = `/${r.org.slug}`
            } catch (e) {
              setError(errorMessage(e))
              setBusy(false)
            }
          }}
        >
          Accept and join
        </Button>
      )}
    </AuthCard>
  )
}
