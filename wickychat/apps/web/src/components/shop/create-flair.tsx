'use client'
import {
  type Attachment,
  COSMETIC_PRICE,
  CREATOR_SHARE,
  FLAIR_LABEL,
  MESSAGE_MOTIONS,
  NAME_ANIMS,
  parseSpec,
  type SpecKind,
  specValue,
  TYPING_ANIMS,
} from '@quid/shared'
import { Button, Field, Input, Select, Switch, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Minus, Play, Plus, Upload } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { FlairPreview } from '@/components/shop/flair-preview'
import { errorMessage, post, upload } from '@/lib/api'

const PREVIEW_ID = '00000000-0000-4000-8000-000000000000'

const HINT: Record<SpecKind, string> = {
  bubble: 'Pick colours, a border and a pattern for the bubble behind messages.',
  name_effect: 'Pick up to 4 colours and how they move.',
  message_effect: 'Pick up to 4 emoji and how they fly out when a message shows up.',
  typing: 'Pick 1 to 3 emoji or symbols that show while someone types.',
  reaction_skin: 'Colours for the reaction pills under messages.',
  mention_style: 'How @mentions look in messages.',
  sound_pack:
    'Upload a short ping sound and (if you want) a send sound. MP3, WAV or OGG, up to 1 MB.',
}

const ANIM_LABEL: Record<string, string> = {
  none: 'No animation',
  shimmer: 'Shimmer',
  rainbow: 'Rainbow (ignores colours)',
  pulse: 'Pulse',
  glow: 'Glow',
  wave: 'Wave',
  glitch: 'Glitch',
  fire: 'Fire',
  burst: 'Burst out',
  rain: 'Rain down',
  float: 'Float up',
  confetti: 'Paper confetti',
  shake: 'Shake the message',
  pop: 'Pop in',
  bounce: 'Bounce',
  spin: 'Spin',
  blink: 'Blink',
  gradient: 'Moving gradient',
}

function Colors({
  value,
  onChange,
  min = 1,
  max,
}: {
  value: string[]
  onChange: (v: string[]) => void
  min?: number
  max: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((c, i) => (
        <input
          key={i}
          type="color"
          aria-label={`Colour ${i + 1}`}
          value={c}
          onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
        />
      ))}
      {value.length < max && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange([...value, value.at(-1) ?? '#8052ff'])}
        >
          <Plus />
        </Button>
      )}
      {value.length > min && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange(value.slice(0, -1))}
        >
          <Minus />
        </Button>
      )}
    </div>
  )
}

function Color({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <input
      type="color"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
    />
  )
}

const glyphs = (s: string, max: number) => s.split(/\s+/).filter(Boolean).slice(0, max)

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id}>{label}</label>
    </div>
  )
}

export function CreateFlair({
  kind,
  availability,
  availabilityBody,
  isPublic,
  onDone,
}: {
  kind: SpecKind
  availability: React.ReactNode
  availabilityBody: Record<string, unknown>
  isPublic: boolean
  onDone?: () => void
}) {
  const { org, api } = useOrgContext()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(120)
  const [saving, setSaving] = useState(false)

  const [colors, setColors] = useState(['#ff5cc8', '#5ec8ff'])
  const [anim, setAnim] = useState<string>(
    kind === 'name_effect' ? 'shimmer' : kind === 'typing' ? 'bounce' : 'none',
  )
  const [speed, setSpeed] = useState(1)
  const [motion, setMotion] = useState<string>('burst')
  const [emoji, setEmoji] = useState(kind === 'typing' ? '⭐ ⭐ ⭐' : '🎉 ✨')
  const [accent, setAccent] = useState('#8052ff')
  const [useAccent, setUseAccent] = useState(false)
  const [text, setText] = useState('#ffffff')
  const [border, setBorder] = useState('#ff3ccf')
  const [borderStyle, setBorderStyle] = useState('none')
  const [shape, setShape] = useState<string>(kind === 'bubble' ? 'round' : 'pill')
  const [pattern, setPattern] = useState('none')
  const [glow, setGlow] = useState(false)
  const [notify, setNotify] = useState<File | null>(null)
  const [send, setSend] = useState<File | null>(null)

  const spec: unknown =
    kind === 'name_effect'
      ? { colors, anim, speed }
      : kind === 'message_effect'
        ? {
            motion,
            particles: glyphs(emoji, 4),
            ...(motion === 'glow' && { color: accent }),
          }
        : kind === 'typing'
          ? { glyphs: glyphs(emoji, 3), anim, ...(useAccent && { color: accent }) }
          : kind === 'reaction_skin'
            ? { bg: colors.slice(0, 2), border, text, shape, glow }
            : kind === 'mention_style'
              ? { bg: colors.slice(0, 2), text, shape, glow }
              : kind === 'bubble'
                ? {
                    bg: colors.slice(0, 3),
                    text,
                    border: borderStyle === 'none' ? null : border,
                    borderStyle,
                    shape,
                    pattern,
                    anim,
                  }
                : null
  const valid = kind === 'sound_pack' ? !!notify : !!parseSpec(kind, spec)
  const preview = kind === 'sound_pack' ? undefined : specValue({ id: PREVIEW_ID, spec })

  const submit = async () => {
    setSaving(true)
    try {
      let body = spec
      if (kind === 'sound_pack') {
        const n = await upload<Attachment>(`${api}/files?purpose=sound`, notify!).promise
        const s = send ? await upload<Attachment>(`${api}/files?purpose=sound`, send).promise : null
        body = { notify: n.id, send: s?.id ?? null }
      }
      await post(`${api}/cosmetics`, {
        kind,
        name,
        description,
        price,
        spec: body,
        ...availabilityBody,
      })
      toast.success('Sent to a teacher for review. It shows in the Shop once approved!')
      setName('')
      setDescription('')
      void qc.invalidateQueries({ queryKey: ['cosmetics', org.id] })
      onDone?.()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const playLocal = (f: File | null) => {
    if (!f) return
    const url = URL.createObjectURL(f)
    const a = new Audio(url)
    a.volume = 0.5
    void a.play().catch(() => {})
    a.onended = () => URL.revokeObjectURL(url)
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void submit()
        }}
      >
        <p className="text-[13px] text-fg-muted">{HINT[kind]}</p>
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              required
              minLength={2}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Description">
          {(p) => (
            <Input
              {...p}
              maxLength={140}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        {(kind === 'name_effect' ||
          kind === 'reaction_skin' ||
          kind === 'mention_style' ||
          kind === 'bubble') && (
          <div>
            <p className="mb-1 text-[13px] font-medium">
              {kind === 'name_effect' ? 'Colours' : 'Background'}
            </p>
            <Colors
              value={colors}
              onChange={setColors}
              max={kind === 'name_effect' ? 4 : kind === 'bubble' ? 3 : 2}
            />
          </div>
        )}

        {(kind === 'reaction_skin' || kind === 'mention_style' || kind === 'bubble') && (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-1 text-[13px] font-medium">Text</p>
              <Color label="Text colour" value={text} onChange={setText} />
            </div>
            {kind !== 'mention_style' && (
              <div>
                <p className="mb-1 text-[13px] font-medium">Border</p>
                <Color label="Border colour" value={border} onChange={setBorder} />
              </div>
            )}
            {kind === 'bubble' && (
              <Field label="Border style">
                {(p) => (
                  <Select
                    {...p}
                    className="w-auto"
                    value={borderStyle}
                    onChange={(e) => setBorderStyle(e.target.value)}
                  >
                    {['none', 'solid', 'dashed', 'dotted'].map((x) => (
                      <option key={x} value={x}>
                        {x === 'none' ? 'No border' : x}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Shape">
              {(p) => (
                <Select
                  {...p}
                  className="w-auto"
                  value={shape}
                  onChange={(e) => setShape(e.target.value)}
                >
                  {(kind === 'bubble'
                    ? ['round', 'soft', 'square']
                    : kind === 'reaction_skin'
                      ? ['pill', 'square', 'pixel']
                      : ['pill', 'box', 'underline']
                  ).map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {kind === 'bubble' && (
              <Field label="Pattern">
                {(p) => (
                  <Select
                    {...p}
                    className="w-auto"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                  >
                    {['none', 'dots', 'stripes', 'grid', 'stars'].map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
        )}

        {(kind === 'reaction_skin' || kind === 'mention_style') && (
          <Toggle id="cf-glow" label="Glow" checked={glow} onChange={setGlow} />
        )}

        {(kind === 'name_effect' || kind === 'typing' || kind === 'bubble') && (
          <Field label="Animation">
            {(p) => (
              <Select
                {...p}
                className="w-auto"
                value={anim}
                onChange={(e) => setAnim(e.target.value)}
              >
                {(kind === 'name_effect'
                  ? NAME_ANIMS
                  : kind === 'typing'
                    ? TYPING_ANIMS
                    : (['none', 'shimmer', 'glow', 'gradient'] as const)
                ).map((x) => (
                  <option key={x} value={x}>
                    {ANIM_LABEL[x] ?? x}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {kind === 'name_effect' && (
          <Field label={`Speed (${speed.toFixed(1)}x)`}>
            {(p) => (
              <input
                {...p}
                type="range"
                min={0.5}
                max={3}
                step={0.1}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="w-48"
              />
            )}
          </Field>
        )}

        {kind === 'message_effect' && (
          <Field label="Motion">
            {(p) => (
              <Select
                {...p}
                className="w-auto"
                value={motion}
                onChange={(e) => setMotion(e.target.value)}
              >
                {MESSAGE_MOTIONS.map((x) => (
                  <option key={x} value={x}>
                    {ANIM_LABEL[x] ?? x}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {(kind === 'typing' ||
          (kind === 'message_effect' && ['burst', 'rain', 'float'].includes(motion))) && (
          <Field
            label={
              kind === 'typing'
                ? 'Emoji or symbols (1 to 3, with spaces between)'
                : 'Emoji (up to 4, with spaces between)'
            }
          >
            {(p) => (
              <Input
                {...p}
                value={emoji}
                maxLength={40}
                onChange={(e) => setEmoji(e.target.value)}
                className="w-56"
              />
            )}
          </Field>
        )}

        {(kind === 'typing' || (kind === 'message_effect' && motion === 'glow')) && (
          <div className="flex items-center gap-3">
            {kind === 'typing' && (
              <Toggle
                id="cf-accent"
                label="Colour the symbols"
                checked={useAccent}
                onChange={setUseAccent}
              />
            )}
            {(kind !== 'typing' || useAccent) && (
              <Color label="Colour" value={accent} onChange={setAccent} />
            )}
          </div>
        )}

        {kind === 'sound_pack' &&
          (
            [
              ['Ping sound (required)', notify, setNotify],
              ['Send sound (optional)', send, setSend],
            ] as const
          ).map(([label, f, set]) => (
            <div key={label}>
              <p className="mb-1 text-[13px] font-medium">{label}</p>
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] hover:bg-bg-muted">
                  <Upload className="size-3.5" /> {f ? f.name : 'Choose sound'}
                  <input
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg"
                    hidden
                    onChange={(e) => {
                      set(e.target.files?.[0] ?? null)
                      e.target.value = ''
                    }}
                  />
                </label>
                {f && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => playLocal(f)}>
                    <Play />
                    Play
                  </Button>
                )}
              </div>
            </div>
          ))}

        {availability}
        {isPublic && (
          <Field
            label="Price"
            hint={`${COSMETIC_PRICE.min}–${COSMETIC_PRICE.max} coins. You get ${Math.round(CREATOR_SHARE * 100)}% of every sale.`}
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min={COSMETIC_PRICE.min}
                max={COSMETIC_PRICE.max}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="w-32"
              />
            )}
          </Field>
        )}
        <p className="text-xs text-fg-subtle">
          {kind === 'sound_pack'
            ? 'Only use sounds you made or have permission to use. A teacher checks it first.'
            : 'A teacher checks it before it goes in the Shop.'}
        </p>
        <div>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!valid || name.trim().length < 2}
          >
            Submit for review
          </Button>
        </div>
      </form>
      <div className="flex flex-col items-center gap-3 self-start rounded-xl border border-border p-5">
        <p className="text-2xs font-semibold text-fg-subtle uppercase">
          {FLAIR_LABEL[kind].emoji} Preview
        </p>
        <div className="flex min-h-20 w-full items-center justify-center rounded-lg bg-bg-subtle p-3">
          {kind === 'sound_pack' ? (
            <span className="text-[13px] text-fg-subtle">Use the Play buttons to hear it</span>
          ) : valid ? (
            <FlairPreview kind={kind} value={preview} />
          ) : (
            <span className="text-[13px] text-fg-subtle">Fill in the options</span>
          )}
        </div>
        <p className="text-[14px] font-semibold">{name || 'Your creation'}</p>
      </div>
    </div>
  )
}
