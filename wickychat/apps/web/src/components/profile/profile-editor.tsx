'use client'
/**
 * WickyChat: edit your profile card. Pronouns, About me, banner (colour or uploaded image,
 * GIFs animate), name font and colour (one colour or a gradient), bio font, and a two-colour
 * card theme, with a live preview.
 */
import {
  type Attachment,
  BANNER_COLORS,
  cleanProfileStyle,
  PROFILE_FONTS,
  type ProfileFontId,
  type ProfileStyle,
} from '@quid/shared'
import { Button, cn, Field, Input, Select, Switch, Textarea, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard } from '@/components/settings-ui'
import { errorMessage, patch, upload } from '@/lib/api'
import { keys } from '@/lib/queries'
import { BioBlock, CardFace } from './profile-card'

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #8052ff, #15846e)'

function Swatches({
  value,
  onChange,
  allowNone,
  noneLabel = 'Default',
}: {
  value: string | null
  onChange: (c: string | null) => void
  allowNone?: boolean
  noneLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowNone && (
        <button
          type="button"
          aria-label={noneLabel}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={cn(
            'size-7 rounded-full ring-offset-2 ring-offset-bg',
            value === null && 'ring-2 ring-fg',
          )}
          style={{ background: DEFAULT_GRADIENT }}
        />
      )}
      {BANNER_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            'size-7 rounded-full ring-offset-2 ring-offset-bg',
            value === c && 'ring-2 ring-fg',
          )}
          style={{ background: c }}
        />
      ))}
      <label
        className="relative size-7 cursor-pointer overflow-hidden rounded-full border border-dashed border-border-strong"
        title="Pick any colour"
      >
        <span className="absolute inset-0 flex items-center justify-center text-xs text-fg-muted">
          +
        </span>
        <input
          type="color"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={value ?? '#8052ff'}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  )
}

function FontSelect({
  value,
  onChange,
  label,
}: {
  value: ProfileFontId | undefined
  onChange: (f: ProfileFontId) => void
  label: string
}) {
  return (
    <Field label={label}>
      {(p) => (
        <Select
          {...p}
          value={value ?? 'default'}
          onChange={(e) => onChange(e.target.value as ProfileFontId)}
        >
          {PROFILE_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}

export function ProfileCardEditor() {
  const { me, api, base } = useOrgContext()
  const qc = useQueryClient()
  const initial = cleanProfileStyle(me.profileStyle)
  const [bio, setBio] = useState(me.bio)
  const [pronouns, setPronouns] = useState(me.pronouns)
  const [bannerColor, setBannerColor] = useState<string | null>(me.bannerColor)
  const [bannerUrl, setBannerUrl] = useState<string | null>(me.bannerUrl)
  const [bannerFileId, setBannerFileId] = useState<string | null | undefined>(undefined)
  const [style, setStyle] = useState<ProfileStyle>(initial)
  const [gradientName, setGradientName] = useState((initial.nameColors?.length ?? 0) > 1)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (patch: Partial<ProfileStyle>) => setStyle((s) => ({ ...s, ...patch }))
  const nameColors = style.nameColors ?? []

  const save = async () => {
    setSaving(true)
    try {
      await patch('/api/me', {
        bio,
        pronouns,
        bannerColor,
        ...(bannerFileId !== undefined && { bannerFileId }),
        profileStyle: style,
      })
      await qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: ['members'] })
      toast.success('Profile card saved ✨')
      setBannerFileId(undefined)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const uploadBanner = async (file: File) => {
    setUploading(true)
    try {
      const f = await upload<Attachment>(`${api}/files?purpose=banner`, file).promise
      setBannerFileId(f.id)
      setBannerUrl(URL.createObjectURL(file))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <SettingsCard title="Profile card">
      <p className="mb-4 text-[13px] text-fg-muted">
        What people see when they click your name. Want an animated decoration around your picture?
        Get one in the{' '}
        <a className="text-accent-text underline" href={`${base}/shop`}>
          Wicky Shop
        </a>
        .
      </p>
      <div className="flex flex-col gap-8 lg:flex-row">
        <form
          className="flex flex-1 flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="Pronouns" hint="Optional, e.g. she/her, he/him, they/them.">
            {(p) => (
              <Input
                {...p}
                maxLength={40}
                value={pronouns}
                onChange={(e) => setPronouns(e.target.value)}
              />
            )}
          </Field>
          <Field label="About me" hint={`${bio.length}/190 · Swear words are filtered here too.`}>
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={190}
                value={bio}
                placeholder="Clubs, hobbies, favourite subject…"
                onChange={(e) => setBio(e.target.value)}
              />
            )}
          </Field>
          <FontSelect
            label="About me font"
            value={style.bioFont}
            onChange={(f) => set({ bioFont: f })}
          />

          <section className="flex flex-col gap-2">
            <p className="text-[13px] font-medium">Banner</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                loading={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus /> {bannerUrl ? 'Change image' : 'Upload image'}
              </Button>
              {bannerUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setBannerUrl(null)
                    setBannerFileId(null)
                  }}
                >
                  Remove image
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void uploadBanner(f)
                }}
              />
            </div>
            <p className="text-2xs text-fg-subtle">
              Wide images work best (about 3:1). GIFs animate. Up to 5 MB. Or pick a colour:
            </p>
            <Swatches value={bannerColor} onChange={setBannerColor} allowNone />
          </section>

          <section className="flex flex-col gap-3">
            <FontSelect
              label="Name font"
              value={style.nameFont}
              onChange={(f) => set({ nameFont: f })}
            />
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium">Name colour</p>
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <span aria-hidden="true">Gradient</span>
                <Switch
                  label="Gradient name"
                  checked={gradientName}
                  onCheckedChange={(on) => {
                    setGradientName(on)
                    set({
                      nameColors: on
                        ? [nameColors[0] ?? '#8052ff', nameColors[1] ?? '#15846e']
                        : nameColors.slice(0, 1),
                    })
                  }}
                />
              </div>
            </div>
            <Swatches
              value={nameColors[0] ?? null}
              allowNone
              noneLabel="Normal colour"
              onChange={(c) =>
                set({
                  nameColors: c ? [c, ...(gradientName ? [nameColors[1] ?? '#15846e'] : [])] : [],
                })
              }
            />
            {gradientName && (
              <>
                <p className="text-xs text-fg-muted">…fading into</p>
                <Swatches
                  value={nameColors[1] ?? null}
                  onChange={(c) =>
                    set({ nameColors: [nameColors[0] ?? '#8052ff', c ?? '#15846e'] })
                  }
                />
              </>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium">Card theme</p>
              <Switch
                label="Card theme"
                checked={!!style.theme}
                onCheckedChange={(on) => set({ theme: on ? ['#8052ff', '#ffb829'] : undefined })}
              />
            </div>
            <p className="text-2xs text-fg-subtle">
              Two colours that tint your whole card, like a Discord profile theme.
            </p>
            {style.theme && (
              <div className="flex flex-col gap-2">
                <Swatches
                  value={style.theme[0]}
                  onChange={(c) => set({ theme: [c ?? '#8052ff', style.theme![1]] })}
                />
                <Swatches
                  value={style.theme[1]}
                  onChange={(c) => set({ theme: [style.theme![0], c ?? '#ffb829'] })}
                />
              </div>
            )}
          </section>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={saving}>
              Save profile card
            </Button>
          </div>
        </form>

        <div className="w-full shrink-0 lg:w-[320px]">
          <p className="mb-1.5 text-2xs font-semibold text-fg-subtle uppercase">Preview</p>
          <div className="sticky top-4 rounded-lg border border-border bg-bg-overlay shadow-pop">
            <CardFace
              look={{
                user: {
                  ...me,
                  nameStyle: { font: style.nameFont, colors: style.nameColors },
                },
                bannerUrl,
                bannerColor,
                theme: style.theme,
                bioFont: style.bioFont,
                pronouns,
                bio,
              }}
            >
              <div className="my-3 h-px bg-border" />
              <BioBlock bio={bio} font={style.bioFont} />
            </CardFace>
          </div>
        </div>
      </div>
    </SettingsCard>
  )
}
