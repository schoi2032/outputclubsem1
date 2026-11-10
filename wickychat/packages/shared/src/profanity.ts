/**
 * WickyChat swear filter. Every message is run through this on the server before it is
 * saved, so swears are replaced with asterisks for everyone.
 *
 * The word list started from Output Club's "bad words" list, minus the everyday words in it
 * (baby, dog, fish, nobody...) that would have censored normal chat.
 *
 * It catches common disguises: CAPS, l33t letters (sh1t, @ss, $hit), stretched letters
 * (fuuuuck), and symbols or dots between letters (f.u.c.k, s-h-i-t).
 */

/** Matched anywhere inside a word ("fucking", "bullshit", "motherfucker"). */
const ROOTS = [
  'fuck',
  'fuk',
  'fck',
  'fcuk',
  'phuck',
  'shit',
  'cunt',
  'bitch',
  'biatch',
  'nigger',
  'nigga',
  'niggah',
  'faggot',
  'fagot',
  'whore',
  'asshole',
  'dickhead',
  'cocksuck',
  'jizz',
  'dildo',
  'wank',
  'pussy',
  'pussies',
  'retard',
  'blowjob',
  'handjob',
  'rimjob',
  'masturbat',
  'porn',
  'tranny',
  'bollock',
  'bastard',
  'douche',
  'skank',
  'twat',
  'clit',
  'boner',
  'jackass',
  'dumbass',
  'fatass',
  'smartass',
  'badass',
  'kike',
  'raghead',
  'towelhead',
  'wetback',
  'spunk',
  'pedophile',
  'paedophile',
  'rapist',
]

/** Matched only as a whole word, plus endings like -s, -ed, -ing, -er, -y ("tits", "pissed"). */
const WORDS = [
  'ass',
  'arse',
  'asses',
  'dick',
  'cock',
  'cum',
  'tit',
  'titty',
  'titties',
  'boob',
  'booby',
  'prick',
  'piss',
  'slut',
  'fag',
  'rape',
  'raping',
  'penis',
  'vagina',
  'vulva',
  'dyke',
  'chink',
  'spic',
  'coon',
  'gook',
  'damn',
  'crap',
  'cuck',
  'hoe',
  'thot',
  'milf',
  'nude',
  'nudes',
  'sexy',
  'horny',
  'orgasm',
  'orgy',
  'semen',
  'scrotum',
  'testicle',
  'anal',
  'anus',
  'butthole',
  'turd',
  'knob',
  'bellend',
  'tosser',
  'wanker',
  'stfu',
  'wtf',
  'af',
]

/** Multi-word phrases, matched across spaces. */
const PHRASES = [
  'son of a bitch',
  'blow job',
  'hand job',
  'jerk off',
  'jack off',
  'piece of shit',
  'eat my ass',
  'suck my',
  'kys',
  'kill yourself',
]

/** Real words that happen to contain a root. */
const ALLOWED = [
  'scunthorpe',
  'shiitake',
  'shitake',
  'cocktail',
  'cockpit',
  'cockroach',
  'peacock',
  'hancock',
  'hitchcock',
  'dickens',
  'dickinson',
  'prickly',
  'bassist',
  'class',
  'classic',
  'grass',
  'glass',
  'pass',
  'mass',
  'brass',
  'assess',
  'assessment',
  'assignment',
  'assist',
  'assistant',
  'assume',
  'embarrass',
  'passion',
  'compass',
  'analysis',
  'analyst',
  'analog',
  'canal',
  'banal',
  'document',
  'cucumber',
  'circumstance',
  'title',
  'titanic',
  'titan',
  'constitution',
  'competition',
  'repetition',
  'therapist',
  'grape',
  'scrape',
  'drape',
  'skunk',
  'knobs',
  'sussex',
  'essex',
  'middlesex',
  'shoe',
  'retardant',
  'pornography',
]

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '+': 't',
  '8': 'b',
  '9': 'g',
  '€': 'e',
}

/** "fuck" -> /f+u+c+k+/ so stretched letters still match. */
const stretch = (w: string) =>
  w
    .split('')
    .map((c) => `${c}+`)
    .join('')

const ENDINGS = '(?:s|es|ed|er|ers|ing|in|y|ie|ies|z)?'
const ROOT_RE = new RegExp(ROOTS.map(stretch).join('|'))
const WORD_RE = new RegExp(`^(?:${WORDS.map(stretch).join('|')})${ENDINGS}$`)
const ALLOWED_SET = new Set(ALLOWED)

/** Lowercase, undo l33t, drop everything that isn't a letter. */
function normalize(word: string) {
  let out = ''
  for (const ch of word.toLowerCase()) {
    const c = LEET[ch] ?? ch
    if (c >= 'a' && c <= 'z') out += c
  }
  return out
}

export function isSwear(word: string) {
  const w = normalize(word)
  if (w.length < 2) return false
  if (ALLOWED_SET.has(w) || ALLOWED_SET.has(w.replace(/(es|s|ed|ing)$/, ''))) return false
  return WORD_RE.test(w) || ROOT_RE.test(w)
}

const stars = (s: string) => s.replace(/[^\s]/g, '*')

const PHRASE_RES = PHRASES.map(
  (p) => new RegExp(`\\b${p.split(' ').map(stretch).join('[\\s._-]+')}\\b`, 'gi'),
)

/**
 * Replaces swears in plain text with asterisks, keeping punctuation around them.
 * Returns the cleaned text and how many words were hidden.
 */
export function censorText(text: string): { text: string; hits: number; words: string[] } {
  let hits = 0
  const words: string[] = []
  let out = text
  for (const re of PHRASE_RES) {
    out = out.replace(re, (m) => {
      hits++
      words.push(m)
      return stars(m)
    })
  }
  // Join "f u c k" / "f.u.c.k" style spelling (single letters split by spaces or dots).
  out = out.replace(/\b(?:[a-z0-9@$!][\s.*_-]){2,}[a-z0-9@$!]\b/gi, (m) => {
    if (!isSwear(m)) return m
    hits++
    words.push(m)
    return stars(m)
  })
  out = out.replace(/[^\s]+/g, (token) => {
    const match = token.match(/^([^\p{L}\p{N}@$!|]*)(.*?)([^\p{L}\p{N}@$|]*)$/u)
    const [, before = '', core = token, after = ''] = match ?? []
    if (!core || !isSwear(core)) return token
    hits++
    words.push(core)
    return before + '*'.repeat(Math.max(core.length, 3)) + after
  })
  return { text: out, hits, words }
}

type AnyNode = { type?: string; text?: string; content?: AnyNode[]; [k: string]: unknown }

/**
 * Censors every text node inside a rich-text document (code blocks included), and reports
 * which words were hidden so they can be logged for teachers.
 */
export function censorDocReport<T>(doc: T): { doc: T; words: string[] } {
  const words: string[] = []
  const walk = (n: AnyNode): AnyNode => {
    const next: AnyNode = { ...n }
    if (typeof n.text === 'string') {
      const r = censorText(n.text)
      next.text = r.text
      words.push(...r.words)
    }
    if (Array.isArray(n.content)) next.content = n.content.map(walk)
    return next
  }
  return { doc: walk(doc as AnyNode) as T, words }
}

/** Censors every text node inside a rich-text document (code blocks included). */
export function censorDoc<T>(doc: T): T {
  return censorDocReport(doc).doc
}
