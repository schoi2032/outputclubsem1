'use client'
import { X } from 'lucide-react'
import { Dialog as D, DropdownMenu as M, Popover as P, Slot, Tooltip as T } from 'radix-ui'
import { forwardRef } from 'react'
import { cn } from './cn'

// --- Dialog -------------------------------------------------------------------

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  wide?: boolean
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 animate-overlay bg-black/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          'fixed top-[12vh] left-1/2 z-50 flex max-h-[76vh] w-[calc(100vw-2rem)] -translate-x-1/2 animate-in flex-col rounded-xl border border-border bg-bg-overlay shadow-dialog outline-none',
          wide ? 'max-w-2xl' : 'max-w-md',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
          <div>
            <D.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-[13px] text-fg-muted">
                {description}
              </D.Description>
            ) : (
              <D.Description className="sr-only">
                {typeof title === 'string' ? title : 'Dialog'}
              </D.Description>
            )}
          </div>
          <D.Close
            className="-mr-1.5 rounded-md p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pt-2 pb-5">{children}</div>
      </D.Content>
    </D.Portal>
  )
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex justify-end gap-2">{children}</div>
}

// --- Menu ---------------------------------------------------------------------

export const Menu = M.Root
export const MenuTrigger = M.Trigger
export const MenuSub = M.Sub

const menuPanel =
  'z-50 min-w-48 animate-in rounded-lg border border-border bg-bg-overlay p-1 text-[13px] shadow-pop outline-none'

export const MenuContent = forwardRef<HTMLDivElement, M.DropdownMenuContentProps>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <M.Portal>
      <M.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(menuPanel, className)}
        {...props}
      />
    </M.Portal>
  ),
)
MenuContent.displayName = 'MenuContent'

export const MenuItem = forwardRef<
  HTMLDivElement,
  M.DropdownMenuItemProps & { danger?: boolean; icon?: React.ReactNode; shortcut?: string }
>(({ className, danger, icon, shortcut, children, asChild, ...props }, ref) => (
  <M.Item
    ref={ref}
    asChild={asChild}
    className={cn(
      'flex h-8 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-bg-muted [&_svg]:size-4 [&_svg]:text-fg-subtle',
      danger && 'text-danger data-[highlighted]:bg-danger-subtle [&_svg]:text-danger',
      className,
    )}
    {...props}
  >
    {icon}
    {/* With asChild (e.g. a link), Slottable makes the child the item element and
        places the icon and shortcut inside it; Slot accepts only one direct child otherwise. */}
    {asChild ? (
      <Slot.Slottable>{children}</Slot.Slottable>
    ) : (
      <span className="flex-1 truncate">{children}</span>
    )}
    {shortcut && <span className="ml-auto text-xs text-fg-subtle">{shortcut}</span>}
  </M.Item>
))
MenuItem.displayName = 'MenuItem'

export const MenuSubTrigger = forwardRef<
  HTMLDivElement,
  M.DropdownMenuSubTriggerProps & { icon?: React.ReactNode }
>(({ className, icon, children, ...props }, ref) => (
  <M.SubTrigger
    ref={ref}
    className={cn(
      'flex h-8 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none data-[highlighted]:bg-bg-muted data-[state=open]:bg-bg-muted [&_svg]:size-4 [&_svg]:text-fg-subtle',
      className,
    )}
    {...props}
  >
    {icon}
    <span className="flex-1">{children}</span>
    <span aria-hidden className="text-fg-subtle">
      ›
    </span>
  </M.SubTrigger>
))
MenuSubTrigger.displayName = 'MenuSubTrigger'

export function MenuSubContent(props: M.DropdownMenuSubContentProps) {
  return (
    <M.Portal>
      <M.SubContent {...props} className={cn(menuPanel, props.className)} sideOffset={6} />
    </M.Portal>
  )
}

export function MenuSeparator() {
  return <M.Separator className="-mx-1 my-1 h-px bg-border" />
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <M.Label className="px-2 pt-1.5 pb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
      {children}
    </M.Label>
  )
}

// --- Popover ------------------------------------------------------------------

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverAnchor = P.Anchor
export const PopoverClose = P.Close

export const PopoverContent = forwardRef<HTMLDivElement, P.PopoverContentProps>(
  ({ className, sideOffset = 6, ...props }, ref) => (
    <P.Portal>
      <P.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 animate-in rounded-lg border border-border bg-bg-overlay shadow-pop outline-none',
          className,
        )}
        {...props}
      />
    </P.Portal>
  ),
)
PopoverContent.displayName = 'PopoverContent'

// --- Tooltip ------------------------------------------------------------------

export const TooltipProvider = T.Provider

export function Tooltip({
  content,
  children,
  side = 'top',
  shortcut,
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  shortcut?: string
}) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex animate-in items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-pop"
        >
          {content}
          {shortcut && <span className="opacity-60">{shortcut}</span>}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
