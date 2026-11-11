'use client'
/** WickyChat: teachers put someone in a timeout (they can read but can't post). */
import { Button, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Timer } from 'lucide-react'
import { useOrgContext } from '@/components/org-context'
import { errorMessage, post } from '@/lib/api'

const CHOICES = [
  { minutes: 10, label: '10 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 60 * 24, label: '1 day' },
  { minutes: 60 * 24 * 7, label: '1 week' },
]

export function TimeoutMenu({
  userId,
  name,
  timedOut,
  className,
}: {
  userId: string
  name: string
  timedOut?: boolean
  className?: string
}) {
  const { api } = useOrgContext()
  const qc = useQueryClient()
  const set = async (minutes: number, label?: string) => {
    try {
      await post(`${api}/members/${userId}/timeout`, { minutes })
      void qc.invalidateQueries({ queryKey: ['members'] })
      toast.success(minutes ? `${name} is in a timeout for ${label}.` : `Ended ${name}'s timeout.`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" className={className} title="Stop them posting for a while">
          <Timer /> {timedOut ? 'Timed out' : 'Timeout'}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {CHOICES.map((c) => (
          <MenuItem key={c.minutes} onSelect={() => void set(c.minutes, c.label)}>
            {c.label}
          </MenuItem>
        ))}
        {timedOut && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => void set(0)}>End timeout</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
