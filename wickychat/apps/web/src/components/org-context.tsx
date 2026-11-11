'use client'
import type { Me, OrgSummary } from '@quid/shared'
import { createContext, useContext } from 'react'

export interface OrgContextValue {
  org: OrgSummary
  me: Me
  orgs: OrgSummary[]
  base: string
  api: string
}

const Ctx = createContext<OrgContextValue | null>(null)
export const OrgProvider = Ctx.Provider

export function useOrgContext() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useOrgContext must be used inside an organization')
  return v
}
