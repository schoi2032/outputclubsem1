'use client'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

/** A code sample with a filename/language label and a copy button. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-[#0f1115] text-[#e6e7eb]">
      <div className="flex h-9 items-center justify-between border-b border-white/10 px-3.5 text-xs text-white/55">
        <span className="font-mono">{label}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {}
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}
