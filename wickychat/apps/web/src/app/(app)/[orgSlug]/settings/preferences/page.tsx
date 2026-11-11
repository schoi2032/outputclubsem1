'use client'
import { ACCENT_PRESETS, type Preferences, type PreferencesUpdate } from '@quid/shared'
import { Avatar, Button, cn, Switch } from '@quid/ui'
import { Check, RotateCcw } from 'lucide-react'
import { EmojiValue } from '@/components/chat/custom-emoji'
import { EmojiPicker } from '@/components/chat/emoji-picker'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { useIsMac } from '@/components/shell/command-palette'
import { displayName, formatTime } from '@/lib/format'
import { resetPreferences, setPreferences, usePreferences } from '@/lib/preferences'

type Option<V extends string> = { value: V; label: string; hint?: string }

/** A row of mutually exclusive choices. */
function Choice<K extends keyof Preferences>({
  name,
  value,
  options,
}: {
  name: K
  value: Preferences[K] & string
  options: Option<Preferences[K] & string>[]
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => setPreferences({ [name]: o.value } as PreferencesUpdate)}
          className={cn(
            'rounded-lg border p-2.5 text-left text-[13px] font-medium',
            value === o.value
              ? 'border-accent ring-1 ring-accent'
              : 'border-border hover:bg-bg-subtle',
          )}
        >
          {o.label}
          {o.hint && <span className="block text-xs font-normal text-fg-subtle">{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="text-[13px] font-medium">
        {label}
        {hint && <span className="block text-xs font-normal text-fg-subtle">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ name, label, hint }: { name: keyof Preferences; label: string; hint?: string }) {
  const prefs = usePreferences()
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-[13px] first:pt-0 last:pb-0">
      <span>
        {label}
        {hint && <span className="block text-xs text-fg-subtle">{hint}</span>}
      </span>
      <Switch
        checked={prefs[name] as boolean}
        onCheckedChange={(v) => setPreferences({ [name]: v } as PreferencesUpdate)}
        label={label}
      />
    </div>
  )
}

/** A small sample conversation that reflects the message settings as you change them. */
function Preview() {
  const { me } = useOrgContext()
  const prefs = usePreferences()
  const compact = prefs.density === 'compact'
  const now = Date.now()
  const rows = [
    {
      who: 'Ada',
      id: 'preview-ada',
      at: now - 8 * 60_000,
      text: 'Shipping the new build at 4. Any blockers?',
    },
    {
      who: 'Ada',
      id: 'preview-ada',
      at: now - 7 * 60_000,
      text: 'Release notes are in #launch.',
      grouped: true,
    },
    { who: displayName(me), id: me.id, at: now - 2 * 60_000, text: 'All clear on my side 🚀' },
    { who: displayName(me), id: me.id, at: now - 60_000, text: '🎉', grouped: true, jumbo: true },
  ]
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg py-2" aria-hidden>
      {rows.map((r, i) => {
        const grouped = prefs.groupMessages && r.grouped
        const time = formatTime(new Date(r.at).toISOString())
        return (
          <div
            key={i}
            className={cn(
              'flex gap-3 px-4',
              grouped ? (compact ? 'py-0' : 'py-0.5') : compact ? 'pt-1' : 'pt-2 pb-0.5',
            )}
          >
            <div className={cn('shrink-0', compact ? 'w-8' : 'w-9')}>
              {!grouped && prefs.avatars && (
                <Avatar
                  name={r.who}
                  id={r.id}
                  src={r.id === me.id ? me.avatarUrl : null}
                  size="lg"
                  className={compact ? '[&>span]:size-8' : '[&>span]:size-9'}
                />
              )}
            </div>
            <div className="min-w-0">
              {!grouped && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold">{r.who}</span>
                  <span className="text-xs text-fg-subtle tabular-nums">{time}</span>
                </div>
              )}
              <p className={r.jumbo && prefs.jumboEmoji ? 'q-jumbo' : 'q-msg-text'}>
                {r.text.includes('#launch') ? (
                  <>
                    Release notes are in <span className="q-mention">#launch</span>.
                  </>
                ) : (
                  r.text
                )}
              </p>
            </div>
          </div>
        )
      })}
      <div className="mt-2 flex gap-1.5 px-4">
        <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg">
          Button
        </span>
        <span className="rounded-md bg-accent-subtle px-2.5 py-1 text-xs font-medium text-accent-text">
          Selected
        </span>
      </div>
    </div>
  )
}

export default function PreferencesSettings() {
  const prefs = usePreferences()
  const isMac = useIsMac()
  const { org } = useOrgContext()
  const brand = org.customization.brandColor
  const custom = !ACCENT_PRESETS.some((a) => a.color === prefs.accent.toLowerCase())

  return (
    <>
      <SettingsTitle
        title="Appearance & preferences"
        description="Make WickyChat yours. Changes apply instantly and follow you to every device."
        actions={
          <Button size="sm" variant="ghost" onClick={resetPreferences}>
            <RotateCcw className="size-3.5" /> Reset to defaults
          </Button>
        }
      />

      <SettingsCard title="Preview">
        <Preview />
      </SettingsCard>

      <SettingsCard title="Theme">
        <div className="divide-y divide-border">
          <Row label="Color mode">
            <Choice
              name="theme"
              value={prefs.theme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System', hint: 'Match your device' },
              ]}
            />
          </Row>
          <Row
            label="Accent color"
            hint={
              brand
                ? `Buttons, links, selection and focus rings. The first one is ${org.name}'s brand color.`
                : 'Buttons, links, selection and focus rings.'
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map((a, i) => {
                const on = prefs.accent.toLowerCase() === a.color
                // The default slot follows the workspace's brand color when there is one.
                const swatch = i === 0 && brand ? brand : a.color
                return (
                  <button
                    key={a.id}
                    type="button"
                    title={a.label}
                    aria-label={a.label}
                    aria-pressed={on}
                    onClick={() => setPreferences({ accent: a.color })}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-bg',
                      on && 'ring-2 ring-fg',
                    )}
                    style={{ background: swatch }}
                  >
                    {on && <Check className="size-4" />}
                  </button>
                )
              })}
              <label
                className={cn(
                  'relative flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border px-3 text-xs font-medium hover:bg-bg-subtle',
                  custom && 'border-accent ring-1 ring-accent',
                )}
              >
                <span className="size-4 rounded-full" style={{ background: prefs.accent }} />
                Custom
                <input
                  type="color"
                  value={prefs.accent}
                  onChange={(e) => setPreferences({ accent: e.target.value })}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Custom accent color"
                />
              </label>
            </div>
          </Row>
          <Row label="Contrast">
            <Choice
              name="contrast"
              value={prefs.contrast}
              options={[
                { value: 'normal', label: 'Standard' },
                { value: 'high', label: 'High', hint: 'Stronger text and borders' },
              ]}
            />
          </Row>
          <Row label="Corners">
            <Choice
              name="radius"
              value={prefs.radius}
              options={[
                { value: 'square', label: 'Sharp' },
                { value: 'default', label: 'Default' },
                { value: 'round', label: 'Round' },
              ]}
            />
          </Row>
          <Row label="Animations">
            <Choice
              name="motion"
              value={prefs.motion}
              options={[
                { value: 'system', label: 'System', hint: 'Follow your device' },
                { value: 'reduced', label: 'Reduced' },
                { value: 'full', label: 'Full' },
              ]}
            />
          </Row>
        </div>
      </SettingsCard>

      <SettingsCard title="Text">
        <div className="divide-y divide-border">
          <Row label="Font">
            <Choice
              name="font"
              value={prefs.font}
              options={[
                { value: 'geist', label: 'Geist', hint: 'WickyChat default' },
                { value: 'system', label: 'System' },
                { value: 'serif', label: 'Serif' },
                { value: 'mono', label: 'Monospace' },
              ]}
            />
          </Row>
          <Row label="Message text size">
            <Choice
              name="textSize"
              value={prefs.textSize}
              options={[
                { value: 'sm', label: 'Small' },
                { value: 'md', label: 'Default' },
                { value: 'lg', label: 'Large' },
                { value: 'xl', label: 'Extra large' },
              ]}
            />
          </Row>
        </div>
      </SettingsCard>

      <SettingsCard title="Messages">
        <div className="divide-y divide-border">
          <Row label="Density">
            <Choice
              name="density"
              value={prefs.density}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact', hint: 'More messages on screen' },
              ]}
            />
          </Row>
          <Row label="Clock">
            <Choice
              name="clock"
              value={prefs.clock}
              options={[
                { value: 'auto', label: 'Automatic', hint: 'From your language' },
                { value: '12h', label: '12-hour', hint: '3:45 PM' },
                { value: '24h', label: '24-hour', hint: '15:45' },
              ]}
            />
          </Row>
          <Toggle name="avatars" label="Show profile photos" />
          <Row label="Animated profile photos" hint="GIF and animated WebP photos.">
            <Choice
              name="animateAvatars"
              value={prefs.animateAvatars}
              options={[
                { value: 'hover', label: 'On hover' },
                { value: 'always', label: 'Always play' },
                { value: 'never', label: 'Never', hint: 'Show a still frame' },
              ]}
            />
          </Row>
          <Toggle
            name="groupMessages"
            label="Group consecutive messages"
            hint="Messages from the same person within 5 minutes share one header."
          />
          <Toggle
            name="jumboEmoji"
            label="Large emoji"
            hint="Messages that are only emoji show big."
          />
          <Row label="Quick reactions" hint="The three emoji on a message's hover toolbar.">
            <div className="flex gap-2">
              {prefs.quickReactions.map((e, i) => (
                <EmojiPicker
                  key={i}
                  side="bottom"
                  align="start"
                  onPick={(picked) => {
                    const next = [...prefs.quickReactions]
                    // Swap rather than duplicate, so each slot stays unique.
                    const existing = next.indexOf(picked)
                    if (existing !== -1) next[existing] = next[i]!
                    next[i] = picked
                    setPreferences({ quickReactions: next })
                  }}
                >
                  <button
                    type="button"
                    aria-label={`Quick reaction ${i + 1}: ${e}. Change`}
                    className="flex size-10 items-center justify-center rounded-lg border border-border text-xl hover:bg-bg-subtle"
                  >
                    <EmojiValue value={e} className="size-6 max-w-none" />
                  </button>
                </EmojiPicker>
              ))}
            </div>
          </Row>
        </div>
      </SettingsCard>

      <SettingsCard title="Composer">
        <div className="divide-y divide-border">
          <Row label="Send messages with">
            <Choice
              name="sendKey"
              value={prefs.sendKey}
              options={[
                { value: 'enter', label: 'Enter', hint: 'Shift+Enter for a new line' },
                {
                  value: 'mod-enter',
                  label: `${isMac ? '⌘' : 'Ctrl'}+Enter`,
                  hint: 'Enter for a new line',
                },
              ]}
            />
          </Row>
          <Toggle name="spellcheck" label="Check spelling" />
        </div>
      </SettingsCard>

      <SettingsCard title="Voice rooms">
        <div className="divide-y divide-border">
          <Toggle
            name="soundboard"
            label="Hear soundboard sounds"
            hint="Sounds other people play in the voice room you're in."
          />
          <Row label="Soundboard volume">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                aria-label="Soundboard volume"
                value={prefs.soundboardVolume}
                disabled={!prefs.soundboard}
                onChange={(e) => setPreferences({ soundboardVolume: Number(e.target.value) })}
                className="h-1.5 flex-1 accent-[var(--q-accent)] disabled:opacity-50"
              />
              <span className="w-10 text-right text-xs text-fg-muted tabular-nums">
                {prefs.soundboardVolume}%
              </span>
            </div>
          </Row>
        </div>
      </SettingsCard>

      <SettingsCard title="Sidebar">
        <div className="divide-y divide-border">
          <Row label="Sort channels">
            <Choice
              name="sidebarSort"
              value={prefs.sidebarSort}
              options={[
                { value: 'alpha', label: 'Alphabetical' },
                { value: 'recent', label: 'Recent activity' },
              ]}
            />
          </Row>
          <Toggle
            name="sidebarUnreadOnly"
            label="Only show unread conversations"
            hint="The one you have open always stays."
          />
          <Toggle name="sidebarHideMuted" label="Hide muted conversations" />
          <Toggle
            name="sidebarShortcuts"
            label="Show shortcuts"
            hint="Later, My tasks, Workflows, Drafts and People."
          />
        </div>
      </SettingsCard>
    </>
  )
}
