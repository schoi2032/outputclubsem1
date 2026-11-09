'use client'
import { Spinner } from '@quid/ui'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useMe } from '@/lib/queries'

export default function Home() {
  const me = useMe()
  const router = useRouter()
  useEffect(() => {
    if (!me.data) return
    let last: string | null = null
    try {
      last = localStorage.getItem('quid-last-org')
    } catch {}
    const target = me.data.orgs.find((o) => o.slug === last) ?? me.data.orgs[0]
    router.replace(target ? `/${target.slug}/home` : '/new')
  }, [me.data, router])
  return (
    <div className="flex h-full items-center justify-center text-fg-subtle">
      <Spinner className="size-5" />
    </div>
  )
}
