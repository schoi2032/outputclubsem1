'use client'
import { Gift } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { UpdateLog } from '@/components/update-log'
import { LATEST_UPDATE } from '@/lib/changelog'
import { setPreferences } from '@/lib/preferences'

export default function WhatsNewPage() {
  const { me } = useOrgContext()
  // Highlight what was new on arrival, then mark it all as seen.
  const [seen] = useState(me.preferences.lastSeenUpdate)
  useEffect(() => {
    if (me.preferences.lastSeenUpdate !== LATEST_UPDATE.id)
      setPreferences({ lastSeenUpdate: LATEST_UPDATE.id })
  }, [me.preferences.lastSeenUpdate])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="What’s new" icon={<Gift />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8 md:px-10">
          <p className="mb-8 text-[13px] text-fg-muted">
            Everything we’ve shipped lately, newest first.
          </p>
          <UpdateLog highlightAfter={seen} />
        </div>
      </div>
    </div>
  )
}
