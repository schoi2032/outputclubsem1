export function SettingsTitle({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.015em]">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-fg-muted">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

export function SettingsCard({
  title,
  description,
  children,
  danger,
}: {
  title: string
  description?: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <section
      className={`mb-6 rounded-xl border ${danger ? 'border-danger/30' : 'border-border'} p-5`}
    >
      <h3 className={`text-[14px] font-semibold ${danger ? 'text-danger' : ''}`}>{title}</h3>
      {description && <p className="mt-1 text-[13px] text-fg-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}
