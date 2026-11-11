'use client'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { forwardRef } from 'react'
import { cn } from './cn'
import { Spinner } from './spinner'

export const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,color,box-shadow,opacity,translate,scale] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:-translate-y-px hover:bg-accent-hover hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_4px_10px_-3px_color-mix(in_oklab,var(--q-accent)_55%,transparent)] active:translate-y-0',
        secondary:
          'border border-border bg-bg text-fg shadow-[0_1px_1px_rgb(0_0_0/0.03)] hover:-translate-y-px hover:border-border-strong hover:bg-bg-muted hover:shadow-[0_3px_8px_-3px_hsl(var(--q-shadow-color)/0.18)] active:translate-y-0',
        ghost: 'text-fg-muted hover:bg-bg-muted hover:text-fg',
        danger: 'bg-danger text-white hover:opacity-90',
        'danger-ghost': 'text-danger hover:bg-danger-subtle',
        link: 'h-auto px-0 text-accent-text underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-7 px-2.5 text-[13px]',
        md: 'h-8 px-3 text-sm',
        lg: 'h-10 px-4 text-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {/* Slot needs exactly one child, so asChild buttons don't render a spinner. */}
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Spinner className="size-3.5" /> : null}
            {children}
          </>
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string
    size?: 'sm' | 'md'
    active?: boolean
  }
>(({ className, label, size = 'md', active, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    title={label}
    className={cn(
      'inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted transition-[background-color,color,scale] duration-150 ease-out hover:bg-bg-muted hover:text-fg active:scale-90 disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
      size === 'sm' ? 'size-6 [&_svg]:size-3.5' : 'size-8 [&_svg]:size-4',
      active && 'bg-bg-emphasis text-fg',
      className,
    )}
    {...props}
  />
))
IconButton.displayName = 'IconButton'
