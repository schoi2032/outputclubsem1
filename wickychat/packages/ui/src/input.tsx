'use client'
import { forwardRef, useId } from 'react'
import { cn } from './cn'

const field =
  'w-full rounded-md border border-border bg-bg px-2.5 text-sm text-fg placeholder:text-fg-subtle shadow-[0_1px_1px_rgb(0_0_0/0.02)] transition-[border-color,box-shadow] outline-none focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/15'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(field, 'h-9', className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, 'min-h-20 py-2', className)} {...props} />
))
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        field,
        'h-9 appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 fill=%22none%22 stroke=%22%238a8a94%22 stroke-width=%221.5%22><path d=%22M3 4.5l3 3 3-3%22/></svg>")] bg-[position:right_10px_center] bg-no-repeat pr-8',
        className,
      )}
      {...props}
    />
  ),
)
Select.displayName = 'Select'

/** Label + control + hint/error, wired up for accessibility. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: string | null
  children: (props: {
    id: string
    'aria-invalid'?: true
    'aria-describedby'?: string
  }) => React.ReactNode
  className?: string
}) {
  const id = useId()
  const descId = `${id}-desc`
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children({
        id,
        ...(error && { 'aria-invalid': true }),
        ...((hint || error) && { 'aria-describedby': descId }),
      })}
      {(error || hint) && (
        <p id={descId} className={cn('text-xs', error ? 'text-danger' : 'text-fg-subtle')}>
          {error || hint}
        </p>
      )}
    </div>
  )
}
