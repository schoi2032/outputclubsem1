import { channel, ephemeral, type PluginImpl, type Translator } from './types'

const LANGS: Record<string, string> = {
  english: 'en',
  korean: 'ko',
  japanese: 'ja',
  chinese: 'zh-CN',
  'chinese-traditional': 'zh-TW',
  taiwanese: 'zh-TW',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
  arabic: 'ar',
  hindi: 'hi',
  vietnamese: 'vi',
  thai: 'th',
  indonesian: 'id',
  turkish: 'tr',
  dutch: 'nl',
  polish: 'pl',
  swedish: 'sv',
  ukrainian: 'uk',
  hebrew: 'he',
  greek: 'el',
  filipino: 'tl',
  tagalog: 'tl',
  malay: 'ms',
}

const HELP = [
  '**Translate**',
  '- `/translate ko Good morning team` shows the translation to you',
  '- `/translate ko! Good morning team` posts it to the channel',
  '- Use a language code (ko, ja, es, fr…) or a name (korean, japanese…)',
].join('\n')

export const translate: PluginImpl = {
  async command(deps, input) {
    const m = /^(\S+?)(!?)\s+([\s\S]+)$/.exec(input.text.trim())
    if (!m) return ephemeral(HELP)
    const raw = m[1]!.toLowerCase()
    const target = LANGS[raw] ?? (/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(raw) ? raw : null)
    if (!target) return ephemeral(`I don't know the language “${m[1]}”.\n${HELP}`)
    if (!deps.translate) return ephemeral('Translation is not set up on this server yet.')
    let out: string
    try {
      out = await deps.translate(m[3]!.slice(0, 2000), target)
    } catch (e) {
      return ephemeral(`Translation failed: ${(e as Error).message}`)
    }
    return m[2] ? channel(`🌐 ${out}\n— translated for ${input.user.name}`) : ephemeral(`🌐 ${out}`)
  },
}

/**
 * Google Cloud Translation (v2). On Cloud Run the service account's token comes from the
 * metadata server; elsewhere set GOOGLE_TRANSLATE_API_KEY.
 */
export function googleTranslator(opts: { apiKey?: string; metadata?: boolean }): Translator | null {
  if (!opts.apiKey && !opts.metadata) return null
  let cached: { token: string; until: number } | null = null
  const auth = async (): Promise<Record<string, string>> => {
    if (opts.apiKey) return { 'x-goog-api-key': opts.apiKey }
    if (!cached || cached.until < Date.now()) {
      const r = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-account/default/token',
        { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(3000) },
      )
      if (!r.ok) throw new Error('no service account token')
      const j = (await r.json()) as { access_token: string; expires_in: number }
      cached = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 }
    }
    return { authorization: `Bearer ${cached.token}` }
  }
  return async (text, target) => {
    const res = await fetch('https://translation.googleapis.com/language/translate/v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ q: text, target, format: 'text' }),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) throw new Error(res.status === 400 ? 'unknown language' : `error ${res.status}`)
    const j = (await res.json()) as { data: { translations: { translatedText: string }[] } }
    return j.data.translations[0]?.translatedText ?? ''
  }
}
