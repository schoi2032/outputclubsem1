'use client'
import { Button } from '@quid/ui'
import Link from 'next/link'
import { use, useEffect } from 'react'
import { ErrorScreen } from '@/components/error-screen'
import { OrgProvider } from '@/components/org-context'
import { AppShell } from '@/components/shell/app-shell'
import { useMe } from '@/lib/queries'

export default function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = use(params)
  const me = useMe()
  const org = me.data?.orgs.find((o) => o.slug === orgSlug)

  useEffect(() => {
    if (!org) return
    try {
      localStorage.setItem('quid-last-org', org.slug)
    } catch {}
  }, [org])

  if (!me.data) return null
  if (!org) {
    return (
      <ErrorScreen
        emoji="🧭"
        title="We couldn’t find that organization"
        description="It doesn't exist, or you're not a member. If someone invited you, use the link in your invitation email."
        action={
          <Button asChild variant="primary">
            <Link href="/">Go to my organizations</Link>
          </Button>
        }
      />
    )
  }
  if (org.requireGoogle && me.data.user.authMethod !== 'google') {
    return (
      <ErrorScreen
        title="Sign in with Google to continue"
        description={`${org.name} requires everyone to sign in with Google.`}
        action={
          <Button asChild variant="primary">
            <a href={`/api/auth/google/start?next=${encodeURIComponent(`/${org.slug}/home`)}`}>
              Continue with Google
            </a>
          </Button>
        }
      />
    )
  }
  return (
    <OrgProvider
      value={{
        org,
        me: me.data.user,
        orgs: me.data.orgs,
        base: `/${org.slug}`,
        api: `/api/orgs/${org.id}`,
      }}
    >
      <AppShell>{children}</AppShell>
    </OrgProvider>
  )
}
