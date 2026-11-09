'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useOrgContext } from '@/components/org-context'

export default function SettingsIndex() {
  const { base } = useOrgContext()
  const router = useRouter()
  useEffect(() => router.replace(`${base}/settings/profile`), [base, router])
  return null
}
