export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-bg p-7 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[13px] text-fg-muted">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger"
    >
      {message}
    </div>
  )
}
