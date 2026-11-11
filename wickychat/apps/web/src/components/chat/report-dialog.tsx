'use client'
/** WickyChat: report a message to the teachers. */
import { type Message, REPORT_REASONS, type ReportReason } from '@quid/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Select,
  Textarea,
  toast,
} from '@quid/ui'
import { useState } from 'react'
import { errorMessage, post } from '@/lib/api'
import { useOrgContext } from '../org-context'

export const REASON_LABEL: Record<ReportReason, string> = {
  bullying: 'Bullying or being mean',
  swearing: 'Swearing',
  inappropriate: 'Inappropriate for school',
  spam: 'Spam',
  other: 'Something else',
}

export function ReportDialog({
  message,
  onClose,
}: {
  message: Message | null
  onClose: () => void
}) {
  const { api } = useOrgContext()
  const [reason, setReason] = useState<ReportReason>('bullying')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!message) return
    setBusy(true)
    try {
      await post(`${api}/messages/${message.id}/report`, { reason, note })
      toast.success('Reported. A teacher will take a look. Thanks for speaking up 💛')
      setNote('')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!message} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Report message"
        description="Only teachers see reports. The person won't know who reported them."
      >
        <blockquote className="line-clamp-4 rounded-md border border-border bg-bg-subtle p-3 text-[13px]">
          {message?.text || 'Attachment'}
        </blockquote>
        <Field label="What's wrong?">
          {(p) => (
            <Select
              {...p}
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
            >
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Anything else? (optional)">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={send}>
            Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
