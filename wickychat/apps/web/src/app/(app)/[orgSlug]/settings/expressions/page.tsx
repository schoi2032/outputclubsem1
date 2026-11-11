'use client'
import {
  type Attachment,
  type CustomEmoji,
  can,
  EMOJI_NAME,
  type SoundboardSound,
} from '@quid/shared'
import { Button, EmptyState, Field, IconButton, Input, Skeleton, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Play, Smile, Trash2, Volume2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { CustomEmojiImg } from '@/components/chat/custom-emoji'
import { EmojiPicker } from '@/components/chat/emoji-picker'
import { useOrgContext } from '@/components/org-context'
import { SettingsCard, SettingsTitle } from '@/components/settings-ui'
import { del, errorMessage, post, upload } from '@/lib/api'
import { expressionKeys, useCustomEmojis, useSounds } from '@/lib/expressions'
import { displayName } from '@/lib/format'
import { usePreference } from '@/lib/preferences'
import { BUILTIN_SOUNDS, playSound, toBoardSound } from '@/lib/soundboard'

/** `Party Parrot.gif` → `party_parrot` */
const nameFromFile = (file: string) =>
  file
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_+-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)

function AddEmoji() {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const valid = EMOJI_NAME.test(name)

  const choose = (f: File | undefined) => {
    if (!f) return
    if (preview) URL.revokeObjectURL(preview)
    setFile(f)
    setPreview(URL.createObjectURL(f))
    if (!name) setName(nameFromFile(f.name))
  }

  const save = async () => {
    if (!file || !valid) return
    setBusy(true)
    try {
      const f = await upload<Attachment>(`${api}/files?purpose=emoji`, file).promise
      await post(`${api}/emojis`, { name, fileId: f.id })
      await qc.invalidateQueries({ queryKey: expressionKeys.emojis(org.id) })
      toast.success(`:${name}: is ready to use`)
      setFile(null)
      setPreview(null)
      setName('')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <button
        type="button"
        onClick={() => input.current?.click()}
        aria-label="Choose an image"
        className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-border-strong bg-bg-subtle hover:bg-bg-muted"
      >
        {preview ? (
          <img src={preview} alt="" className="size-10 object-contain" />
        ) : (
          <ImagePlus className="size-5 text-fg-subtle" />
        )}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => {
          choose(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="min-w-48 flex-1">
        <Field
          label="Emoji name"
          hint="Type it between colons, like :party_parrot:"
          error={name && !valid ? 'Use 2–32 lowercase letters, numbers, - _ or +' : undefined}
        >
          {(p) => (
            <Input
              {...p}
              placeholder="party_parrot"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[\s:]/g, '_'))}
            />
          )}
        </Field>
      </div>
      <Button type="submit" variant="primary" loading={busy} disabled={!file || !valid}>
        Add emoji
      </Button>
    </form>
  )
}

function EmojiList({ list }: { list: CustomEmoji[] }) {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const admin = can(org.role, 'expressions.manage_any')
  if (!list.length)
    return (
      <EmptyState
        icon={<Smile />}
        title="No custom emoji yet"
        description="Add your team's inside jokes, logos and reactions."
      />
    )
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {list.map((e) => (
        <li
          key={e.id}
          className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-bg-subtle"
        >
          <CustomEmojiImg emoji={e} className="size-7 max-w-none" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">:{e.name}:</p>
            <p className="truncate text-xs text-fg-subtle">
              {e.createdBy ? `Added by ${displayName(e.createdBy)}` : 'Added by a former member'}
            </p>
          </div>
          {(admin || e.createdBy?.id === me.id) && (
            <IconButton
              label={`Remove :${e.name}:`}
              size="sm"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={async () => {
                try {
                  await del(`${api}/emojis/${e.id}`)
                  await qc.invalidateQueries({ queryKey: expressionKeys.emojis(org.id) })
                } catch (err) {
                  toast.error(errorMessage(err))
                }
              }}
            >
              <Trash2 />
            </IconButton>
          )}
        </li>
      ))}
    </ul>
  )
}

function AddSound() {
  const { api, org } = useOrgContext()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🔊')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const save = async () => {
    if (!file || !name.trim()) return
    setBusy(true)
    try {
      const f = await upload<Attachment>(`${api}/files?purpose=sound`, file).promise
      await post(`${api}/sounds`, { name: name.trim(), emoji, fileId: f.id })
      await qc.invalidateQueries({ queryKey: expressionKeys.sounds(org.id) })
      toast.success(`${name.trim()} added to the soundboard`)
      setFile(null)
      setName('')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <EmojiPicker side="bottom" align="start" onPick={setEmoji}>
        <button
          type="button"
          aria-label={`Sound icon: ${emoji}. Change`}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-lg hover:bg-bg-subtle"
        >
          {emoji}
        </button>
      </EmojiPicker>
      <div className="min-w-40 flex-1">
        <Field label="Sound name">
          {(p) => (
            <Input
              {...p}
              placeholder="Rimshot"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Button type="button" onClick={() => input.current?.click()}>
        {file ? <span className="max-w-32 truncate">{file.name}</span> : 'Choose audio'}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept="audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setFile(f)
          if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 32))
        }}
      />
      <Button type="submit" variant="primary" loading={busy} disabled={!file || !name.trim()}>
        Add sound
      </Button>
    </form>
  )
}

function SoundRow({
  s,
  onRemove,
}: {
  s: { id: string; name: string; emoji: string | null; by?: string; custom?: SoundboardSound }
  onRemove?: () => void
}) {
  const volume = usePreference('soundboardVolume')
  const sound = s.custom ? toBoardSound(s.custom) : BUILTIN_SOUNDS.find((b) => b.id === s.id)!
  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-bg-subtle">
      <span className="flex size-7 items-center justify-center text-lg">{s.emoji ?? '🔊'}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{s.name}</p>
        {s.by && <p className="truncate text-xs text-fg-subtle">{s.by}</p>}
      </div>
      <IconButton
        label={`Preview ${s.name}`}
        size="sm"
        onClick={() => playSound(sound, Math.max(volume, 30))}
      >
        <Play />
      </IconButton>
      {onRemove && (
        <IconButton
          label={`Remove ${s.name}`}
          size="sm"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onRemove}
        >
          <Trash2 />
        </IconButton>
      )}
    </li>
  )
}

export default function ExpressionsSettings() {
  const { api, org, me } = useOrgContext()
  const qc = useQueryClient()
  const emojis = useCustomEmojis()
  const sounds = useSounds()
  const admin = can(org.role, 'expressions.manage_any')
  const canAdd =
    can(org.role, 'expressions.create') &&
    (admin || org.customization.expressionsPolicy === 'members')

  return (
    <>
      <SettingsTitle
        title="Emoji & sounds"
        description={`Custom emoji and soundboard sounds everyone in ${org.name} can use.`}
      />
      <SettingsCard
        title={`Custom emoji${emojis.data?.length ? ` · ${emojis.data.length}` : ''}`}
        description="PNG, JPEG, GIF or WebP up to 512 KB. Square images about 128×128 look best; GIFs animate."
      >
        {canAdd && (
          <div className="mb-5 border-b border-border pb-5">
            <AddEmoji />
          </div>
        )}
        {emojis.isLoading ? <Skeleton className="h-16" /> : <EmojiList list={emojis.data ?? []} />}
      </SettingsCard>

      <SettingsCard
        title="Soundboard"
        description="Short clips anyone can play in a voice room. MP3, WAV or OGG up to 1 MB; keep them under 5 seconds."
      >
        {canAdd && (
          <div className="mb-5 border-b border-border pb-5">
            <AddSound />
          </div>
        )}
        {sounds.isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            {(sounds.data?.length ?? 0) > 0 && (
              <>
                <p className="mb-1 flex items-center gap-1.5 px-2 text-2xs font-medium text-fg-subtle uppercase">
                  <Volume2 className="size-3" /> {org.name}
                </p>
                <ul className="mb-4 grid gap-1 sm:grid-cols-2">
                  {sounds.data!.map((s) => (
                    <SoundRow
                      key={s.id}
                      s={{
                        id: s.id,
                        name: s.name,
                        emoji: s.emoji,
                        custom: s,
                        by: s.createdBy ? `Added by ${displayName(s.createdBy)}` : undefined,
                      }}
                      onRemove={
                        admin || s.createdBy?.id === me.id
                          ? async () => {
                              try {
                                await del(`${api}/sounds/${s.id}`)
                                await qc.invalidateQueries({
                                  queryKey: expressionKeys.sounds(org.id),
                                })
                              } catch (err) {
                                toast.error(errorMessage(err))
                              }
                            }
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </>
            )}
            <p className="mb-1 flex items-center gap-1.5 px-2 text-2xs font-medium text-fg-subtle uppercase">
              <Volume2 className="size-3" /> Built in
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {BUILTIN_SOUNDS.map((s) => (
                <SoundRow key={s.id} s={s} />
              ))}
            </ul>
          </>
        )}
      </SettingsCard>
    </>
  )
}
