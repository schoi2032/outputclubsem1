'use client'
import { specFromValue, type UserSummary } from '@quid/shared'
import { cn } from '@quid/ui'
import { displayName } from '@/lib/format'
import { nameEffectProps } from './flair'

const HEX = /^#[0-9a-fA-F]{6}$/

/** Classes and inline style for someone's chosen name font and colour(s). */
export function nameStyleProps(style: UserSummary['nameStyle'], className?: string) {
  const font = style?.font && style.font !== 'default' ? `q-font-${style.font}` : ''
  const colors = (style?.colors ?? []).filter((c) => HEX.test(c))
  if (colors.length >= 2)
    return {
      className: cn(font, 'q-name-gradient', className),
      style: { '--q-n1': colors[0], '--q-n2': colors[1] } as React.CSSProperties,
    }
  return {
    className: cn(font, className),
    style: colors[0] ? { color: colors[0] } : undefined,
  }
}

/** A person's display name in their chosen font and colour. */
export function StyledName({ user, className }: { user: UserSummary; className?: string }) {
  const fx = nameEffectProps(specFromValue('name_effect', user.nameEffect))
  if (fx) {
    const f = user.nameStyle?.font
    return (
      <span
        className={cn(f && f !== 'default' && `q-font-${f}`, fx.className, className)}
        style={fx.style}
      >
        {displayName(user)}
      </span>
    )
  }
  return <span {...nameStyleProps(user.nameStyle, className)}>{displayName(user)}</span>
}
