'use client'
import { type Presence, STATUS_DURATIONS, type StatusPreset } from '@quid/shared'
import { Button, Dialog, DialogContent, DialogFooter, Input, Select } from '@quid/ui'
import { useEffect, useState } from 'react'
import { useOrgContext } from '../org-context'

const PRESETS: StatusPreset[] = [
  { emoji: '📅', text: 'In a meeting', hours: 1 },
  { emoji: '🚌', text: 'Commuting', hours: 0.5 },
  { emoji: '🤒', text: 'Out sick', hours: 24 },
  { emoji: '🌴', text: 'On vacation', hours: 0 },
  { emoji: '🏠', text: 'Working remotely', hours: 8 },
  { emoji: '🎯', text: 'Focusing', hours: 2 },
]

function expiry(hours: number): string | null {
  if (hours === 0) return null
  const d = new Date()
  if (hours === -1) d.setHours(23, 59, 0, 0)
  else if (hours === -7) {
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
    d.setHours(23, 59, 0, 0)
  } else d.setTime(d.getTime() + hours * 3600_000)
  return d.toISOString()
}

export function StatusDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  current?: Presence
  onSave: (body: Record<string, unknown>) => Promise<void>
}) {
  const [emoji, setEmoji] = useState('💬')
  const [text, setText] = useState('')
  const [hours, setHours] = useState(0)
  const [busy, setBusy] = useState(false)
  const { org } = useOrgContext()
  const { statusPresets, replaceDefaultStatuses } = org.customization
  const groups = [
    ...(statusPresets.length ? [{ name: org.name, presets: statusPresets }] : []),
    ...(replaceDefaultStatuses && statusPresets.length
      ? []
      : [{ name: statusPresets.length ? 'Suggestions' : '', presets: PRESETS }]),
  ]

  useEffect(() => {
    if (!open) return
    setEmoji(current?.statusEmoji || '💬')
    setText(current?.statusText ?? '')
    setHours(0)
  }, [open, current])

  const save = async (body: Record<string, unknown>) => {
    setBusy(true)
    await onSave(body)
    setBusy(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Set a status"
        description="Your status is visible to everyone in your organizations."
      >
        <div className="flex gap-2">
          <Input
            aria-label="Emoji"
            className="w-12 text-center"
            maxLength={8}
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
          />
          <Input
            aria-label="Status"
            placeholder="What's your status?"
            maxLength={100}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-col">
          {groups.map((g) => [
            g.name && (
              <p
                key={`h-${g.name}`}
                className="truncate px-2 pt-2 pb-1 text-2xs font-medium text-fg-subtle uppercase first:pt-0"
              >
                {g.name}
              </p>
            ),
            ...g.presets.map((p) => (
              <button
                key={`${g.name}-${p.text}`}
                type="button"
                className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-bg-muted"
                onClick={() => {
                  setEmoji(p.emoji)
                  setText(p.text)
                  setHours(p.hours)
                }}
              >
                <span>{p.emoji}</span>
                {p.text}
              </button>
            )),
          ])}
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 text-[13px]">
          Clear after
          <Select
            aria-label="Clear status after"
            className="w-40"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            {STATUS_DURATIONS.map((d) => (
              <option key={d.label} value={d.hours}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
        <DialogFooter>
          {current?.statusText && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => save({ statusText: '', statusEmoji: '', statusExpiresAt: null })}
            >
              Clear status
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!text.trim()}
            onClick={() =>
              save({
                statusText: text.trim(),
                statusEmoji: emoji.trim(),
                statusExpiresAt: expiry(hours),
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
