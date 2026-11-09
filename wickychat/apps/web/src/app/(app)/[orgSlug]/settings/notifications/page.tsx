'use client'
import type { NotificationPrefs } from '@quid/shared'
import { Skeleton, Switch, toast } from '@quid/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { errorMessage, get, put } from '@/lib/api'

const ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  {
    key: 'directMessages',
    label: 'Direct messages',
    hint: 'New messages in your DMs and group conversations',
  },
  { key: 'mentions', label: 'Mentions', hint: 'When someone @mentions you or uses @here' },
  {
    key: 'threadReplies',
    label: 'Thread replies',
    hint: 'Replies to threads you started or replied to',
  },
  {
    key: 'channelActivity',
    label: 'All channel activity',
    hint: 'Every new message in channels set to "All new messages"',
  },
  {
    key: 'announcements',
    label: 'Organization announcements',
    hint: 'Announcements sent by administrators',
  },
]

const EMAIL_ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  {
    key: 'emailOffline',
    label: "When I'm away",
    hint: "Mentions, DMs, replies and missed calls, if you haven't seen them within 5 minutes",
  },
  {
    key: 'emailDigest',
    label: 'Daily summary',
    hint: 'One email around 8 AM in your time zone with what is unread',
  },
]

export default function NotificationSettings() {
  const { org, api, me } = useOrgContext()
  const qc = useQueryClient()
  const prefs = useQuery({
    queryKey: ['prefs', org.id],
    queryFn: ({ signal }) => get<NotificationPrefs>(`${api}/notification-preferences`, signal),
  })

  const set = async (patch: Partial<NotificationPrefs>) => {
    qc.setQueryData<NotificationPrefs>(['prefs', org.id], (p) => (p ? { ...p, ...patch } : p))
    try {
      await put(`${api}/notification-preferences`, patch)
    } catch (e) {
      toast.error(errorMessage(e))
      void prefs.refetch()
    }
  }

  return (
    <>
      <SettingsTitle
        title="Notifications"
        description={`What you hear about in ${org.name}. Per-channel settings are in each channel's details.`}
      />
      {!prefs.data ? (
        <Skeleton className="h-60" />
      ) : (
        <>
          <SettingsCard title="Pause everything">
            <div className="flex items-center justify-between gap-4 text-[13px]">
              <span>
                Mute all notifications
                <span className="block text-xs text-fg-subtle">
                  Announcements still come through.
                </span>
              </span>
              <Switch
                checked={prefs.data.muteAll}
                onCheckedChange={(v) => set({ muteAll: v })}
                label="Mute all notifications"
              />
            </div>
          </SettingsCard>
          <SettingsCard title="Notify me about">
            <ul className="flex flex-col gap-4">
              {ROWS.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-4 text-[13px]">
                  <span>
                    {r.label}
                    <span className="block text-xs text-fg-subtle">{r.hint}</span>
                  </span>
                  <Switch
                    checked={prefs.data![r.key]}
                    disabled={prefs.data!.muteAll && r.key !== 'announcements'}
                    onCheckedChange={(v) => set({ [r.key]: v })}
                    label={r.label}
                  />
                </li>
              ))}
            </ul>
          </SettingsCard>
          <SettingsCard
            title="Email"
            description={`Sent to ${me.email}. Turned off while everything is muted.`}
          >
            <ul className="flex flex-col gap-4">
              {EMAIL_ROWS.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-4 text-[13px]">
                  <span>
                    {r.label}
                    <span className="block text-xs text-fg-subtle">{r.hint}</span>
                  </span>
                  <Switch
                    checked={prefs.data![r.key]}
                    disabled={prefs.data!.muteAll}
                    onCheckedChange={(v) => set({ [r.key]: v })}
                    label={r.label}
                  />
                </li>
              ))}
            </ul>
          </SettingsCard>
        </>
      )}
    </>
  )
}
