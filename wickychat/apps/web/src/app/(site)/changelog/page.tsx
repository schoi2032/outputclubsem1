import type { Metadata } from 'next'
import { UpdateLog } from '@/components/update-log'

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'What’s new in WickyChat: every feature and improvement, newest first.',
}

export default function ChangelogPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-[-0.03em]">What’s new in WickyChat</h1>
      <p className="mt-2 mb-10 text-sm text-fg-subtle">
        Every feature and improvement, newest first.
      </p>
      <div className="pl-4">
        <UpdateLog />
      </div>
    </article>
  )
}
