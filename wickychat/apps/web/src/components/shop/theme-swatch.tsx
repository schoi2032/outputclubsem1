import { cn } from '@quid/ui'

/** Reads a `--q-<name>` colour out of theme CSS (the first one set). */
function cssVar(css: string, name: string) {
  return new RegExp(`--q-${name}\\s*:\\s*([^;}]+)`).exec(css)?.[1]?.trim()
}

/** A tiny picture of the app in a theme's colours. */
export function ThemeSwatch({ css, className }: { css: string; className?: string }) {
  const v = (n: string, fb: string) => cssVar(css, n) ?? fb
  const bg = v('bg', '#ffffff')
  const rail = v('bg-rail', bg)
  const muted = v('bg-muted', '#f2eee8')
  const fg = v('fg', '#1c1917')
  const sub = v('fg-subtle', '#8f877e')
  const accent = v('accent', '#b8492f')
  return (
    <div
      aria-hidden="true"
      className={cn('flex h-24 w-full overflow-hidden rounded-lg border border-border', className)}
      style={{ background: bg }}
    >
      <div className="flex w-7 flex-col items-center gap-1.5 py-2" style={{ background: rail }}>
        <span className="size-3.5 rounded-md" style={{ background: accent }} />
        <span className="size-3.5 rounded-md" style={{ background: muted }} />
        <span className="size-3.5 rounded-md" style={{ background: muted }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5 text-left">
        <span className="h-2 w-3/5 rounded-full" style={{ background: fg }} />
        <span className="h-1.5 w-4/5 rounded-full" style={{ background: sub }} />
        <span className="h-1.5 w-2/3 rounded-full" style={{ background: sub }} />
        <span className="mt-auto h-4 rounded-md" style={{ background: muted }}>
          <span
            className="float-right m-0.5 block h-3 w-6 rounded"
            style={{ background: accent }}
          />
        </span>
      </div>
    </div>
  )
}
