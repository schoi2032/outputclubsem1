'use client'
/** WickyChat: pick how many to buy: ×1 ×5 ×10 ×20 ×100 or a custom number. */
import { cn, Input } from '@quid/ui'
import { useState } from 'react'

export const QTY_PRESETS = [1, 5, 10, 20, 100]

export function QtyPicker({
  value,
  onChange,
  max = 100,
  label = 'How many',
}: {
  value: number
  onChange: (n: number) => void
  max?: number
  label?: string
}) {
  const [custom, setCustom] = useState(!QTY_PRESETS.includes(value))
  const clamp = (n: number) => Math.max(1, Math.min(max, Math.floor(n) || 1))
  const chip = (on: boolean) =>
    cn(
      'rounded-md px-2 py-1 text-xs font-semibold tabular-nums transition-colors',
      on ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
    )
  return (
    <fieldset className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border p-0.5">
      <legend className="sr-only">{label}</legend>
      {QTY_PRESETS.filter((n) => n <= max).map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={!custom && value === n}
          className={chip(!custom && value === n)}
          onClick={() => {
            setCustom(false)
            onChange(n)
          }}
        >
          ×{n}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={custom}
        className={chip(custom)}
        onClick={() => setCustom(true)}
      >
        Custom
      </button>
      {custom && (
        <Input
          type="number"
          aria-label="Custom amount"
          min={1}
          max={max}
          value={value}
          autoFocus
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="h-7 w-20 text-xs"
        />
      )}
    </fieldset>
  )
}
