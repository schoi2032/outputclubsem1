'use client'
import {
  type Attachment,
  COSMETIC_PRICE,
  CREATOR_SHARE,
  codeFields,
  codeToSpec,
  FLAIR,
  FLAIR_LABEL,
  MESSAGE_MOTIONS,
  NAME_ANIMS,
  PROFILE_FONTS,
  parseSpec,
  type SpecKind,
  specToCode,
  specValue,
  TYPING_ANIMS,
} from '@quid/shared'
import { Button, cn, Field, Input, Select, Switch, toast } from '@quid/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Minus, Play, Plus, Upload } from 'lucide-react'
import { useState } from 'react'
import { useOrgContext } from '@/components/org-context'
import { FlairPreview } from '@/components/shop/flair-preview'
import { errorMessage, post, upload } from '@/lib/api'

const PREVIEW_ID = '00000000-0000-4000-8000-000000000000'

const HINT: Record<SpecKind, string> = {
  bubble: 'Pick colours, a border and a pattern for the bubble behind messages.',
  name_effect: 'Pick up to 4 colours and how they move.',
  message_effect: 'Pick up to 4 emoji and how they fly out when a message shows up.',
  typing:
    'Pick 1 to 3 emoji or symbols and what it says, than style the words with colours, gradients, fonts and a pill.',
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
  const [phrase, setPhrase] = useState('')
  const [useWords, setUseWords] = useState(false)
  const [wordColors, setWordColors] = useState(['#ff5cc8', '#8052ff'])
  const [wordAnim, setWordAnim] = useState<string>('none')
  const [font, setFont] = useState('default')
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [size, setSize] = useState('normal')
  const [usePill, setUsePill] = useState(false)
  const [pillBg, setPillBg] = useState(['#1d1d2b'])
  const [usePillBorder, setUsePillBorder] = useState(false)
  const [pillBorder, setPillBorder] = useState('#ff5cc8')
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
          ? {
              glyphs: glyphs(emoji, 3),
              anim,
              ...(useAccent && { color: accent }),
              ...(phrase.trim().length >= 2 && { phrase: phrase.trim() }),
              ...(useWords && { textColors: wordColors, textAnim: wordAnim }),
              ...(font !== 'default' && { font }),
              ...(bold && { bold }),
              ...(italic && { italic }),
              ...(size !== 'normal' && { size }),
              ...(usePill && { bg: pillBg, ...(usePillBorder && { border: pillBorder }) }),
            }
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
  const [code, setCode] = useState<string | null>(null)
  const coded = code != null && kind !== 'sound_pack' ? codeToSpec(kind, code) : null
  const finalSpec = coded ? ('spec' in coded ? coded.spec : null) : spec
  const valid = kind === 'sound_pack' ? !!notify : !!parseSpec(kind, finalSpec)
  const preview = kind === 'sound_pack' ? undefined : specValue({ id: PREVIEW_ID, spec: finalSpec })

  const fill = (raw: unknown) => {
    if (kind === 'sound_pack') return
    const x = parseSpec(kind, raw) as Record<string, any> | null
    if (!x) return
    if (kind === 'name_effect') {
      setColors(x.colors)
      setAnim(x.anim)
      setSpeed(x.speed)
    } else if (kind === 'message_effect') {
      setMotion(x.motion)
      setEmoji(x.particles.join(' '))
      if (x.color) setAccent(x.color)
    } else if (kind === 'typing') {
      setEmoji(x.glyphs.join(' '))
      setAnim(x.anim)
      setUseAccent(!!x.color)
      if (x.color) setAccent(x.color)
      setPhrase(x.phrase ?? '')
      setUseWords(!!x.textColors)
      if (x.textColors) setWordColors(x.textColors)
      setWordAnim(x.textAnim ?? 'none')
      setFont(x.font ?? 'default')
      setBold(!!x.bold)
      setItalic(!!x.italic)
      setSize(x.size ?? 'normal')
      setUsePill(!!x.bg)
      if (x.bg) setPillBg(x.bg)
      setUsePillBorder(!!x.border)
      if (x.border) setPillBorder(x.border)
    } else {
      setColors(x.bg)
      setText(x.text)
      if (x.border) setBorder(x.border)
      if ('shape' in x) setShape(x.shape)
      if ('glow' in x) setGlow(x.glow)
      if (kind === 'bubble') {
        setBorderStyle(x.border ? x.borderStyle : 'none')
        setPattern(x.pattern)
        setAnim(x.anim)
      }
    }
  }
  const starters = FLAIR.filter((f) => f.kind === kind)

  const submit = async () => {
    setSaving(true)
    try {
      let body = finalSpec
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

        {kind !== 'sound_pack' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border p-0.5 text-[13px]">
              {(
                [
                  ['form', '🧩 Form'],
                  ['code', '</> Code'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={(code != null) === (m === 'code')}
                  onClick={() => {
                    if (m === 'code' && code == null)
                      setCode(specToCode(kind, parseSpec(kind, spec) ?? spec))
                    if (m === 'form' && code != null) {
                      if (coded && 'spec' in coded) fill(coded.spec)
                      setCode(null)
                    }
                  }}
                  className={cn(
                    'rounded-md px-3 py-1',
                    (code != null) === (m === 'code')
                      ? 'bg-accent-subtle font-semibold text-accent-text'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {code != null && (
              <>
                {starters.length > 0 && (
                  <Select
                    aria-label="Start from a Shop item"
                    className="w-auto"
                    value=""
                    onChange={(e) => {
                      const it = starters.find((f) => f.id === e.target.value)
                      if (it) setCode(specToCode(kind, it.spec))
                    }}
                  >
                    <option value="">Start from a Shop item…</option>
                    {starters.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(code)
                    toast.success('Code copied')
                  }}
                >
                  <Copy /> Copy
                </Button>
              </>
            )}
          </div>
        )}

        {code != null && kind !== 'sound_pack' ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              aria-label="Cosmetic code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              rows={Math.max(6, code.split('\n').length + 1)}
              className="w-full rounded-lg border border-border bg-bg-subtle p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-accent"
            />
            {coded && 'error' in coded ? (
              <p className="text-xs text-danger">⚠️ {coded.error}</p>
            ) : (
              <p className="text-xs text-success">✓ Looks good</p>
            )}
            <p className="text-2xs text-fg-subtle">
              One setting per line, like <code>anim: bounce</code>. Lists go with spaces between (
              <code>bg: #ff5cc8 #8052ff</code>), yes or no for switches, and lines starting with{' '}
              <code>{'//'}</code> are ignored. You can use: {codeFields(kind).join(', ')}. Pasting
              JSON works to.
            </p>
          </div>
        ) : (
          <>
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

            {kind === 'typing' && (
              <>
                <Field label="What it says after your name (leave empty for “is typing”)">
                  {(p) => (
                    <Input
                      {...p}
                      value={phrase}
                      maxLength={24}
                      placeholder="is cooking"
                      onChange={(e) => setPhrase(e.target.value)}
                      className="w-56"
                    />
                  )}
                </Field>
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <Toggle
                    id="cf-words"
                    label="Colour the words (pick 2 or 3 for a gradient)"
                    checked={useWords}
                    onChange={setUseWords}
                  />
                  {useWords && (
                    <div className="flex flex-wrap items-end gap-4">
                      <Colors value={wordColors} onChange={setWordColors} max={3} />
                      <Field label="Words animation">
                        {(p) => (
                          <Select
                            {...p}
                            className="w-auto"
                            value={wordAnim}
                            onChange={(e) => setWordAnim(e.target.value)}
                          >
                            {NAME_ANIMS.map((x) => (
                              <option key={x} value={x}>
                                {ANIM_LABEL[x] ?? x}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <Field label="Font">
                    {(p) => (
                      <Select
                        {...p}
                        className="w-auto"
                        value={font}
                        onChange={(e) => setFont(e.target.value)}
                      >
                        {PROFILE_FONTS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Size">
                    {(p) => (
                      <Select
                        {...p}
                        className="w-auto"
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                      >
                        <option value="small">Small</option>
                        <option value="normal">Normal</option>
                        <option value="big">Big</option>
                      </Select>
                    )}
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Toggle id="cf-bold" label="Bold" checked={bold} onChange={setBold} />
                  <Toggle id="cf-italic" label="Italic" checked={italic} onChange={setItalic} />
                </div>
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <Toggle
                    id="cf-pill"
                    label="Put it in a pill"
                    checked={usePill}
                    onChange={setUsePill}
                  />
                  {usePill && (
                    <div className="flex flex-wrap items-center gap-4">
                      <Colors value={pillBg} onChange={setPillBg} max={2} />
                      <Toggle
                        id="cf-pill-border"
                        label="Border"
                        checked={usePillBorder}
                        onChange={setUsePillBorder}
                      />
                      {usePillBorder && (
                        <Color
                          label="Pill border colour"
                          value={pillBorder}
                          onChange={setPillBorder}
                        />
                      )}
                    </div>
                  )}
                </div>
              </>
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
          </>
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
