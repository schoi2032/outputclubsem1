'use client'
import {
  ACCENT_PRESETS,
  BANNER_TONES,
  type BannerInput,
  type CustomizationUpdate,
  type OrgCustomization,
  type ProfileField,
  type ProfileFieldKind,
  STATUS_DURATIONS,
  type StatusPreset,
} from '@quid/shared'
import { Button, cn, Field, IconButton, Input, Select, Switch, Textarea, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EmojiPicker } from '@/components/chat/emoji-picker'
import { OrgBanner } from '@/components/org/org-banner'
import { WelcomeCard } from '@/components/org/welcome-card'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { errorMessage, patch } from '@/lib/api'
import { keys, useChannels } from '@/lib/queries'

/** Saves part of the customization and refreshes everyone's copy (ours via /me). */
function useSave() {
  const { api } = useOrgContext()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const save = async (body: CustomizationUpdate, done = 'Saved') => {
    setBusy(true)
    try {
      await patch<OrgCustomization>(`${api}/customization`, body)
      await qc.invalidateQueries({ queryKey: keys.me })
      toast.success(done)
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { save, busy }
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 flex justify-end gap-2">{children}</div>
}

// --- Brand color ---------------------------------------------------------------

function BrandColor({ c }: { c: OrgCustomization }) {
  const { save, busy } = useSave()
  const [color, setColor] = useState(c.brandColor)
  return (
    <SettingsCard
      title="Brand color"
      description="Buttons, links and highlights use it for everyone who hasn't picked their own accent color."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={color === null}
          onClick={() => setColor(null)}
          className={cn(
            'h-8 rounded-full border px-3 text-xs font-medium',
            color === null
              ? 'border-accent ring-1 ring-accent'
              : 'border-border hover:bg-bg-subtle',
          )}
        >
          WickyChat default
        </button>
        {ACCENT_PRESETS.slice(1).map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.label}
            aria-label={p.label}
            aria-pressed={color?.toLowerCase() === p.color}
            onClick={() => setColor(p.color)}
            className="flex size-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-bg aria-pressed:ring-2 aria-pressed:ring-fg"
            style={{ background: p.color }}
          >
            {color?.toLowerCase() === p.color && <Check className="size-4" />}
          </button>
        ))}
        <label className="flex h-8 items-center gap-2 rounded-full border border-border pr-3 pl-1 text-xs text-fg-muted">
          <input
            type="color"
            aria-label="Custom brand color"
            value={color ?? '#b8492f'}
            onChange={(e) => setColor(e.target.value)}
            className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          Custom
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-border p-3">
        <span
          className="inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-white"
          style={{ background: color ?? '#b8492f' }}
        >
          Primary button
        </span>
        <span className="text-[13px] font-medium" style={{ color: color ?? '#b8492f' }}>
          A link
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
          style={{ background: color ?? '#b8492f' }}
        >
          3
        </span>
      </div>
      <Footer>
        <Button
          variant="primary"
          loading={busy}
          disabled={color === c.brandColor}
          onClick={() => void save({ brandColor: color }, 'Brand color updated')}
        >
          Save color
        </Button>
      </Footer>
    </SettingsCard>
  )
}

// --- Banner ----------------------------------------------------------------------

function AnnouncementBanner({ c }: { c: OrgCustomization }) {
  const { org } = useOrgContext()
  const { save, busy } = useSave()
  const [b, setB] = useState<BannerInput>({
    text: c.banner?.text ?? '',
    tone: c.banner?.tone ?? 'info',
    linkUrl: c.banner?.linkUrl ?? '',
    linkLabel: c.banner?.linkLabel ?? '',
  })
  const set = (p: Partial<BannerInput>) => setB((x) => ({ ...x, ...p }))
  return (
    <SettingsCard
      title="Announcement banner"
      description="A strip across the top of WickyChat for everyone in the workspace. People can dismiss it; publishing a change shows it again."
    >
      <div className="flex flex-col gap-4">
        <Field label="Message">
          {(p) => (
            <Input
              {...p}
              maxLength={200}
              placeholder="All-hands is Friday at 3 PM in the main room"
              value={b.text}
              onChange={(e) => set({ text: e.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[140px_1fr_140px]">
          <Field label="Style">
            {(p) => (
              <Select
                {...p}
                value={b.tone}
                onChange={(e) => set({ tone: e.target.value as BannerInput['tone'] })}
              >
                {BANNER_TONES.map((t) => (
                  <option key={t} value={t}>
                    {{ info: 'Brand', success: 'Good news', warning: 'Heads-up' }[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Link (optional)">
            {(p) => (
              <Input
                {...p}
                type="url"
                placeholder="https://"
                value={b.linkUrl ?? ''}
                onChange={(e) => set({ linkUrl: e.target.value })}
              />
            )}
          </Field>
          <Field label="Link text">
            {(p) => (
              <Input
                {...p}
                maxLength={30}
                placeholder="Learn more"
                value={b.linkLabel ?? ''}
                onChange={(e) => set({ linkLabel: e.target.value })}
              />
            )}
          </Field>
        </div>
        {b.text.trim() && (
          <div>
            <p className="mb-1.5 text-xs text-fg-subtle">Preview</p>
            <OrgBanner
              orgId={org.id}
              preview
              banner={{ ...b, text: b.text.trim(), id: 'preview' }}
            />
          </div>
        )}
      </div>
      <Footer>
        {c.banner && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void save({ banner: null }, 'Banner removed')}
          >
            Remove banner
          </Button>
        )}
        <Button
          variant="primary"
          loading={busy}
          disabled={!b.text.trim()}
          onClick={() =>
            void save(
              {
                banner: {
                  text: b.text.trim(),
                  tone: b.tone,
                  linkUrl: b.linkUrl?.trim() || null,
                  linkLabel: b.linkLabel?.trim() || null,
                },
              },
              'Banner published',
            )
          }
        >
          {c.banner ? 'Update banner' : 'Publish banner'}
        </Button>
      </Footer>
    </SettingsCard>
  )
}

// --- Onboarding --------------------------------------------------------------------

function Onboarding({ c }: { c: OrgCustomization }) {
  const { org } = useOrgContext()
  const channels = useChannels(org.id)
  const { save, busy } = useSave()
  const [message, setMessage] = useState(c.welcomeMessage)
  const [autoJoin, setAutoJoin] = useState(c.autoJoinChannelIds)
  // Joined public channels (default ones are already automatic).
  const options = (channels.data ?? []).filter(
    (ch) => ch.kind === 'public' && !ch.archivedAt && ch.membership,
  )
  return (
    <SettingsCard
      title="Welcome new members"
      description="What people see and where they land when they join."
    >
      <Field
        label="Welcome message"
        hint="Shown on Home for a member's first 30 days, until they dismiss it. Links are clickable."
      >
        {(p) => (
          <Textarea
            {...p}
            rows={4}
            maxLength={1000}
            placeholder={`Welcome to ${org.name}! Say hi in #general, and check the handbook: https://…`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        )}
      </Field>
      {message.trim() && (
        <div className="mt-3">
          <WelcomeCard
            name={org.name}
            logoUrl={org.logoUrl}
            orgId={org.id}
            message={message.trim()}
          />
        </div>
      )}
      <p className="mt-5 text-[13px] font-medium">Channels new members join</p>
      <p className="mb-2 text-xs text-fg-subtle">
        On top of the default channels. Guests aren't added, and members can leave these later.
      </p>
      <ul className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
        {options.map((ch) => {
          const on = ch.isDefault || autoJoin.includes(ch.id)
          return (
            <li key={ch.id}>
              <label
                className={cn(
                  'flex h-9 items-center gap-2 rounded-lg border border-border px-2.5 text-[13px]',
                  ch.isDefault ? 'opacity-60' : 'cursor-pointer hover:bg-bg-subtle',
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={ch.isDefault}
                  onChange={(e) =>
                    setAutoJoin((ids) =>
                      e.target.checked ? [...ids, ch.id] : ids.filter((x) => x !== ch.id),
                    )
                  }
                  className="accent-[var(--q-accent)]"
                />
                <span className="truncate">#{ch.name}</span>
                {ch.isDefault && <span className="ml-auto text-2xs text-fg-subtle">Default</span>}
              </label>
            </li>
          )
        })}
      </ul>
      <Footer>
        <Button
          variant="primary"
          loading={busy}
          onClick={() =>
            void save(
              { welcomeMessage: message.trim(), autoJoinChannelIds: autoJoin.slice(0, 20) },
              'Onboarding updated',
            )
          }
        >
          Save
        </Button>
      </Footer>
    </SettingsCard>
  )
}

// --- Status presets ------------------------------------------------------------------

function StatusPresets({ c }: { c: OrgCustomization }) {
  const { save, busy } = useSave()
  const [list, setList] = useState<StatusPreset[]>(c.statusPresets)
  const [replace, setReplace] = useState(c.replaceDefaultStatuses)
  const update = (i: number, p: Partial<StatusPreset>) =>
    setList((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <SettingsCard
      title="Status presets"
      description="One-click statuses for your team, like “In the office” or “On call”."
    >
      <ul className="flex flex-col gap-2">
        {list.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <EmojiPicker side="bottom" align="start" onPick={(e) => update(i, { emoji: e })}>
              <button
                type="button"
                aria-label={`Emoji: ${s.emoji}. Change`}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-lg hover:bg-bg-subtle"
              >
                {s.emoji}
              </button>
            </EmojiPicker>
            <Input
              aria-label="Status text"
              maxLength={100}
              value={s.text}
              placeholder="In the office"
              onChange={(e) => update(i, { text: e.target.value })}
            />
            <Select
              aria-label="Clear after"
              className="w-36 shrink-0"
              value={s.hours}
              onChange={(e) => update(i, { hours: Number(e.target.value) })}
            >
              {STATUS_DURATIONS.map((d) => (
                <option key={d.label} value={d.hours}>
                  {d.label}
                </option>
              ))}
            </Select>
            <IconButton
              label="Remove status"
              size="sm"
              onClick={() => setList((l) => l.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </IconButton>
          </li>
        ))}
      </ul>
      {list.length < 12 && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setList((l) => [...l, { emoji: '🏢', text: '', hours: -1 }])}
        >
          <Plus /> Add status
        </Button>
      )}
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4 text-[13px]">
        <span>
          Only show these
          <span className="block text-xs text-fg-subtle">
            Hide WickyChat's built-in suggestions.
          </span>
        </span>
        <Switch checked={replace} onCheckedChange={setReplace} disabled={!list.length} />
      </div>
      <Footer>
        <Button
          variant="primary"
          loading={busy}
          disabled={list.some((s) => !s.text.trim())}
          onClick={() =>
            void save(
              {
                statusPresets: list.map((s) => ({ ...s, text: s.text.trim() })),
                replaceDefaultStatuses: replace && list.length > 0,
              },
              'Status presets saved',
            )
          }
        >
          Save
        </Button>
      </Footer>
    </SettingsCard>
  )
}

// --- Profile fields ----------------------------------------------------------------------

const KIND_LABEL: Record<ProfileFieldKind, string> = {
  text: 'Text',
  link: 'Link',
  select: 'Choice',
}

const newId = () => Math.random().toString(36).slice(2, 10)

function ProfileFields({ c }: { c: OrgCustomization }) {
  const { save, busy } = useSave()
  const [list, setList] = useState<(ProfileField & { optionsText?: string })[]>(
    c.profileFields.map((f) => ({ ...f, optionsText: f.options.join(', ') })),
  )
  const update = (i: number, p: Partial<ProfileField & { optionsText: string }>) =>
    setList((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const move = (i: number, d: -1 | 1) =>
    setList((l) => {
      const next = [...l]
      const [it] = next.splice(i, 1)
      next.splice(i + d, 0, it!)
      return next
    })
  const toSave = list.map(({ optionsText, ...f }) => ({
    ...f,
    label: f.label.trim(),
    options:
      f.kind === 'select'
        ? [
            ...new Set(
              (optionsText ?? '')
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean),
            ),
          ].slice(0, 20)
        : [],
  }))
  const invalid = toSave.some((f) => !f.label || (f.kind === 'select' && !f.options.length))
  return (
    <SettingsCard
      title="Profile fields"
      description="Extra details on everyone's profile, like pronouns, office, team or a portfolio link. Members fill them in under Profile."
    >
      <ul className="flex flex-col gap-3">
        {list.map((f, i) => (
          <li key={f.id} className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label="Field name"
                placeholder="Pronouns"
                maxLength={40}
                value={f.label}
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <Select
                aria-label="Field type"
                className="w-28 shrink-0"
                value={f.kind}
                onChange={(e) => update(i, { kind: e.target.value as ProfileFieldKind })}
              >
                {(Object.keys(KIND_LABEL) as ProfileFieldKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
              <IconButton label="Move up" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp />
              </IconButton>
              <IconButton
                label="Move down"
                size="sm"
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown />
              </IconButton>
              <IconButton
                label="Remove field"
                size="sm"
                onClick={() => setList((l) => l.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </IconButton>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input
                aria-label="Hint"
                placeholder="Hint for members (optional)"
                maxLength={80}
                value={f.hint}
                onChange={(e) => update(i, { hint: e.target.value })}
              />
              {f.kind === 'select' && (
                <Input
                  aria-label="Choices"
                  placeholder="Choices, separated by commas"
                  value={f.optionsText ?? ''}
                  onChange={(e) => update(i, { optionsText: e.target.value })}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      {list.length < 12 && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() =>
            setList((l) => [...l, { id: newId(), label: '', kind: 'text', options: [], hint: '' }])
          }
        >
          <Plus /> Add field
        </Button>
      )}
      <Footer>
        <Button
          variant="primary"
          loading={busy}
          disabled={invalid}
          onClick={() => void save({ profileFields: toSave }, 'Profile fields saved')}
        >
          Save fields
        </Button>
      </Footer>
    </SettingsCard>
  )
}

// --- Permissions -------------------------------------------------------------------------

function Permissions({ c }: { c: OrgCustomization }) {
  const { save, busy } = useSave()
  return (
    <SettingsCard title="Who can add emoji and sounds">
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            { value: 'members', label: 'Everyone', hint: 'Guests excluded' },
            { value: 'admins', label: 'Admins only' },
          ] as const
        ).map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            aria-pressed={c.expressionsPolicy === o.value}
            onClick={() =>
              c.expressionsPolicy !== o.value &&
              void save({ expressionsPolicy: o.value }, 'Permission updated')
            }
            className={cn(
              'rounded-lg border p-2.5 text-left text-[13px] font-medium',
              c.expressionsPolicy === o.value
                ? 'border-accent ring-1 ring-accent'
                : 'border-border hover:bg-bg-subtle',
            )}
          >
            {o.label}
            {'hint' in o && (
              <span className="block text-xs font-normal text-fg-subtle">{o.hint}</span>
            )}
          </button>
        ))}
      </div>
    </SettingsCard>
  )
}

export default function CustomizationSettings() {
  const { org } = useOrgContext()
  const c = org.customization
  if (org.role !== 'owner' && org.role !== 'admin')
    return <p className="text-[13px] text-fg-muted">Only admins can customize the workspace.</p>
  return (
    <>
      <SettingsTitle
        title="Customization"
        description={`Make WickyChat feel like ${org.name}: your color, your announcements, your onboarding.`}
      />
      <BrandColor c={c} />
      <AnnouncementBanner c={c} />
      <Onboarding c={c} />
      <StatusPresets c={c} />
      <ProfileFields c={c} />
      <Permissions c={c} />
    </>
  )
}
