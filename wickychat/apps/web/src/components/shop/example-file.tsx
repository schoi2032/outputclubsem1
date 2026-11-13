'use client'
import { Button, toast } from '@quid/ui'
import { Download, Sparkles } from 'lucide-react'
import { useState } from 'react'

export async function exampleFile(name: string) {
  const r = await fetch(`/examples/${name}`)
  if (!r.ok) throw new Error('Could not load the example')
  const b = await r.blob()
  return new File([b], name, { type: b.type })
}

export function ExampleBox({
  title,
  tips,
  files,
  onTry,
}: {
  title: string
  tips: string[]
  files: { name: string; label: string }[]
  onTry: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="rounded-lg border border-dashed border-[#8052ff]/50 bg-[#8052ff]/5 p-3 text-[13px]">
      <p className="font-semibold">💡 {title}</p>
      <ul className="mt-1 list-disc pl-5 text-xs text-fg-muted">
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onTry()
              toast.success('Example loaded. Check the preview!')
            } catch {
              toast.error("Couldn't load the example. Try again?")
            } finally {
              setBusy(false)
            }
          }}
        >
          <Sparkles /> Try the example
        </Button>
        {files.map((f) => (
          <a
            key={f.name}
            href={`/examples/${f.name}`}
            download={f.name}
            className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
          >
            <Download className="size-3.5" /> {f.label}
          </a>
        ))}
      </div>
    </div>
  )
}

export const EXAMPLE_THEME = (
  image: string,
) => `/* Example theme: Galaxy Glass. A background picture with see-through panels.
   Change the colours, or press Add image to use your own picture instead. */
:root[data-wtheme],
:root.dark[data-wtheme] {
  --q-bg: rgb(20 15 46 / 0.6);
  --q-bg-subtle: rgb(28 20 60 / 0.65);
  --q-bg-rail: rgb(12 8 30 / 0.7);
  --q-bg-muted: rgb(60 45 110 / 0.55);
  --q-bg-emphasis: rgb(80 60 140 / 0.6);
  --q-bg-overlay: #1c1640;
  --q-border: rgb(255 255 255 / 0.12);
  --q-border-strong: rgb(255 255 255 / 0.22);
  --q-fg: #f3efff;
  --q-fg-muted: #cfc6f2;
  --q-fg-subtle: #a59bd0;
  --q-accent: #ff5cc8;
  --q-accent-hover: #ff7ad3;
  --q-accent-subtle: rgb(255 92 200 / 0.18);
  --q-accent-fg: #ffffff;
  --q-accent-text: #ff8fd8;
  --q-danger: #ff6b8b;
  --q-success: #5eead4;
  --q-warning: #fde68a;
  --q-mention-bg: rgb(255 92 200 / 0.16);
  --q-mention-border: #ff5cc8;
  color-scheme: dark;
}

/* The picture behind everything */
:root[data-wtheme] body {
  background: ${image} center / cover fixed;
}
`
