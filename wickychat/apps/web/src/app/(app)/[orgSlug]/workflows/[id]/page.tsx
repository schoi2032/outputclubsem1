'use client'
import { EmptyState, Skeleton } from '@quid/ui'
import { Zap } from 'lucide-react'
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { WorkflowBuilder } from '@/components/productivity/workflow-builder'
import { useWorkflows } from '@/lib/productivity'

export default function EditWorkflowPage() {
  const { id } = useParams<{ id: string }>()
  const q = useWorkflows()
  const w = q.data?.find((x) => x.id === id)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={w ? `Edit: ${w.name}` : 'Workflow'} icon={<Zap />} />
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg-subtle">
        {q.isLoading ? (
          <Skeleton className="m-8 h-96" />
        ) : !w?.canEdit ? (
          <EmptyState
            emoji="🤷"
            title="This workflow isn’t here"
            description="It may have been deleted, or only its creator can edit it."
          />
        ) : (
          <WorkflowBuilder
            initial={{
              name: w.name,
              description: w.description,
              emoji: w.emoji,
              enabled: w.enabled,
              trigger: w.trigger,
              form: w.form,
              steps: w.steps,
            }}
            existing={w}
          />
        )}
      </div>
    </div>
  )
}
