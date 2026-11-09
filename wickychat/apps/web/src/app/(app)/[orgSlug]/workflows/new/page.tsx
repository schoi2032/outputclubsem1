'use client'
import { Skeleton } from '@quid/ui'
import { Zap } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useOrgContext } from '@/components/org-context'
import { PageHeader } from '@/components/page-header'
import { templates, WorkflowBuilder } from '@/components/productivity/workflow-builder'
import { useChannels } from '@/lib/queries'

function NewWorkflow() {
  const { org, me } = useOrgContext()
  const params = useSearchParams()
  const channels = useChannels(org.id)
  if (!channels.data) return <Skeleton className="m-8 h-96" />
  const mine = channels.data.filter(
    (c) => (c.kind === 'public' || c.kind === 'private') && c.membership && !c.archivedAt,
  )
  const channelId = (mine.find((c) => c.id === params.get('channel')) ?? mine[0])?.id ?? ''
  const tpl = templates(channelId, me.id).find((t) => t.key === params.get('template'))
  const initial = tpl?.value ?? {
    name: '',
    description: '',
    emoji: '⚡',
    enabled: true,
    trigger: { type: 'shortcut' as const, channelId },
    form: [],
    steps: [{ id: 'first', type: 'message' as const, channelId, text: '' }],
  }
  return <WorkflowBuilder initial={initial} />
}

export default function NewWorkflowPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="New workflow" icon={<Zap />} />
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg-subtle">
        <Suspense>
          <NewWorkflow />
        </Suspense>
      </div>
    </div>
  )
}
