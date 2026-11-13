'use client'
import { type ItemKind, LIVE_STARTERS, MAX_LIVE_CODE } from '@quid/shared'
import { Switch } from '@quid/ui'
import { useEffect, useRef, useState } from 'react'
import { LiveFrame } from '@/components/profile/live-layer'
import { CssImageButton, insertAtCursor } from '@/components/shop/css-image'

const BOX: Partial<Record<ItemKind, string>> = {
  decoration: 'size-36 rounded-full',
  effect: 'h-40 w-full rounded-lg',
  theme: 'h-48 w-full rounded-lg',
  plate: 'h-12 w-full rounded-lg',
  name_effect: 'h-12 w-56 rounded-md',
  typing: 'h-8 w-56 rounded-md',
  reaction_skin: 'h-8 w-20 rounded-full',
}

export function LiveEditor({
  kind,
  value,
  onChange,
}: {
  kind: ItemKind
  value: string | null
  onChange: (v: string | null) => void
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState(value)

  useEffect(() => {
    setError(null)
    const t = setTimeout(() => setShown(value), 400)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const win = frame.current?.querySelector('iframe')?.contentWindow
      if (!win || e.source !== win) return
      const msg = (e.data as { wickyError?: unknown })?.wickyError
      if (typeof msg === 'string') setError(msg.slice(0, 300))
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [])

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-[13px]">
        <Switch
          id={`live-${kind}`}
          checked={value != null}
          onCheckedChange={(on) =>
            onChange(on ? (LIVE_STARTERS[kind] ?? LIVE_STARTERS.default!) : null)
          }
        />
        <label htmlFor={`live-${kind}`}>
          ⚡ Live code (HTML, CSS and JavaScript, anything you want)
        </label>
      </div>
      {value != null && (
        <>
          <div className="flex justify-end">
            <CssImageButton
              onAdd={(u) =>
                insertAtCursor(box, value, u.replace(/^url\("(.*)"\)$/, '$1'), (v) => onChange(v))
              }
            />
          </div>
          <textarea
            ref={box}
            aria-label="Live code"
            value={value}
            maxLength={MAX_LIVE_CODE}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            rows={Math.min(28, Math.max(10, value.split('\n').length + 1))}
            className="w-full rounded-lg border border-border bg-bg-subtle p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-accent"
          />
          <div className="flex flex-col items-center gap-1.5 rounded-lg bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3">
            <div
              ref={frame}
              className={`q-live-preview relative overflow-hidden border border-border ${BOX[kind] ?? 'h-16 w-64 rounded-xl'}`}
            >
              {shown && <LiveFrame key={shown} code={shown} kind={kind} />}
            </div>
            <p className="text-2xs text-fg-subtle">
              Live preview (it runs exactly like this for everyone)
            </p>
          </div>
          {error ? (
            <p className="text-xs text-danger">⚠️ Your script crashed: {error}</p>
          ) : (
            <p className="text-xs text-success">✓ Running</p>
          )}
          <p className="text-2xs text-fg-subtle">
            Its a full little web page that sits{' '}
            {kind === 'decoration' || kind === 'effect' || kind === 'message_effect'
              ? 'on top of'
              : 'behind'}{' '}
            your cosmetic. Use canvas, SVG, CSS animations, whatever. <code>wicky.dark</code> tells
            you if dark mode is on and <code>wicky.reducedMotion</code> if someone wants less motion
            (please respect it). Add image puts your own pictures in. It runs in a locked sandbox,
            so no internet, no clicking and nothing outside your cosmetic. A teacher checks it
            first.
          </p>
        </>
      )}
    </div>
  )
}
