const ME = 'daniel'

const defaults = {
  theme: 'dark',
  accent: '#0dbd8b',
  layout: 'modern',
  fontSize: 15,
  avatars: true,
  compactList: false,
  time24: false,
  receipts: true,
  events: true,
  previews: true,
  enterSends: true,
  showIds: false,
  censorStyle: 'dots',
  blurStickers: false,
  reduceMotion: false,
  underlineLinks: false,
  sounds: true,
  notifyAll: true,
  notifyMentions: true,
  quietHours: false,
  status: 'online',
  displayName: 'Daniel Cho'
}

let settings = { ...defaults }
try { settings = { ...defaults, ...JSON.parse(localStorage.getItem('wicky.settings') || '{}') } } catch (e) {}

function saveSettings() {
  try { localStorage.setItem('wicky.settings', JSON.stringify(settings)) } catch (e) {}
}

const people = {
  daniel: { name: 'Daniel Cho', role: 'student', color: '#368bd6', note: 'Grade 10' },
  jun: { name: 'Jun Park', role: 'student', color: '#ac3ba8', note: 'Grade 10' },
  mina: { name: 'Mina Kim', role: 'student', color: '#e64f7a', note: 'Grade 10' },
  sora: { name: 'Sora Lee', role: 'student', color: '#ff812d', note: 'Grade 11' },
  ethan: { name: 'Ethan Choi', role: 'student', color: '#2dc2c5', note: 'Grade 11' },
  hana: { name: 'Hana Yoon', role: 'student', color: '#5c56f5', note: 'Grade 9' },
  yuna: { name: 'Yuna Seo', role: 'student', color: '#74d12c', note: 'Grade 12' },
  park: { name: 'Ms. Park', role: 'teacher', color: '#0dbd8b', note: 'Biology' },
  lee: { name: 'Mr. Lee', role: 'teacher', color: '#ff812d', note: 'Robotics advisor' },
  choi: { name: 'Ms. Choi', role: 'teacher', color: '#ac3ba8', note: 'Output Club advisor' },
  kang: { name: 'Mr. Kang', role: 'teacher', color: '#368bd6', note: 'Dean of students' },
  wicky: { name: 'WICKYpedia', role: 'ai', color: '#5c56f5', note: 'School AI' }
}

const servers = [
  { id: 'ci', name: 'CI Upper School', short: 'CI', color: '#0dbd8b', owner: 'kang', size: 412, about: 'Official school server. Announcements, help and lost and found.' },
  { id: 'output', name: 'Output Club', short: 'OC', color: '#5c56f5', owner: 'choi', size: 18, about: 'The club that builds Wicky. Come say hi.' },
  { id: 'robotics', name: 'Robotics', short: 'RB', color: '#ff812d', owner: 'lee', size: 24, about: 'Build team, parts orders and competition prep.' },
  { id: 'bio', name: 'Bio 10', short: 'B10', color: '#74d12c', owner: 'park', size: 26, about: 'Ms. Park\'s Biology 10 class.' }
]

const exploreList = [
  { id: 'debate', name: 'Debate Society', short: 'DS', color: '#e64f7a', owner: 'kang', size: 31, about: 'Practice rounds every Monday in 2210.' },
  { id: 'art', name: 'Art Club', short: 'AC', color: '#2dc2c5', owner: 'choi', size: 22, about: 'Sketch nights and the Wicky sticker workshop.' }
]

let seq = 4100
const nid = () => 'WK-' + (++seq)

function msg(by, text, t, extra = {}) {
  return { id: nid(), by, text, t, day: 'Today', reacts: {}, ...extra }
}

const rooms = [
  {
    id: 'notes', kind: 'self', name: 'Notes to self', members: [ME], topic: 'Only you can see this',
    msgs: [
      msg(ME, 'bio lab report due thursday 3:15', '07:40'),
      msg(ME, 'robotics friday in 3204', '07:41'),
      msg(ME, 'ask ms park about the extra credit thing', '07:41')
    ]
  },
  {
    id: 'wiki', kind: 'ai', name: 'WICKYpedia', members: [ME, 'wicky'], topic: 'Ask anything about CI',
    msgs: [
      msg('wicky', 'Hey! I\'m WICKYpedia. Ask me about rooms, clubs, the bell schedule or school rules. Everything I write is tagged as AI.', '07:00', { ai: true, chips: ['Where is room 3204?', 'When is lunch?', 'What clubs are there?', 'Phone rules?'] })
    ]
  },
  {
    id: 'bio-lab', kind: 'group', name: 'Bio lab group', members: [ME, 'jun', 'mina'], creator: 'jun', topic: 'Thursday lab report', unread: 2, seenBy: ['jun', 'mina'],
    msgs: [
      { ev: true, day: 'Yesterday', id: nid(), items: [{ who: 'jun', what: 'created the chat' }, { who: 'mina', what: 'joined' }, { who: ME, what: 'joined' }] },
      msg('jun', 'did anyone finish the lab report', '09:12'),
      msg('mina', 'nope lol its due thursday right?', '09:13', { reacts: { '😂': ['jun'] } }),
      msg(ME, 'yeah thursday 3:15, its on the class page', '09:14', { reacts: { '🙏': ['mina', 'jun'] } }),
      msg('jun', 'this unit is so •••• hard', '09:16', { censored: 1 }),
      msg('mina', '', '09:16', { sticker: 'sleepy' }),
      msg('jun', 'ok who wants to do the graphs', '09:18')
    ]
  },
  {
    id: 'dm-sora', kind: 'dm', name: 'Sora Lee', members: [ME, 'sora'], creator: 'sora', seenBy: ['sora'],
    msgs: [
      msg('sora', 'u going to the club fair?', '12:40'),
      msg(ME, 'ya, output club booth by the gym', '12:41'),
      msg('sora', '', '12:41', { sticker: 'party' })
    ]
  },
  {
    id: 'dm-park', kind: 'dm', name: 'Ms. Park', members: [ME, 'park'], topic: 'Biology',
    msgs: [
      msg(ME, 'Hi Ms. Park, is the extra credit worksheet still open?', '08:20'),
      msg('park', 'Yes until Friday. Drop it in the tray on my desk.', '08:31')
    ]
  },
  {
    id: 'ci-announce', kind: 'room', server: 'ci', name: 'announcements', topic: 'Only teachers can post here', readonly: true, unread: 1,
    msgs: [
      msg('kang', 'Club fair is this Thursday in the gym, 3:30 to 5:00. Every club gets a table!', '08:00', { day: 'Yesterday', reacts: { '🔥': ['sora', 'jun', 'hana'] } }),
      msg('kang', 'Reminder: Wicky is now the official student chat. Google Chat groups will be archived next week.', '07:50', { link: { site: 'ci.school', title: 'Moving to Wicky', desc: 'Why we are switching, how moderation works and what happens to old Google Chat groups.' } })
    ]
  },
  {
    id: 'ci-help', kind: 'room', server: 'ci', name: 'help-desk', topic: 'Questions about school stuff',
    msgs: [
      { ev: true, day: 'Today', id: nid(), items: [{ who: 'yuna', what: 'joined' }, { who: 'ethan', what: 'joined' }, { who: 'hana', what: 'changed their name' }] },
      msg('hana', 'does anyone know if the library is open after 5?', '10:02'),
      msg('kang', 'Until 6 on weekdays, @Hana.', '10:05')
    ]
  },
  {
    id: 'ci-lost', kind: 'room', server: 'ci', name: 'lost-and-found', topic: 'Lost something? Post it here',
    msgs: [msg('yuna', 'found a blue hydroflask in 2108, its at the front desk now', '11:20')]
  },
  {
    id: 'oc-general', kind: 'room', server: 'output', name: 'general', topic: 'Output Club hangout', unread: 3, mention: true,
    msgs: [
      msg('choi', 'Great work on the Wicky homepage everyone. The particle thing is wild.', '13:02', { reacts: { '❤️': ['jun', 'mina', ME], '🔥': ['sora'] } }),
      msg('jun', '@Daniel can you push the chat page tonight?', '13:10'),
      msg('mina', 'i drew 3 new stickers for the pack', '13:12')
    ]
  },
  {
    id: 'oc-design', kind: 'room', server: 'output', name: 'design', topic: 'Colors, fonts and mockups',
    msgs: [msg('mina', 'should light mode be pure white or slightly grey', '15:40'), msg('choi', 'Slightly grey for the sidebar, white for the chat. Easier on the eyes.', '15:44')]
  },
  {
    id: 'oc-stickers', kind: 'room', server: 'output', name: 'sticker-drafts', topic: 'Hand drawn only. No AI art.',
    msgs: [msg('mina', '', '16:01', { sticker: 'love' }), msg('hana', '', '16:03', { sticker: 'wave' })]
  },
  {
    id: 'rb-build', kind: 'room', server: 'robotics', name: 'build-team', topic: 'Friday sessions, room 3204',
    msgs: [
      msg('lee', 'Build session is moved to Room 3204 on Friday.', '16:20', { day: 'Yesterday' }),
      msg('ethan', 'can we get the new servos before then', '16:31', { day: 'Yesterday' }),
      msg('lee', 'Ordered. Should arrive wenesday.', '16:40', { day: 'Yesterday', reacts: { '🔥': ['ethan', ME] } })
    ]
  },
  {
    id: 'rb-parts', kind: 'room', server: 'robotics', name: 'parts', topic: 'What we have and what we need',
    msgs: [msg('ethan', 'we are out of M3 screws again', '14:00')]
  },
  {
    id: 'bio-q', kind: 'room', server: 'bio', name: 'questions', topic: 'Ask Ms. Park anything about the unit', unread: 1,
    msgs: [
      msg('park', 'Lab goggles tomorrow, no exceptions.', '08:02', { reacts: { '👍': ['sora', 'hana', 'jun'] } }),
      msg('sora', 'do we need the worksheet printed too?', '08:10'),
      msg('park', 'Yes please, printed.', '08:12'),
      msg('hana', 'Chapter 6 summary: cells copy their DNA in interphase, then split it evenly during mitosis.', '08:30', { ai: true })
    ]
  },
  {
    id: 'bio-labs', kind: 'room', server: 'bio', name: 'lab-groups', topic: 'Find your lab partners',
    msgs: [msg('park', 'Groups of 3. Post your group here by Wednesday.', '09:00')]
  }
]

const helpDesk = rooms.find(r => r.id === 'ci-help')
helpDesk.msgs[2].reply = helpDesk.msgs[1].id

const wickyAnswers = [
  { re: /room|where|3204|2108|floor|library/i, a: 'Rooms that start with 3 are on the third floor of the upper school building. 3204 is left out of the elevator, right next to the science lab.', src: 'CI campus map' },
  { re: /lunch|eat|cafeteria|food/i, a: 'Upper school lunch is 12:05 to 12:50 in the main cafeteria. Wednesday lunch starts early at 11:45 because of assembly.', src: 'Bell schedule' },
  { re: /club|join|activity/i, a: 'Some popular clubs: Robotics (Fri, 3204), Output Club (Tue, makers lab), Debate (Mon, 2210) and Art Club (Wed, art room). You can join their servers from Explore.', src: 'Activities office' },
  { re: /phone|rule|allowed|dress/i, a: 'Phones stay away in class unless your teacher says otherwise. On Wicky: be kind, no spam, and reports go to real people.', src: 'Student handbook' },
  { re: /schedule|bell|period|start|time/i, a: 'School starts at 8:00. Periods are 70 minutes with 10 minute breaks. Advisory is Monday and Thursday morning.', src: 'Bell schedule' }
]

const stickers = [
  { id: 'wave', label: 'hii', body: '#ffd166', mood: 'smile', prop: 'wave', artist: 'Mina K.' },
  { id: 'sleepy', label: 'so tired', body: '#a78bfa', mood: 'sleep', prop: 'zzz', artist: 'Jun P.' },
  { id: 'love', label: 'love it', body: '#fb7185', mood: 'heart', prop: '', artist: 'Mina K.' },
  { id: 'shock', label: 'WHAT', body: '#38bdf8', mood: 'shock', prop: '', artist: 'Hana Y.' },
  { id: 'cry', label: 'pain', body: '#818cf8', mood: 'cry', prop: '', artist: 'Ethan C.' },
  { id: 'party', label: 'lets go', body: '#4ade80', mood: 'smile', prop: 'confetti', artist: 'Sora L.' },
  { id: 'nerd', label: 'studying', body: '#fb923c', mood: 'glasses', prop: 'book', artist: 'Daniel C.' },
  { id: 'thumbs', label: 'bet', body: '#e2e8f0', mood: 'smile', prop: 'thumb', artist: 'Jun P.' }
]

function stickerSvg(s) {
  const eyes = {
    smile: '<circle cx="46" cy="66" r="5" fill="#111"/><circle cx="74" cy="66" r="5" fill="#111"/><circle cx="47.5" cy="64" r="1.6" fill="#fff"/><circle cx="75.5" cy="64" r="1.6" fill="#fff"/><path d="M52 78q8 8 16 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/>',
    sleep: '<path d="M40 67q6 4 12 0M68 67q6 4 12 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="60" cy="80" rx="4" ry="3" fill="#111"/>',
    heart: '<path d="M46 72l-7-7a4.2 4.2 0 0 1 7-4.6 4.2 4.2 0 0 1 7 4.6z M74 72l-7-7a4.2 4.2 0 0 1 7-4.6 4.2 4.2 0 0 1 7 4.6z" fill="#b91c1c"/><path d="M53 80q7 6 14 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/>',
    shock: '<circle cx="46" cy="64" r="7" fill="#fff" stroke="#111" stroke-width="3"/><circle cx="74" cy="64" r="7" fill="#fff" stroke="#111" stroke-width="3"/><circle cx="46" cy="64" r="3" fill="#111"/><circle cx="74" cy="64" r="3" fill="#111"/><ellipse cx="60" cy="82" rx="5" ry="6.5" fill="#111"/>',
    cry: '<path d="M39 64q7-5 14 0M67 64q7-5 14 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M42 70q-4 9 0 12q4-3 0-12zM78 70q-4 9 0 12q4-3 0-12z" fill="#7dd3fc"/><path d="M52 84q8-6 16 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/>',
    glasses: '<circle cx="46" cy="66" r="8.5" stroke="#111" stroke-width="3.5" fill="#fff"/><circle cx="74" cy="66" r="8.5" stroke="#111" stroke-width="3.5" fill="#fff"/><path d="M54.5 66h11" stroke="#111" stroke-width="3.5"/><circle cx="46" cy="67" r="3" fill="#111"/><circle cx="74" cy="67" r="3" fill="#111"/><path d="M55 82h10" stroke="#111" stroke-width="4" stroke-linecap="round"/>'
  }[s.mood]
  const props = {
    wave: `<path d="M100 70q12-8 10-26" stroke="#111" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M100 70q12-8 10-26" stroke="${s.body}" stroke-width="6" fill="none" stroke-linecap="round"/>`,
    zzz: '<text x="84" y="30" font-family="Inter" font-weight="700" font-size="18" fill="currentColor">z</text><text x="98" y="18" font-family="Inter" font-weight="700" font-size="12" fill="currentColor" opacity=".6">z</text>',
    confetti: '<rect x="12" y="24" width="7" height="7" fill="#facc15" transform="rotate(20 15 27)"/><rect x="98" y="30" width="7" height="7" fill="#f43f5e" transform="rotate(-20 101 33)"/><circle cx="24" cy="46" r="3.5" fill="#38bdf8"/><circle cx="98" cy="52" r="3.5" fill="#a78bfa"/><path d="M60 0l3 7-3 7-3-7z" fill="#facc15"/>',
    book: '<rect x="36" y="96" width="48" height="16" rx="2" fill="#fff" stroke="#111" stroke-width="3"/><path d="M60 96v16" stroke="#111" stroke-width="3"/>',
    thumb: '<circle cx="98" cy="38" r="15" fill="#0dbd8b" stroke="#111" stroke-width="3"/><path d="M91 39l5 5 9-10" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
  }[s.prop] || ''
  return `<svg class="stk-art" viewBox="0 0 120 120"><ellipse cx="60" cy="108" rx="30" ry="5" fill="#000" opacity=".18"/><path d="M60 14c4 0 7 2 9.5 6.5l34 62c5 9-1 19-11 19H27.5c-10 0-16-10-11-19l34-62C53 16 56 14 60 14z" fill="${s.body}" stroke="#111" stroke-width="4" stroke-linejoin="round"/><path d="M55 30 38 62" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>${eyes}${props}</svg>`
}

const swears = ['damn', 'hell', 'crap', 'shit', 'sht', 'fuck', 'fuk', 'fck', 'fuq', 'phuck', 'bitch', 'btch', 'biatch', 'ass', 'asshole', 'dick', 'cunt', 'pussy', 'bastard', 'whore', 'slut', 'wtf', 'stfu', 'dumbass', 'jackass']
const swearRoots = ['fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'motherf', 'asshole']
const slurPattern = /^(n+i+g{2,}(?!l|ard)|n+i+g+(a|ah|uh|az|as)s?$|f+a+g{1,2}(o+t+)?s?$|f+a+g+o+t|r+e+t+a+r+d|t+r+a+n+n+(y|ie)|k+i+k+e+s?$|c+h+i+n+k+s?$|s+p+i+c+s?$)/
const swearPattern = new RegExp('^(' + swears.join('|') + ')(s|es|ed|ing|in|er|ers|y|ty|z)?$')
const homoglyphs = { 'а': 'a', 'е': 'e', 'о': 'o', 'і': 'i', 'ı': 'i', 'с': 'c', 'р': 'p', 'х': 'x', 'у': 'y', 'к': 'k', 'ɡ': 'g', 'ս': 'u', 'ո': 'n', 'п': 'n' }
const leet = { '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '0': 'o', '9': 'g', '6': 'g', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b' }
const attacks = [
  { re: /\b(kill|hurt) (yo)?ur ?self\b|\bkys\b/i, why: 'Encouraging self harm' },
  { re: /\b(you'?re|ur|u r) (so |such an? |actually )*(ugly|fat|worthless|dumb|stupid|loser|freak)\b/i, why: 'Insulting someone' },
  { re: /\b(nobody|no one) (likes|wants) (you|u)\b|\beveryone hates (you|u)\b/i, why: 'Bullying' },
  { re: /\bi('?m| am)? ?(gonna|going to) (beat|hit|hurt|kill) (you|u)\b/i, why: 'Threat' }
]

function flatten(word) {
  return [...word.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()]
    .map(ch => homoglyphs[ch] || leet[ch] || ch)
    .join('')
    .replace(/[^a-z]/g, '')
}

function looksBad(w) {
  if (!w) return false
  const forms = [w, w.replace(/(.)\1+/g, '$1$1'), w.replace(/(.)\1+/g, '$1')]
  return forms.some(f => slurPattern.test(f) || swearPattern.test(f) || swearRoots.some(r => f.startsWith(r)))
}

function badRanges(text) {
  const words = []
  text.replace(/\S+/g, (w, at) => { words.push({ w, at, flat: flatten(w) }) })
  const hits = []
  const cover = (a, b) => hits.push([words[a].at, words[b].at + words[b].w.length])
  for (let i = 0; i < words.length; i++) {
    if (looksBad(words[i].flat)) cover(i, i)
    else if (words[i + 1] && slurPattern.test(words[i].flat + words[i + 1].flat)) cover(i, i + 1)
  }
  for (let i = 0; i < words.length;) {
    let j = i
    while (j < words.length && words[j].flat.length >= 1 && words[j].flat.length <= 2) j++
    if (j - i >= 3) {
      const joined = words.slice(i, j).map(x => x.flat).join('')
      for (let k = 0; k < joined.length; k++) {
        if (looksBad(joined.slice(k))) { cover(i, j - 1); break }
      }
    }
    i = j > i ? j : i + 1
  }
  return hits
}

function hideRanges(text, ranges) {
  const hidden = new Set()
  ranges.forEach(([a, b]) => { for (let i = a; i < b; i++) hidden.add(i) })
  let out = ''
  let groups = 0
  let inside = false
  for (let i = 0; i < text.length; i++) {
    if (hidden.has(i)) {
      if (!inside) groups++
      inside = true
      if (!/\s/.test(text[i])) out += '•'
    } else {
      inside = false
      out += text[i]
    }
  }
  return { text: out, count: groups }
}

function spanRanges(text, spans) {
  const out = []
  ;(spans || []).forEach(s => {
    if (!s) return
    let i = text.indexOf(s)
    while (i !== -1) {
      out.push([i, i + s.length])
      i = text.indexOf(s, i + s.length)
    }
  })
  return out
}

async function askModerator(text) {
  if (location.protocol === 'file:') return null
  try {
    const res = await fetch('/api/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(9000)
    })
    return res.ok ? await res.json() : null
  } catch (e) {
    return null
  }
}

const view = {
  space: 'home',
  room: 'bio-lab',
  filter: null,
  info: window.innerWidth > 1200,
  replyTo: null,
  aiTag: false,
  tray: null,
  inboxQuery: '',
  expanded: new Set(),
  settingsTab: 'appearance'
}

const $ = sel => document.querySelector(sel)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const room = id => rooms.find(r => r.id === id)
const server = id => servers.find(s => s.id === id)
const isTeacher = id => !!people[id] && people[id].role === 'teacher'
const firstName = id => people[id].role === 'student' ? people[id].name.split(' ')[0] : people[id].name

function ic(name, size = 18, cls = '') {
  const key = name.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('')
  const node = window.lucide && window.lucide.icons[key]
  if (!node) return ''
  const inner = node[2].map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')
  return `<svg class="i ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}

function avatar(id, size = 32, extra = '') {
  const p = people[id]
  if (p.role === 'ai') return `<span class="av av-ai ${extra}" style="--s:${size}px">${ic('sparkles', size * 0.5)}</span>`
  const letter = p.name.replace(/^(Ms\.|Mr\.)\s*/, '')[0]
  return `<span class="av ${p.role === 'teacher' ? 'av-teacher' : ''} ${extra}" style="--s:${size}px;background:${p.color}">${letter}</span>`
}

function members(r) {
  if (r.kind === 'room') return Object.keys(people).filter(id => people[id].role !== 'ai')
  return r.members
}

function hasTeacher(r) {
  return r.kind === 'room' || members(r).some(isTeacher)
}

function owner(r) {
  if (r.kind === 'room') return server(r.server).owner
  return members(r).find(isTeacher) || r.creator || ME
}

function students(r) {
  return members(r).filter(id => people[id].role === 'student').length
}

function roomAvatar(r, size = 32) {
  if (r.kind === 'dm') return avatar(r.members.find(x => x !== ME), size)
  if (r.kind === 'self') return `<span class="av av-room" style="--s:${size}px;background:#5c56f5">${ic('notebook-pen', size * 0.5)}</span>`
  if (r.kind === 'ai') return avatar('wicky', size)
  if (r.kind === 'room') {
    const s = server(r.server)
    return `<span class="av av-room" style="--s:${size}px;background:${s.color}">${r.readonly ? ic('megaphone', size * 0.48) : ic('hash', size * 0.48)}</span>`
  }
  const others = r.members.filter(x => x !== ME).slice(0, 2)
  return `<span class="av-stack" style="--s:${size}px">${others.map(o => avatar(o, Math.round(size * 0.7))).join('')}</span>`
}

function fmtTime(t) {
  if (settings.time24 || !/^\d/.test(t)) return t
  let [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

function nowTime() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function richText(t) {
  const glyph = { dots: '•', stars: '*', blocks: '█' }[settings.censorStyle] || '•'
  return esc(t)
    .replace(/•+/g, m => settings.censorStyle === 'zip' ? '<span class="bleep">🤐</span>' : `<span class="bleep">${glyph.repeat(m.length)}</span>`)
    .replace(/@(\w+)/g, (m, n) => `<span class="pill-mention ${n.toLowerCase() === firstName(ME).toLowerCase() ? 'me' : ''}">@${n}</span>`)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
}

function visibleRooms() {
  let list = view.space === 'home' || view.space === 'inbox' ? rooms.filter(r => r.kind !== 'room' || servers.some(s => s.id === r.server)) : rooms.filter(r => r.server === view.space)
  if (view.filter === 'unread') list = list.filter(r => r.unread)
  if (view.filter === 'people') list = list.filter(r => ['dm', 'group', 'self'].includes(r.kind))
  if (view.filter === 'rooms') list = list.filter(r => r.kind === 'room')
  if (view.filter === 'teachers') list = list.filter(r => r.kind !== 'room' && hasTeacher(r))
  return list
}

function unreadIn(spaceId) {
  return rooms.filter(r => (spaceId === 'home' ? true : r.server === spaceId)).reduce((a, r) => a + (r.unread || 0), 0)
}

function renderSpaces() {
  const total = unreadIn('home')
  $('#spaces').innerHTML = `
    <button class="me-btn" data-act="settings" data-tab="account" title="${esc(settings.displayName)}">
      ${avatar(ME, 34)}<span class="presence ${settings.status}"></span>
    </button>
    <button class="space ${view.space === 'home' || view.space === 'inbox' ? 'on' : ''}" data-space="home" title="Home">
      <span class="space-tile home-tile">${ic('house', 20)}</span>
      ${total ? `<span class="space-badge">${total}</span>` : ''}
    </button>
    <div class="space-line"></div>
    ${servers.map(s => {
      const u = unreadIn(s.id)
      return `
      <button class="space ${view.space === s.id ? 'on' : ''}" data-space="${s.id}" title="${esc(s.name)}">
        <span class="space-tile" style="background:${s.color}">${esc(s.short)}</span>
        ${u ? `<span class="space-badge ${rooms.some(r => r.server === s.id && r.mention) ? 'hot' : ''}">${u}</span>` : ''}
      </button>`
    }).join('')}
    <button class="space" data-act="new-server" title="Create a server"><span class="space-tile ghost">${ic('plus', 20)}</span></button>
    <button class="space" data-act="explore" title="Explore servers"><span class="space-tile ghost">${ic('compass', 20)}</span></button>
    <div class="grow"></div>
    <button class="rail-icon" data-act="inbox" title="Inbox">${ic('inbox', 20)}</button>
    <button class="rail-icon" data-act="settings" title="Settings">${ic('settings', 20)}</button>
  `
}

function roomRow(r) {
  const last = [...r.msgs].reverse().find(m => m.by && !m.pending)
  const preview = last ? (last.sticker ? 'sent a sticker' : last.text) : r.topic || ''
  const teacherPing = r.unread && last && isTeacher(last.by)
  const size = settings.compactList ? 24 : 32
  return `
    <button class="room-row ${view.room === r.id && view.space !== 'inbox' ? 'on' : ''} ${r.unread ? 'bold' : ''}" data-room="${r.id}">
      ${roomAvatar(r, size)}
      <span class="room-text">
        <span class="room-name">${r.kind === 'room' && view.space !== r.server ? `<span class="muted">${esc(server(r.server).short)} ·</span> ` : ''}${esc(r.name)}</span>
        ${settings.compactList ? '' : `<span class="room-prev">${last ? esc(firstName(last.by)) + ': ' : ''}${richText(preview)}</span>`}
      </span>
      ${r.mention ? `<span class="badge-at">${ic('at-sign', 12)}</span>` : ''}
      ${r.unread ? `<span class="badge-count ${teacherPing ? 'prio' : ''}">${teacherPing ? ic('zap', 10) : ''}${r.unread}</span>` : ''}
    </button>`
}

function renderRooms() {
  const s = server(view.space)
  const list = visibleRooms()
  const groups = s
    ? [['Rooms', list]]
    : [
        ['Pinned', list.filter(r => r.kind === 'self' || r.kind === 'ai')],
        ['People', list.filter(r => r.kind === 'dm' || r.kind === 'group')],
        ['Server rooms', list.filter(r => r.kind === 'room')]
      ]
  const size = settings.compactList ? 24 : 32
  $('#rooms').innerHTML = `
    <div class="rooms-top">
      <button class="search-pill" data-act="palette">${ic('search', 16)}<span>Search</span><kbd>Ctrl K</kbd></button>
      <button class="round-btn" data-act="explore" title="Explore servers">${ic('compass', 18)}</button>
    </div>
    <div class="rooms-head">
      <div class="rooms-title">
        <h2>${s ? esc(s.name) : 'Home'}</h2>
        ${s ? `<span class="sub">${ic('crown', 12)} ${esc(people[s.owner].name)} · ${s.size} members</span>` : ''}
      </div>
      <button class="round-btn sm" data-act="${s ? 'server-info' : 'settings'}" title="More">${ic('ellipsis', 18)}</button>
      <button class="round-btn sm" data-act="new-chat" title="Start a chat">${ic('square-pen', 17)}</button>
    </div>
    ${s ? '' : `
    <div class="filters">
      ${[['unread', 'Unreads'], ['people', 'People'], ['rooms', 'Rooms'], ['teachers', 'Teachers']].map(([k, l]) => `<button class="chip ${view.filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>`}
    <div class="room-list">
      <button class="room-row ${view.space === 'inbox' ? 'on' : ''}" data-act="inbox">
        <span class="av av-room" style="--s:${size}px;background:var(--surface-3);color:var(--text)">${ic('inbox', size * 0.5)}</span>
        <span class="room-text"><span class="room-name">Inbox</span>${settings.compactList ? '' : '<span class="room-prev">Everything new, teachers first</span>'}</span>
      </button>
      ${groups.filter(g => g[1].length).map(([label, items]) => `
        <div class="group-label">${label}</div>
        ${items.map(roomRow).join('')}
      `).join('') || '<div class="empty-list">Nothing here</div>'}
    </div>
    <div class="rooms-foot">
      <span class="shield-ok">${ic('shield-check', 16)}</span>
      <span>Protected by Wicky AI<small>Swear filter, bullying checks and reports</small></span>
    </div>
  `
}

function eventRow(m) {
  const open = view.expanded.has(m.id)
  const summary = m.items.length > 2
    ? `${firstName(m.items[0].who)} and ${m.items.length - 1} others joined or changed their info`
    : m.items.map(x => `${firstName(x.who)} ${x.what}`).join(', ')
  return `
    <div class="event-row">
      <span class="event-avs">${m.items.slice(0, 3).map(x => avatar(x.who, 16)).join('')}</span>
      <span class="event-text">${open ? m.items.map(x => `<div>${esc(firstName(x.who))} ${esc(x.what)}</div>`).join('') : esc(summary)}</span>
      ${m.items.length > 1 ? `<button class="link-btn" data-act="expand" data-id="${m.id}">${open ? 'collapse' : 'expand'}</button>` : ''}
    </div>`
}

function messageRow(m, prev, r, isLast) {
  if (m.ev) return settings.events ? eventRow(m) : ''
  if (m.sys) return `<div class="sys-row ${m.tone || ''}">${ic(m.icon || 'shield', 15)}<span>${m.text}</span><span class="time">${fmtTime(m.t)}</span></div>`
  if (m.held) {
    return `
      <div class="held-card">
        <div class="held-head">${ic('shield-alert', 16)}<b>Held by Wicky AI</b><span class="tag tag-red">${esc(m.why)}</span><span class="time">${fmtTime(m.t)}</span></div>
        <p class="held-text">${esc(m.text)}</p>
        <p class="held-note">Only you can see this. It was not sent. A moderator can review it if you think Wicky got it wrong.</p>
        <div class="held-actions"><button class="btn-ghost sm" data-act="appeal" data-id="${m.id}">Ask for a review</button><button class="btn-ghost sm" data-act="dismiss" data-id="${m.id}">Dismiss</button></div>
      </div>`
  }
  const p = people[m.by]
  const mine = m.by === ME
  const cont = prev && prev.by === m.by && !prev.sys && !prev.held && !prev.ev && !m.reply
  const teacher = isTeacher(m.by)
  const kinds = Object.keys(m.reacts).filter(k => m.reacts[k].length)
  const quote = m.reply ? r.msgs.find(x => x.id === m.reply) : null
  const st = m.sticker && stickers.find(s => s.id === m.sticker)
  let body
  if (m.pending) {
    body = `<div class="checking"><span class="shimmer"></span><span class="checking-note">${ic('shield-check', 13)} Wicky AI is checking this message</span></div>`
  } else if (st) {
    body = `<button class="sticker ${m.gif ? 'gif gif-' + st.id : ''} ${settings.blurStickers ? 'blurred' : ''}" data-act="unblur">${stickerSvg(st)}${m.gif ? '<span class="gif-tag">GIF</span>' : ''}</button>`
  } else {
    body = `<div class="msg-text">${richText(m.text)}</div>`
  }
  return `
    <div class="msg ${cont ? 'cont' : ''} ${mine ? 'mine' : ''} ${teacher ? 'teacher' : ''} ${st ? 'has-sticker' : ''} ${m.fresh ? 'fresh' : ''}" data-id="${m.id}">
      <div class="msg-gutter">${cont || !settings.avatars ? `<span class="hover-time">${fmtTime(m.t)}</span>` : avatar(m.by, 32)}</div>
      <div class="msg-main">
        ${cont ? '' : `
          <div class="msg-head">
            <span class="sender" style="color:${p.color}">${esc(p.name)}</span>
            ${teacher ? `<span class="tag tag-teacher">${ic('zap', 10)} Teacher</span>` : ''}
            ${r.kind !== 'self' && r.kind !== 'ai' && owner(r) === m.by && teacher ? `<span class="tag">${ic('crown', 10)} Owner</span>` : ''}
            ${m.ai ? '<span class="tag tag-ai">AI generated</span>' : ''}
            <span class="time">${fmtTime(m.t)}</span>
            ${settings.showIds ? `<span class="msg-id">${m.id}</span>` : ''}
          </div>`}
        ${cont && m.ai ? '<span class="tag tag-ai">AI generated</span>' : ''}
        ${quote ? `<button class="quote" data-jump="${quote.id}"><span class="quote-who" style="color:${quote.by ? people[quote.by].color : ''}">${quote.by ? avatar(quote.by, 14) + ' ' + esc(people[quote.by].name) : ''}</span><span class="quote-text">${quote.sticker ? 'Sticker' : richText(quote.text || '')}</span></button>` : ''}
        <div class="msg-bubble">${body}</div>
        ${m.link && settings.previews ? `<div class="preview"><div class="preview-bar"></div><div><div class="preview-site">${esc(m.link.site)}</div><div class="preview-title">${esc(m.link.title)}</div><div class="preview-desc">${esc(m.link.desc)}</div></div></div>` : ''}
        ${m.censored ? `<div class="note">${ic('shield-check', 12)} ${m.censored} word${m.censored > 1 ? 's' : ''} hidden by Wicky${m.checkedBy === 'ai' ? ' AI' : ''}</div>` : ''}
        ${m.src ? `<div class="note">${ic('info', 12)} Source: ${esc(m.src)}</div>` : ''}
        ${m.chips ? `<div class="suggest">${m.chips.map(c => `<button class="chip" data-act="ask" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
        ${kinds.length ? `<div class="reacts">${kinds.map(k => `<button class="react ${m.reacts[k].includes(ME) ? 'mine' : ''}" data-act="react" data-id="${m.id}" data-e="${k}" title="${m.reacts[k].map(firstName).join(', ')}">${k}<b>${m.reacts[k].length}</b></button>`).join('')}<span class="react-cap">${kinds.length}/3</span></div>` : ''}
      </div>
      ${isLast && settings.receipts && r.seenBy && r.seenBy.length ? `<div class="receipts" title="Seen by ${r.seenBy.map(firstName).join(', ')}">${r.seenBy.map(id => avatar(id, 14)).join('')}</div>` : ''}
      ${m.pending ? '' : `
      <div class="msg-tools">
        <button data-act="pick-react" data-id="${m.id}" title="React">${ic('smile', 16)}</button>
        ${r.readonly && !isTeacher(ME) ? '' : `<button data-act="reply" data-id="${m.id}" title="Reply">${ic('reply', 16)}</button>`}
        <button data-act="copy-id" data-id="${m.id}" title="Copy message ID">${ic('copy', 16)}</button>
        ${!mine && p.role !== 'ai' ? `<button class="danger" data-act="report" data-id="${m.id}" title="Report">${ic('flag', 16)}</button>` : ''}
      </div>`}
    </div>`
}

function headerHtml(r) {
  const s = r.server && server(r.server)
  const mem = members(r)
  let sub = r.topic || ''
  if (r.kind === 'group' || r.kind === 'dm') sub = hasTeacher(r) ? `Owned by ${people[owner(r)].name} · no member limit` : `${students(r)}/3 students`
  return `
    <header class="room-head">
      <button class="round-btn mobile" data-act="drawer">${ic('menu', 18)}</button>
      ${roomAvatar(r, 34)}
      <div class="head-text">
        <h1>${s ? `<span class="muted">${esc(s.name)} /</span> ` : ''}${esc(r.name)}${r.kind !== 'self' ? `<span class="shield-ok" title="Moderated by Wicky AI">${ic('shield-check', 15)}</span>` : ''}</h1>
        <span class="head-sub">${esc(sub)}</span>
      </div>
      <div class="head-tools">
        <button class="round-btn" data-act="palette" title="Search">${ic('search', 18)}</button>
        <button class="round-btn ${view.info ? 'on' : ''}" data-act="toggle-info" title="Room info">${ic('info', 18)}</button>
        ${r.kind !== 'self' ? `<button class="facepile" data-act="toggle-info">${mem.slice(0, 3).map(id => avatar(id, 22)).join('')}<span>${r.kind === 'room' ? s.size : mem.length}</span></button>` : ''}
      </div>
    </header>`
}

function composerHtml(r) {
  if (r.readonly && !isTeacher(ME)) {
    return `<div class="composer-locked">${ic('lock', 15)} Only teachers can post in #${esc(r.name)}. You can still react and report.</div>`
  }
  const reply = view.replyTo && r.msgs.find(m => m.id === view.replyTo)
  const placeholder = r.kind === 'ai' ? 'Ask WICKYpedia something…' : r.kind === 'self' ? 'Write a note to yourself…' : 'Send a moderated message…'
  return `
    <div class="composer-zone">
      ${view.tray ? trayHtml() : ''}
      ${reply ? `<div class="reply-bar">${ic('reply', 14)} Replying to <b style="color:${people[reply.by].color}">${esc(people[reply.by].name)}</b><span class="reply-snip">${reply.sticker ? 'Sticker' : richText(reply.text)}</span><button class="round-btn xs" data-act="cancel-reply">${ic('x', 14)}</button></div>` : ''}
      <div class="warn-line" id="warn"></div>
      <div class="composer">
        <span class="composer-shield" title="Every message is checked by Wicky AI">${ic('shield-check', 17)}</span>
        <textarea id="input" rows="1" placeholder="${placeholder}"></textarea>
        <button class="round-btn ${view.tray === 'emoji' ? 'on' : ''}" data-act="tray" data-tray="emoji" title="Emoji">${ic('smile', 19)}</button>
        <button class="round-btn ${view.tray === 'stickers' || view.tray === 'gifs' ? 'on' : ''}" data-act="tray" data-tray="stickers" title="Stickers and GIFs">${ic('sticker', 19)}</button>
        <button class="round-btn ${view.aiTag ? 'on ai' : ''}" data-act="ai-tag" title="Mark as AI written">${ic('bot', 19)}</button>
        <button class="send-btn" data-act="send" title="Send">${ic('send-horizontal', 18)}</button>
      </div>
    </div>`
}

function trayHtml() {
  if (view.tray === 'emoji') return `<div class="tray tray-emoji"><emoji-picker class="${document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}"></emoji-picker></div>`
  const gifs = view.tray === 'gifs'
  return `
    <div class="tray">
      <div class="tray-tabs">
        <button class="${gifs ? '' : 'on'}" data-act="tray-tab" data-tray="stickers">Stickers</button>
        <button class="${gifs ? 'on' : ''}" data-act="tray-tab" data-tray="gifs">GIFs</button>
        <span class="tray-meta">Wicky pack · ${stickers.length} hand drawn</span>
      </div>
      <div class="tray-grid">
        ${stickers.map(s => `<button class="tray-item ${gifs ? 'gif gif-' + s.id : ''}" data-act="send-sticker" data-s="${s.id}" data-gif="${gifs ? 1 : ''}">${stickerSvg(s)}<span>${esc(s.label)}</span><small>by ${esc(s.artist)}</small></button>`).join('')}
      </div>
      <div class="tray-foot">${ic('hand', 13)} Every sticker is drawn by a real Output Club member. AI art is not allowed in the pack.</div>
    </div>`
}

function renderTimeline() {
  if (view.space === 'inbox') return renderInbox()
  const r = room(view.room)
  if (!r) return
  let html = ''
  let day = null
  let prev = null
  r.msgs.forEach((m, i) => {
    if (m.day && m.day !== day) {
      html += `<div class="day-sep"><span>${esc(m.day)}</span></div>`
      day = m.day
      prev = null
    }
    html += messageRow(m, prev, r, i === r.msgs.length - 1)
    prev = m
  })
  const intro = {
    self: 'Your private notebook. Links, reminders, half finished ideas. Nobody else can ever see this.',
    ai: 'WICKYpedia only answers from school info the club checked. If it does not know, it says so. Every reply is tagged as AI.',
    dm: hasTeacher(r) ? 'A teacher is in this chat, so they own it.' : 'Direct chats count toward the 3 student limit too.',
    group: hasTeacher(r) ? 'A teacher is here, so they own the chat and there is no member limit.' : 'Small chats stay small. Up to 3 students, or add a teacher to lift the limit.',
    room: r.server ? `Part of ${server(r.server).name}, owned by ${people[owner(r)].name}. Teacher owned servers have no member limit.` : ''
  }[r.kind]
  $('#timeline').innerHTML = `
    ${headerHtml(r)}
    <div class="scroller" id="scroller">
      <div class="room-intro">
        ${roomAvatar(r, 64)}
        <h2>${esc(r.name)}</h2>
        <p>${intro}</p>
      </div>
      ${html}
      <div class="typing" id="typing"></div>
    </div>
    ${composerHtml(r)}
  `
  r.msgs.forEach(m => { m.fresh = false })
  const sc = $('#scroller')
  sc.scrollTop = sc.scrollHeight
  loadEmoji()
}

function renderInbox() {
  const q = view.inboxQuery.trim().toLowerCase()
  const all = []
  rooms.forEach(r => r.msgs.forEach(m => { if (m.by && !m.pending && !m.held) all.push({ r, m }) }))
  const fromTeachers = all.filter(x => isTeacher(x.m.by)).sort((a, b) => +b.m.id.slice(3) - +a.m.id.slice(3)).slice(0, 4)
  const unread = rooms.filter(r => r.unread)
  const hits = q ? all.filter(x => (x.m.text || '').toLowerCase().includes(q) || x.r.name.toLowerCase().includes(q)) : []
  const hl = t => {
    const safe = richText(t)
    if (!q) return safe
    return safe.replace(new RegExp('(' + esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'ig'), '<mark>$1</mark>')
  }
  const line = x => `
    <button class="inbox-item ${isTeacher(x.m.by) ? 'prio' : ''}" data-room="${x.r.id}">
      ${avatar(x.m.by, 34)}
      <span class="inbox-body">
        <span class="inbox-top"><b style="color:${people[x.m.by].color}">${esc(people[x.m.by].name)}</b>${isTeacher(x.m.by) ? `<span class="tag tag-teacher">${ic('zap', 10)} Teacher</span>` : ''}<span class="muted">in ${esc(x.r.name)}</span><span class="time">${fmtTime(x.m.t)}</span></span>
        <span class="inbox-text">${x.m.sticker ? 'sent a sticker' : hl(x.m.text)}</span>
      </span>
      ${ic('arrow-right', 16, 'go')}
    </button>`
  $('#timeline').innerHTML = `
    <header class="room-head">
      <button class="round-btn mobile" data-act="drawer">${ic('menu', 18)}</button>
      <span class="av av-room" style="--s:34px;background:var(--surface-3);color:var(--text)">${ic('inbox', 18)}</span>
      <div class="head-text"><h1>Inbox</h1><span class="head-sub">${unread.reduce((a, r) => a + r.unread, 0)} unread across ${unread.length} chats</span></div>
    </header>
    <div class="scroller inbox">
      <div class="inbox-hero">
        <h2>Hey ${esc(settings.displayName.split(' ')[0])} 👋</h2>
        <p>Here is everything new. Teacher messages always come first.</p>
        <label class="big-search">${ic('search', 18)}<input id="inboxSearch" placeholder="Search every message and room" value="${esc(view.inboxQuery)}"><kbd>/</kbd></label>
      </div>
      ${q ? `
        <section><h3>${hits.length} result${hits.length === 1 ? '' : 's'}</h3>${hits.map(line).join('') || '<div class="empty-list">No matches. Try another word.</div>'}</section>
      ` : `
        <section><h3>${ic('zap', 14)} From teachers</h3>${fromTeachers.map(line).join('')}</section>
        <section><h3>Unread</h3>${unread.length ? unread.map(r => {
          const last = [...r.msgs].reverse().find(m => m.by)
          return last ? line({ r, m: last }) : ''
        }).join('') : '<div class="empty-list">All caught up ✓</div>'}</section>
        <section><h3>Your servers</h3><div class="server-cards">${servers.map(s => `
          <button class="server-card" data-space="${s.id}">
            <span class="space-tile" style="background:${s.color}">${esc(s.short)}</span>
            <b>${esc(s.name)}</b><span class="muted">${s.size} members · ${esc(people[s.owner].name)}</span>
          </button>`).join('')}</div></section>
      `}
    </div>`
  const input = $('#inboxSearch')
  input.addEventListener('input', () => {
    const pos = input.selectionStart
    view.inboxQuery = input.value
    renderInbox()
    const again = $('#inboxSearch')
    again.focus()
    again.setSelectionRange(pos, pos)
  })
}

function renderInfo() {
  $('#app').classList.toggle('info-open', view.info && view.space !== 'inbox')
  const r = room(view.room)
  if (!r || view.space === 'inbox') { $('#info').innerHTML = ''; return }
  const s = r.server && server(r.server)
  const mem = members(r)
  const canAdd = r.kind === 'group' || r.kind === 'dm'
  const rule = r.kind === 'self'
    ? 'Private. Only you can see it.'
    : r.kind === 'ai'
      ? 'Answers only from checked school info. Every reply is tagged AI.'
      : hasTeacher(r)
        ? `${people[owner(r)].name} is a teacher, so they own this ${s ? 'server' : 'chat'} and the 3 student limit does not apply.`
        : 'Up to 3 students. Add a teacher to lift the limit. The teacher becomes the owner.'
  const shown = r.kind === 'room' ? mem.filter(isTeacher).concat(mem.filter(id => !isTeacher(id)).slice(0, 6)) : mem
  $('#info').innerHTML = `
    <div class="info-head"><b>Room info</b><button class="round-btn sm" data-act="toggle-info">${ic('x', 18)}</button></div>
    <div class="info-scroll">
      <div class="info-hero">${roomAvatar(r, 72)}<h3>${esc(r.name)}</h3><p>${esc(r.topic || '')}</p></div>
      <div class="info-card">
        <div class="card-label">${ic('shield-check', 14)} Rules for this ${s ? 'room' : 'chat'}</div>
        <p>${esc(rule)}</p>
        ${!hasTeacher(r) && r.kind !== 'self' && r.kind !== 'ai' ? `<div class="seats">${[0, 1, 2].map(i => `<span class="${i < students(r) ? 'taken' : ''}"></span>`).join('')}</div><small>${students(r)} of 3 student seats used</small>` : ''}
      </div>
      <div class="card-label pad">People <span class="muted">${r.kind === 'room' ? s.size : mem.length}</span></div>
      <div class="people">
        ${shown.map(id => `
          <div class="person">
            ${avatar(id, 30)}
            <span class="person-text"><span>${esc(people[id].name)}${id === ME ? ' <span class="muted">(you)</span>' : ''}</span><small>${esc(people[id].note)}</small></span>
            ${owner(r) === id && r.kind !== 'self' && r.kind !== 'ai' ? `<span class="owner-crown" title="Owner">${ic('crown', 15)}</span>` : ''}
            ${id !== ME && people[id].role !== 'ai' ? `<button class="round-btn xs danger" data-act="report-user" data-u="${id}" title="Report user">${ic('flag', 13)}</button>` : ''}
          </div>`).join('')}
        ${r.kind === 'room' && s.size > shown.length ? `<div class="muted more">and ${s.size - shown.length} more</div>` : ''}
      </div>
      ${canAdd ? `
        <div class="card-label pad">Invite</div>
        <div class="people">
          ${Object.keys(people).filter(id => !mem.includes(id) && people[id].role !== 'ai').map(id => `
            <button class="person invite" data-act="invite" data-u="${id}">${avatar(id, 26)}<span class="person-text"><span>${esc(people[id].name)}</span><small>${esc(people[id].note)}</small></span>${ic('plus', 16)}</button>`).join('')}
        </div>` : ''}
      <div class="info-card">
        <div class="card-label">${ic('sparkles', 14)} Wicky AI is protecting this chat</div>
        <ul class="checks">
          <li>${ic('check', 14)} Swear words and slurs hidden, even sneaky spellings</li>
          <li>${ic('check', 14)} Bullying and threats held for review</li>
          <li>${ic('check', 14)} Same message 3 times in a row gets blocked</li>
          <li>${ic('check', 14)} Max 3 kinds of reactions per message</li>
        </ul>
      </div>
    </div>`
}

function renderAll() {
  applySettings()
  renderSpaces()
  renderRooms()
  renderTimeline()
  renderInfo()
}

function openRoom(id) {
  const r = room(id)
  if (!r) return
  view.room = id
  if (view.space === 'inbox' || (view.space !== 'home' && r.server !== view.space)) view.space = r.server || 'home'
  r.unread = 0
  r.mention = false
  view.replyTo = null
  view.tray = null
  document.body.classList.remove('drawer-open')
  renderAll()
  if (window.innerWidth > 800) setTimeout(() => { const i = $('#input'); if (i) i.focus() }, 20)
}

function openSpace(id) {
  view.space = id
  view.filter = null
  if (id !== 'home') {
    const first = rooms.find(r => r.server === id)
    if (first) view.room = first.id
  }
  openRoom(view.room)
}

function repeatCount(r, text) {
  let n = 0
  for (let i = r.msgs.length - 1; i >= 0; i--) {
    const m = r.msgs[i]
    if (!m.by || m.held) continue
    if (m.by !== ME) break
    if ((m.raw || m.text).trim().toLowerCase() === text.trim().toLowerCase()) n++
    else break
  }
  return n
}

async function send(text) {
  const r = room(view.room)
  text = (text || '').trim()
  if (!text) return
  if (repeatCount(r, text) >= 2) {
    r.msgs.push({ id: nid(), sys: true, tone: 'warn', icon: 'repeat', text: '<b>Blocked a repeated message.</b> You sent that twice already, so Wicky stopped the third one.', t: nowTime(), day: 'Today' })
    renderTimeline()
    shake('.composer')
    return
  }
  const m = { id: nid(), by: ME, text: '', raw: text, t: nowTime(), day: 'Today', reacts: {}, ai: view.aiTag, reply: view.replyTo, pending: true, fresh: true }
  view.aiTag = false
  view.replyTo = null
  r.msgs.push(m)
  renderTimeline()
  const verdict = await askModerator(text)
  const attack = attacks.find(a => a.re.test(text))
  const at = r.msgs.indexOf(m)
  if ((verdict && verdict.action === 'hold') || attack) {
    r.msgs[at] = { id: m.id, held: true, text, why: verdict && verdict.action === 'hold' ? verdict.reason || 'Flagged by AI' : attack.why, t: m.t, day: 'Today' }
    if (view.room === r.id) renderTimeline()
    toast('shield-alert', 'Message held', 'Wicky AI stopped that one. Only you can see it.')
    return
  }
  const ranges = badRanges(text).concat(verdict ? spanRanges(text, verdict.spans) : [])
  const clean = hideRanges(text, ranges)
  Object.assign(m, { text: clean.text, censored: clean.count, pending: false, checkedBy: verdict ? 'ai' : 'local', fresh: true })
  if (view.room === r.id) renderTimeline()
  renderRooms()
  if (settings.sounds) blip(520)
  if (r.kind === 'ai') wickyReply(r, text)
  else if (r.id === 'bio-lab' && Math.random() < 0.6) fakeReply(r)
}

function wickyReply(r, q) {
  typing('WICKYpedia is thinking')
  setTimeout(() => {
    const hit = wickyAnswers.find(a => a.re.test(q))
    r.msgs.push(hit
      ? { id: nid(), by: 'wicky', text: hit.a, src: hit.src, t: nowTime(), day: 'Today', reacts: {}, ai: true, fresh: true }
      : { id: nid(), by: 'wicky', text: 'I am not sure about that one. I only answer from info the club has checked, so I wont guess. Try asking a teacher?', t: nowTime(), day: 'Today', reacts: {}, ai: true, fresh: true, chips: ['What clubs are there?', 'When is lunch?'] })
    if (view.room === r.id) renderTimeline()
  }, 900 + Math.random() * 600)
}

function fakeReply(r) {
  const who = Math.random() < 0.5 ? 'jun' : 'mina'
  const lines = ['lol fr', 'ok bet', 'i can do the graphs tmrw', 'wait thats smart', 'yesss', 'sounds good']
  setTimeout(() => typing(`${firstName(who)} is typing`), 600)
  setTimeout(() => incoming(r.id, who, lines[Math.floor(Math.random() * lines.length)]), 2000)
}

function typing(label) {
  const el = $('#typing')
  if (!el) return
  el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>${esc(label)}`
  const sc = $('#scroller')
  sc.scrollTop = sc.scrollHeight
}

function incoming(roomId, by, text) {
  const r = room(roomId)
  if (!r) return
  r.msgs.push({ id: nid(), by, text, t: nowTime(), day: 'Today', reacts: {}, fresh: true })
  const looking = view.room === roomId && view.space !== 'inbox'
  if (looking) {
    renderTimeline()
    return
  }
  r.unread = (r.unread || 0) + 1
  const mentioned = new RegExp('@' + firstName(ME), 'i').test(text)
  if (mentioned) r.mention = true
  if (isTeacher(by)) teacherAlert(r, r.msgs[r.msgs.length - 1])
  else if (!settings.quietHours && ((mentioned && settings.notifyMentions) || settings.notifyAll)) toast(mentioned ? 'at-sign' : 'message-circle', `${people[by].name} · ${r.name}`, text)
  renderSpaces()
  renderRooms()
  if (view.space === 'inbox') renderInbox()
}

function teacherAlert(r, m) {
  if (settings.sounds) { blip(880); setTimeout(() => blip(1175), 120) }
  const el = document.createElement('button')
  el.className = 'alert'
  el.dataset.room = r.id
  el.innerHTML = `
    <span class="alert-label">${ic('zap', 12)} Priority · from a teacher</span>
    <span class="alert-row">${avatar(m.by, 36)}<span><b>${esc(people[m.by].name)}</b> <span class="muted">in ${esc(r.name)}</span><br>${richText(m.text)}</span></span>`
  $('#alerts').appendChild(el)
  setTimeout(() => el.classList.add('out'), 7000)
  setTimeout(() => el.remove(), 7600)
}

function toast(icon, title, body) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.innerHTML = `<span class="toast-ic">${ic(icon, 16)}</span><span><b>${esc(title)}</b><br><span class="muted">${esc(body)}</span></span>`
  $('#toasts').appendChild(el)
  setTimeout(() => el.classList.add('out'), 3800)
  setTimeout(() => el.remove(), 4300)
}

let audio
function blip(freq) {
  try {
    audio = audio || new AudioContext()
    if (audio.state !== 'running') return
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, audio.currentTime)
    g.gain.exponentialRampToValueAtTime(0.07, audio.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18)
    o.connect(g).connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + 0.2)
  } catch (e) {}
}

function shake(sel) {
  const el = $(sel)
  if (!el) return
  el.classList.remove('shake')
  void el.offsetWidth
  el.classList.add('shake')
}

function findMsg(id) {
  for (const r of rooms) {
    const m = r.msgs.find(x => x.id === id)
    if (m) return { r, m }
  }
  return {}
}

function keepScroll(fn) {
  const sc = $('#scroller')
  const top = sc ? sc.scrollTop : 0
  fn()
  const again = $('#scroller')
  if (again) again.scrollTop = top
}

function react(id, e) {
  const { m } = findMsg(id)
  if (!m) return
  const had = (m.reacts[e] || []).includes(ME)
  Object.keys(m.reacts).forEach(k => { m.reacts[k] = m.reacts[k].filter(u => u !== ME) })
  if (!had) {
    const kinds = Object.keys(m.reacts).filter(k => m.reacts[k].length)
    if (!kinds.includes(e) && kinds.length >= 3) {
      toast('smile', 'Reaction limit', 'A message can only have 3 kinds of reactions. Tap one that is already there.')
      return keepScroll(renderTimeline)
    }
    m.reacts[e] = (m.reacts[e] || []).concat(ME)
  }
  keepScroll(renderTimeline)
}

function closePopovers() {
  document.querySelectorAll('.popover').forEach(p => p.remove())
}

function reactPicker(id, anchor) {
  closePopovers()
  const { m } = findMsg(id)
  const kinds = Object.keys(m.reacts).filter(k => m.reacts[k].length)
  const pop = document.createElement('div')
  pop.className = 'popover react-pop'
  pop.innerHTML = ['👍', '😂', '❤️', '🔥', '😮', '🙏', '👀', '💯'].map(e => `<button class="${!kinds.includes(e) && kinds.length >= 3 ? 'off' : ''}" data-act="react" data-id="${id}" data-e="${e}">${e}</button>`).join('') + `<small>${kinds.length}/3 kinds · 1 each</small>`
  document.body.appendChild(pop)
  const b = anchor.getBoundingClientRect()
  pop.style.top = Math.max(8, b.top - pop.offsetHeight - 6) + 'px'
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, b.right - pop.offsetWidth)) + 'px'
}

function overlay(html, cls = '') {
  $('#layer').innerHTML = `<div class="overlay"><div class="dialog ${cls}">${html}</div></div>`
}

function closeOverlay() {
  $('#layer').innerHTML = ''
}

function reportDialog(kind, target) {
  let who
  let preview
  if (kind === 'msg') {
    const { m } = findMsg(target)
    who = m.by
    preview = `<div class="quote static"><span class="quote-who">${avatar(m.by, 18)} <b>${esc(people[m.by].name)}</b> <span class="msg-id">${m.id}</span></span><span class="quote-text">${m.sticker ? 'Sticker' : richText(m.text)}</span></div>`
  } else {
    who = target
    preview = `<div class="quote static"><span class="quote-who">${avatar(target, 18)} <b>${esc(people[target].name)}</b></span><span class="quote-text muted">${esc(people[target].note)}</span></div>`
  }
  const reasons = ['Bullying or harassment', 'Hate speech or slurs', 'Spam', 'Inappropriate content', 'Someone might be in danger', 'Something else']
  overlay(`
    <div class="dlg-head"><h3>${ic('flag', 18)} Report ${kind === 'msg' ? 'message' : 'user'}</h3><button class="round-btn sm" data-act="close">${ic('x', 18)}</button></div>
    <div class="dlg-body">
      ${preview}
      <div class="field-label">What is going on?</div>
      <div class="radio-list">${reasons.map((x, i) => `<label class="radio"><input type="radio" name="reason" value="${esc(x)}" ${i === 0 ? 'checked' : ''}><span>${x}</span></label>`).join('')}</div>
      <textarea class="input" rows="3" placeholder="Anything else a moderator should know? (optional)"></textarea>
      <p class="fine">${ic('lock', 13)} Reports are private. ${esc(firstName(who))} will not know it was you.</p>
    </div>
    <div class="dlg-foot"><button class="btn-ghost" data-act="close">Cancel</button><button class="btn-primary danger" data-act="submit-report">Send report</button></div>
  `, 'narrow')
}

function newChatDialog() {
  const picked = new Set()
  const draw = () => {
    const ids = [...picked]
    const teachers = ids.filter(isTeacher)
    const studentTotal = ids.filter(id => people[id].role === 'student').length + 1
    const over = !teachers.length && studentTotal > 3
    const status = teachers.length
      ? `<div class="status ok">${ic('crown', 15)} ${esc(people[teachers[0]].name)} will own this chat. No member limit.</div>`
      : over
        ? `<div class="status bad">${ic('ban', 15)} Without a teacher a chat can have 3 students max (you + 2). Remove someone or add a teacher.</div>`
        : `<div class="status">${ic('users', 15)} ${studentTotal}/3 students</div>`
    const name = $('#chatName') ? $('#chatName').value : ''
    overlay(`
      <div class="dlg-head"><h3>${ic('square-pen', 18)} Start a chat</h3><button class="round-btn sm" data-act="close">${ic('x', 18)}</button></div>
      <div class="dlg-body">
        <input class="input" id="chatName" placeholder="Name (optional)" value="${esc(name)}">
        <div class="field-label">Who should be in it?</div>
        <div class="pick-list">
          ${Object.keys(people).filter(id => id !== ME && people[id].role !== 'ai').map(id => `
            <button class="pick ${picked.has(id) ? 'on' : ''}" data-pick="${id}">${avatar(id, 28)}<span class="person-text"><span>${esc(people[id].name)}</span><small>${esc(people[id].note)}</small></span>${isTeacher(id) ? `<span class="tag tag-teacher">${ic('zap', 10)} Teacher</span>` : ''}<span class="tick">${ic('check', 13)}</span></button>`).join('')}
        </div>
        ${status}
      </div>
      <div class="dlg-foot"><button class="btn-ghost" data-act="close">Cancel</button><button class="btn-primary" id="createChat" ${!ids.length || over ? 'disabled' : ''}>Create</button></div>
    `, 'narrow')
    document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      picked.has(b.dataset.pick) ? picked.delete(b.dataset.pick) : picked.add(b.dataset.pick)
      draw()
    }))
    $('#createChat').addEventListener('click', () => {
      const id = 'c' + Date.now()
      const typed = $('#chatName').value.trim()
      rooms.push({
        id,
        kind: ids.length === 1 ? 'dm' : 'group',
        name: typed || (ids.length === 1 ? people[ids[0]].name : ids.map(firstName).join(', ')),
        members: [ME, ...ids],
        creator: ME,
        msgs: [{ id: nid(), ev: true, day: 'Today', items: [{ who: ME, what: 'created the chat' }].concat(ids.map(x => ({ who: x, what: 'was added' }))) }]
      })
      closeOverlay()
      view.space = 'home'
      openRoom(id)
      if (teachers.length) toast('crown', 'Teacher owned chat', `${people[teachers[0]].name} is the owner.`)
    })
  }
  draw()
}

function serverDialog() {
  let teacher = null
  let name = ''
  const colors = ['#0dbd8b', '#368bd6', '#ac3ba8', '#e64f7a', '#ff812d', '#5c56f5', '#2dc2c5', '#74d12c']
  let color = colors[1]
  const initials = n => (n || 'New').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase()
  const draw = () => {
    overlay(`
      <div class="dlg-head"><h3>${ic('server', 18)} Create a server</h3><button class="round-btn sm" data-act="close">${ic('x', 18)}</button></div>
      <div class="dlg-body">
        <div class="srv-preview"><span class="space-tile big" id="srvTile" style="background:${color}">${esc(initials(name))}</span><div><b id="srvTitle">${esc(name || 'New server')}</b><small class="muted">${teacher ? 'Owned by ' + esc(people[teacher].name) : 'Needs a teacher owner'}</small></div></div>
        <input class="input" id="srvName" placeholder="Server name, like Chess Club" value="${esc(name)}">
        <div class="field-label">Color</div>
        <div class="swatches">${colors.map(c => `<button class="swatch ${c === color ? 'on' : ''}" style="background:${c}" data-color="${c}"></button>`).join('')}</div>
        <div class="field-label">Teacher owner</div>
        <div class="pick-list short">
          ${Object.keys(people).filter(isTeacher).map(id => `<button class="pick ${teacher === id ? 'on' : ''}" data-teacher="${id}">${avatar(id, 28)}<span class="person-text"><span>${esc(people[id].name)}</span><small>${esc(people[id].note)}</small></span><span class="tick">${ic('check', 13)}</span></button>`).join('')}
        </div>
        <div class="status">${ic('info', 15)} Servers can be as big as you want, but they always need a teacher owner. The teacher gets a request to approve it.</div>
      </div>
      <div class="dlg-foot"><button class="btn-ghost" data-act="close">Cancel</button><button class="btn-primary" id="makeServer" ${teacher && name.trim() ? '' : 'disabled'}>Send to ${teacher ? esc(people[teacher].name) : 'teacher'}</button></div>
    `, 'narrow')
    const input = $('#srvName')
    input.addEventListener('input', () => {
      name = input.value
      $('#srvTile').textContent = initials(name)
      $('#srvTitle').textContent = name || 'New server'
      $('#makeServer').disabled = !(teacher && name.trim())
    })
    document.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => { color = b.dataset.color; draw() }))
    document.querySelectorAll('[data-teacher]').forEach(b => b.addEventListener('click', () => { teacher = b.dataset.teacher; draw() }))
    $('#makeServer').addEventListener('click', () => {
      const id = 's' + Date.now()
      servers.push({ id, name: name.trim(), short: initials(name), color, owner: teacher, size: 2, about: 'New server' })
      rooms.push({ id: id + '-general', kind: 'room', server: id, name: 'general', topic: 'Say hi!', msgs: [{ id: nid(), sys: true, icon: 'crown', text: `<b>${esc(people[teacher].name)}</b> approved this server and is the owner.`, t: nowTime(), day: 'Today' }] })
      closeOverlay()
      celebrate()
      openSpace(id)
    })
  }
  draw()
}

function celebrate() {
  if (window.confetti && !settings.reduceMotion) confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: [settings.accent, '#ffffff', '#ffd166'] })
}

function exploreDialog() {
  overlay(`
    <div class="dlg-head"><h3>${ic('compass', 18)} Explore servers</h3><button class="round-btn sm" data-act="close">${ic('x', 18)}</button></div>
    <div class="dlg-body">
      <p class="muted">Every server is owned by a teacher, so there is no member limit. Joining is instant.</p>
      <div class="explore-list">
        ${exploreList.concat(servers).map(s => {
          const joined = servers.includes(s)
          return `
          <div class="explore-item">
            <span class="space-tile" style="background:${s.color}">${esc(s.short)}</span>
            <span class="person-text"><b>${esc(s.name)}</b><small>${esc(s.about)}</small><small class="muted">${s.size} members · ${esc(people[s.owner].name)}</small></span>
            ${joined ? `<button class="btn-ghost sm" data-space="${s.id}">Open</button>` : `<button class="btn-primary sm" data-act="join" data-s="${s.id}">Join</button>`}
          </div>`
        }).join('')}
      </div>
    </div>
  `, 'narrow')
}

function joinServer(id) {
  const s = exploreList.find(x => x.id === id)
  if (!s) return
  exploreList.splice(exploreList.indexOf(s), 1)
  s.size += 1
  servers.push(s)
  rooms.push({ id: id + '-general', kind: 'room', server: id, name: 'general', topic: s.about, msgs: [{ id: nid(), ev: true, day: 'Today', items: [{ who: ME, what: 'joined' }] }, msg(s.owner, `Welcome ${firstName(ME)}! Have fun and be nice.`, nowTime())] })
  closeOverlay()
  celebrate()
  openSpace(id)
}

const tabs = [
  ['account', 'user', 'Account'],
  ['appearance', 'palette', 'Appearance'],
  ['notifications', 'bell', 'Notifications'],
  ['chat', 'messages-square', 'Chat'],
  ['safety', 'shield-check', 'Safety'],
  ['access', 'accessibility', 'Accessibility'],
  ['keys', 'keyboard', 'Shortcuts']
]

function toggleRow(key, label, hint, locked) {
  return `
    <div class="set-row ${locked ? 'locked' : ''}">
      <span><b>${label}</b><small>${locked ? ic('lock', 11) + ' ' : ''}${hint}</small></span>
      <button class="switch ${locked || settings[key] ? 'on' : ''}" ${locked ? 'disabled' : `data-set="${key}"`}><i></i></button>
    </div>`
}

function choiceRow(key, label, options) {
  return `
    <div class="set-row col">
      <b>${label}</b>
      <div class="seg">${options.map(([v, l]) => `<button class="${settings[key] === v ? 'on' : ''}" data-choose="${key}" data-v="${v}">${l}</button>`).join('')}</div>
    </div>`
}

function sizeRow() {
  return `<div class="set-row col"><b>Text size <span class="muted" id="sizeLabel">${settings.fontSize}px</span></b><input type="range" min="12" max="20" value="${settings.fontSize}" id="fontSize"></div>`
}

function settingsBody(tab) {
  if (tab === 'account') {
    return `
      <h3>Account</h3>
      <div class="account-card">${avatar(ME, 64)}<div><b>${esc(settings.displayName)}</b><small>daniel.cho@ci.school · Student · Grade 10</small></div></div>
      <div class="field-label">Display name</div>
      <input class="input" id="displayName" value="${esc(settings.displayName)}">
      ${choiceRow('status', 'Status', [['online', '🟢 Online'], ['away', '🌙 Away'], ['busy', '⛔ Busy'], ['invisible', '👻 Invisible']])}
      <div class="set-row"><span><b>Signed in with Google</b><small>Only school accounts can use Wicky</small></span><button class="btn-ghost sm" data-act="sign-out">${ic('log-out', 14)} Sign out</button></div>`
  }
  if (tab === 'appearance') {
    const themes = [['system', 'monitor', 'Match system'], ['dark', 'moon', 'Dark'], ['light', 'sun', 'Light'], ['contrast', 'contrast', 'High contrast']]
    const accents = ['#0dbd8b', '#368bd6', '#5c56f5', '#ac3ba8', '#e64f7a', '#ff812d', '#eab308']
    return `
      <h3>Appearance</h3>
      <div class="field-label">Theme</div>
      <div class="theme-grid">
        ${themes.map(([v, i, l]) => `
          <button class="theme-card ${settings.theme === v ? 'on' : ''}" data-choose="theme" data-v="${v}">
            <span class="theme-thumb t-${v}"><i></i><i></i><i></i></span>
            <span>${ic(i, 14)} ${l}</span>
          </button>`).join('')}
      </div>
      <div class="field-label">Accent color</div>
      <div class="swatches">${accents.map(c => `<button class="swatch ${settings.accent === c ? 'on' : ''}" style="background:${c}" data-choose="accent" data-v="${c}"></button>`).join('')}<label class="swatch custom" title="Pick any color"><input type="color" id="customAccent" value="${settings.accent}">${ic('plus', 14)}</label></div>
      <div class="field-label">Message layout</div>
      <div class="layout-grid">
        ${[['modern', 'Modern'], ['bubbles', 'Bubbles'], ['irc', 'Compact']].map(([v, l]) => `
          <button class="layout-card ${settings.layout === v ? 'on' : ''}" data-choose="layout" data-v="${v}">
            <span class="lay-thumb l-${v}"><i></i><i></i><i></i></span><span>${l}</span>
          </button>`).join('')}
      </div>
      ${sizeRow()}
      ${toggleRow('avatars', 'Show avatars in chat', 'Turn off for a cleaner timeline')}
      ${toggleRow('compactList', 'Compact room list', 'Smaller rows, no message previews')}`
  }
  if (tab === 'notifications') {
    return `
      <h3>Notifications</h3>
      ${toggleRow('x', 'Teacher messages', 'Always notify and always on top. Set by the school.', true)}
      ${toggleRow('notifyMentions', 'When someone @mentions me', 'Pop up and mark the room')}
      ${toggleRow('notifyAll', 'Every new message', 'Small pop ups for other chats')}
      ${toggleRow('sounds', 'Sounds', 'A little blip when messages arrive')}
      ${toggleRow('quietHours', 'Quiet hours', 'Mute everything except teachers')}`
  }
  if (tab === 'chat') {
    return `
      <h3>Chat</h3>
      ${toggleRow('time24', '24 hour time', 'Show 14:30 instead of 2:30 PM')}
      ${toggleRow('receipts', 'Read receipts', 'Show who has seen the latest message')}
      ${toggleRow('events', 'Join and leave events', 'The little grey "Jun joined" lines')}
      ${toggleRow('previews', 'Link previews', 'Show a card under messages with links')}
      ${toggleRow('enterSends', 'Enter sends the message', 'Off means Ctrl + Enter sends')}
      ${toggleRow('showIds', 'Show message IDs', 'Handy when you report something')}`
  }
  if (tab === 'safety') {
    return `
      <h3>Safety</h3>
      ${choiceRow('censorStyle', 'How hidden words look', [['dots', '••••'], ['stars', '****'], ['blocks', '████'], ['zip', '🤐']])}
      ${toggleRow('blurStickers', 'Blur stickers until I tap them', 'Good for class time')}
      ${toggleRow('x', 'AI tags on AI messages', 'Always on so everyone knows what is real', true)}
      ${toggleRow('x', 'Wicky AI moderation', 'Always on. Checks every message before it sends', true)}
      <div class="info-card"><div class="card-label">${ic('shield-check', 14)} Your reports</div><p>Reports go to real moderators, not a bot. The person never finds out it was you.</p></div>`
  }
  if (tab === 'access') {
    return `
      <h3>Accessibility</h3>
      ${toggleRow('reduceMotion', 'Reduce motion', 'Turn off animations and confetti')}
      ${toggleRow('underlineLinks', 'Underline links', 'Easier to spot links in messages')}
      ${choiceRow('theme', 'Contrast', [['dark', 'Normal'], ['contrast', 'High contrast']])}
      ${sizeRow()}`
  }
  return `
    <h3>Keyboard shortcuts</h3>
    <div class="keys">
      ${[['Ctrl K', 'Search rooms and commands'], ['/', 'Search the inbox'], ['Enter', 'Send message'], ['Shift Enter', 'New line'], ['Esc', 'Close dialogs and popups'], ['Alt ↑ / ↓', 'Previous or next room']].map(([k, d]) => `<div class="key-row"><span>${d}</span><kbd>${k}</kbd></div>`).join('')}
    </div>`
}

function settingsDialog(tab) {
  view.settingsTab = tab || view.settingsTab
  const body = $('.settings-body')
  const scroll = body ? body.scrollTop : 0
  overlay(`
    <div class="settings">
      <nav class="settings-nav">
        <h3>Settings</h3>
        ${tabs.map(([id, i, l]) => `<button class="${view.settingsTab === id ? 'on' : ''}" data-tab-go="${id}">${ic(i, 17)}<span>${l}</span></button>`).join('')}
        <div class="grow"></div>
        <button data-act="reset-settings">${ic('rotate-ccw', 17)}<span>Reset to default</span></button>
      </nav>
      <div class="settings-body">
        <button class="round-btn sm close-x" data-act="close">${ic('x', 18)}</button>
        ${settingsBody(view.settingsTab)}
      </div>
    </div>
  `, 'wide')
  if (!tab) $('.settings-body').scrollTop = scroll
  const fs = $('#fontSize')
  if (fs) fs.addEventListener('input', () => { settings.fontSize = +fs.value; saveSettings(); applySettings(); $('#sizeLabel').textContent = settings.fontSize + 'px' })
  const dn = $('#displayName')
  if (dn) dn.addEventListener('change', () => { settings.displayName = dn.value.trim() || defaults.displayName; saveSettings(); renderAll(); settingsDialog() })
  const ca = $('#customAccent')
  if (ca) ca.addEventListener('input', () => { settings.accent = ca.value; saveSettings(); applySettings() })
}

function applySettings() {
  const root = document.documentElement
  const theme = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme
  root.dataset.theme = theme
  root.style.setProperty('--accent', settings.accent)
  root.style.setProperty('--font', settings.fontSize + 'px')
  const drawer = document.body.classList.contains('drawer-open')
  document.body.className = ['layout-' + settings.layout, settings.reduceMotion ? 'still' : '', settings.underlineLinks ? 'underline' : '', drawer ? 'drawer-open' : ''].join(' ').trim()
  people[ME].name = settings.displayName
}

function paletteDialog() {
  overlay(`
    <div class="palette">
      <label class="pal-search">${ic('search', 18)}<input id="palInput" placeholder="Jump to a room, server or command"><kbd>Esc</kbd></label>
      <div class="pal-list" id="palList"></div>
    </div>`, 'top')
  let sel = 0
  const items = () => {
    const q = $('#palInput').value.toLowerCase()
    return [
      { label: 'Inbox', sub: 'Everything new', icon: 'inbox', act: 'inbox' },
      ...rooms.filter(r => !r.server || server(r.server)).map(r => ({ label: r.name, sub: r.server ? server(r.server).name : r.kind === 'dm' ? 'Direct chat' : r.kind === 'self' ? 'Only you' : 'Chat', room: r })),
      ...servers.map(s => ({ label: s.name, sub: 'Server', space: s })),
      { label: 'Start a chat', sub: 'Command', icon: 'square-pen', act: 'new-chat' },
      { label: 'Create a server', sub: 'Command', icon: 'server', act: 'new-server' },
      { label: 'Explore servers', sub: 'Command', icon: 'compass', act: 'explore' },
      { label: 'Settings', sub: 'Command', icon: 'settings', act: 'settings' },
      { label: document.documentElement.dataset.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode', sub: 'Command', icon: document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun', act: 'flip-theme' }
    ].filter(i => i.label.toLowerCase().includes(q) || (i.sub || '').toLowerCase().includes(q))
  }
  const draw = () => {
    const list = items()
    sel = Math.min(sel, Math.max(0, list.length - 1))
    $('#palList').innerHTML = list.map((it, i) => `
      <button class="pal-item ${i === sel ? 'sel' : ''}" ${it.room ? `data-room="${it.room.id}"` : it.space ? `data-space="${it.space.id}"` : `data-act="${it.act}"`}>
        ${it.room ? roomAvatar(it.room, 26) : it.space ? `<span class="space-tile sm" style="background:${it.space.color}">${esc(it.space.short)}</span>` : `<span class="av av-room" style="--s:26px;background:var(--surface-3);color:var(--text)">${ic(it.icon, 14)}</span>`}
        <span>${esc(it.label)}</span><small>${esc(it.sub || '')}</small>
      </button>`).join('') || '<div class="empty-list">Nothing matches</div>'
    const s = document.querySelector('.pal-item.sel')
    if (s) s.scrollIntoView({ block: 'nearest' })
  }
  const input = $('#palInput')
  input.focus()
  input.addEventListener('input', () => { sel = 0; draw() })
  input.addEventListener('keydown', e => {
    const n = document.querySelectorAll('.pal-item').length
    if (!n) return
    if (e.key === 'ArrowDown') { sel = (sel + 1) % n; draw(); e.preventDefault() }
    if (e.key === 'ArrowUp') { sel = (sel - 1 + n) % n; draw(); e.preventDefault() }
    if (e.key === 'Enter') document.querySelectorAll('.pal-item')[sel].click()
  })
  draw()
}

function invite(uid) {
  const r = room(view.room)
  if (people[uid].role === 'student' && !hasTeacher(r) && students(r) >= 3) {
    toast('ban', 'This chat is full', 'Chats without a teacher can have 3 students. Invite a teacher to lift the limit.')
    shake('.seats')
    return
  }
  const hadTeacher = hasTeacher(r)
  r.members.push(uid)
  if (r.kind === 'dm') {
    r.kind = 'group'
    r.name = r.members.map(firstName).join(', ')
  }
  r.msgs.push({ id: nid(), ev: true, day: 'Today', items: [{ who: uid, what: `was added by ${firstName(ME)}` }] })
  if (isTeacher(uid) && !hadTeacher) r.msgs.push({ id: nid(), sys: true, icon: 'crown', text: `<b>${esc(people[uid].name)}</b> is a teacher, so they are now the owner and the member limit is gone.`, t: nowTime(), day: 'Today' })
  renderAll()
}

function updateWarn() {
  const el = $('#warn')
  const input = $('#input')
  if (!el || !input) return
  const text = input.value
  const r = room(view.room)
  const notes = []
  const n = badRanges(text).length
  if (n) notes.push(`${ic('shield-check', 13)} ${n} word${n > 1 ? 's' : ''} will be hidden`)
  if (attacks.some(a => a.re.test(text))) notes.push(`${ic('shield-alert', 13)} This will probably be held`)
  if (text.trim() && repeatCount(r, text) >= 2) notes.push(`${ic('repeat', 13)} You already sent this twice`)
  el.innerHTML = notes.map(x => `<span>${x}</span>`).join('')
  el.classList.toggle('show', notes.length > 0)
  input.style.height = 'auto'
  input.style.height = Math.min(input.scrollHeight, 200) + 'px'
}

let emojiLoaded = false
function loadEmoji() {
  if (view.tray !== 'emoji') return
  if (!emojiLoaded) {
    emojiLoaded = true
    import('https://cdn.jsdelivr.net/npm/emoji-picker-element@1.22.8/index.js').catch(() => {})
  }
  const picker = document.querySelector('emoji-picker')
  if (picker && !picker.dataset.wired) {
    picker.dataset.wired = '1'
    picker.addEventListener('emoji-click', ev => {
      const input = $('#input')
      const at = input.selectionStart ?? input.value.length
      input.value = input.value.slice(0, at) + ev.detail.unicode + input.value.slice(at)
      input.focus()
      updateWarn()
    })
  }
}

function submitComposer() {
  const i = $('#input')
  if (!i) return
  const v = i.value
  i.value = ''
  updateWarn()
  send(v)
}

document.addEventListener('click', e => {
  const t = e.target
  if (audio && audio.state === 'suspended') audio.resume()
  if (!audio) { try { audio = new AudioContext() } catch (err) {} }
  if (!t.closest('.popover') && !t.closest('[data-act="pick-react"]')) closePopovers()
  if (view.tray && !t.closest('.tray') && !t.closest('[data-act="tray"]')) {
    view.tray = null
    const tr = document.querySelector('.tray')
    if (tr) tr.remove()
    document.querySelectorAll('[data-act="tray"]').forEach(b => b.classList.remove('on'))
  }
  if (t.classList.contains('overlay')) return closeOverlay()

  const roomBtn = t.closest('[data-room]')
  const spaceBtn = t.closest('[data-space]')
  const filterBtn = t.closest('[data-filter]')
  const tabBtn = t.closest('[data-tab-go]')
  const setBtn = t.closest('[data-set]')
  const chooseBtn = t.closest('[data-choose]')
  const jump = t.closest('[data-jump]')
  const actBtn = t.closest('[data-act]')

  if (tabBtn) return settingsDialog(tabBtn.dataset.tabGo)
  if (setBtn) {
    settings[setBtn.dataset.set] = !settings[setBtn.dataset.set]
    saveSettings()
    renderAll()
    return settingsDialog()
  }
  if (chooseBtn) {
    settings[chooseBtn.dataset.choose] = chooseBtn.dataset.v
    saveSettings()
    renderAll()
    return settingsDialog()
  }
  if (filterBtn) {
    view.filter = view.filter === filterBtn.dataset.filter ? null : filterBtn.dataset.filter
    return renderRooms()
  }
  if (jump) {
    const el = document.querySelector(`.msg[data-id="${jump.dataset.jump}"]`)
    if (el) {
      el.scrollIntoView({ behavior: settings.reduceMotion ? 'auto' : 'smooth', block: 'center' })
      el.classList.add('flash')
      setTimeout(() => el.classList.remove('flash'), 1400)
    }
    return
  }
  if (roomBtn && !actBtn) {
    closeOverlay()
    if (t.closest('.alert')) t.closest('.alert').remove()
    return openRoom(roomBtn.dataset.room)
  }
  if (spaceBtn && !actBtn) {
    closeOverlay()
    return openSpace(spaceBtn.dataset.space)
  }
  if (!actBtn) return
  const a = actBtn.dataset.act
  const id = actBtn.dataset.id
  const actions = {
    close: closeOverlay,
    settings: () => settingsDialog(actBtn.dataset.tab || 'appearance'),
    palette: paletteDialog,
    'new-chat': () => newChatDialog(),
    'new-server': () => serverDialog(),
    explore: () => exploreDialog(),
    join: () => joinServer(actBtn.dataset.s),
    inbox: () => { closeOverlay(); view.space = 'inbox'; document.body.classList.remove('drawer-open'); renderAll() },
    'server-info': () => { const s = server(view.space); toast('crown', s.name, `${s.about} Owned by ${people[s.owner].name}.`) },
    'toggle-info': () => { view.info = !view.info; keepScroll(renderTimeline); renderInfo() },
    drawer: () => document.body.classList.add('drawer-open'),
    send: submitComposer,
    tray: () => {
      const want = actBtn.dataset.tray
      view.tray = view.tray && (view.tray === want || (want === 'stickers' && view.tray === 'gifs')) ? null : want
      const draft = $('#input') ? $('#input').value : ''
      keepScroll(renderTimeline)
      if ($('#input')) $('#input').value = draft
    },
    'tray-tab': () => {
      view.tray = actBtn.dataset.tray
      const draft = $('#input') ? $('#input').value : ''
      keepScroll(renderTimeline)
      if ($('#input')) $('#input').value = draft
    },
    'send-sticker': () => {
      const r = room(view.room)
      r.msgs.push({ id: nid(), by: ME, text: '', sticker: actBtn.dataset.s, gif: !!actBtn.dataset.gif, t: nowTime(), day: 'Today', reacts: {}, fresh: true })
      view.tray = null
      renderTimeline()
      renderRooms()
    },
    'ai-tag': () => {
      view.aiTag = !view.aiTag
      actBtn.classList.toggle('on', view.aiTag)
      actBtn.classList.toggle('ai', view.aiTag)
      if (view.aiTag) toast('bot', 'AI tag on', 'Your next message will say AI generated.')
    },
    react: () => { closePopovers(); react(id, actBtn.dataset.e) },
    'pick-react': () => reactPicker(id, actBtn),
    reply: () => { view.replyTo = id; keepScroll(renderTimeline); $('#input').focus() },
    'cancel-reply': () => { view.replyTo = null; keepScroll(renderTimeline) },
    'copy-id': () => { try { navigator.clipboard.writeText(id) } catch (err) {} toast('copy', 'Copied ' + id, 'Paste it in a report so moderators find it fast.') },
    report: () => reportDialog('msg', id),
    'report-user': () => reportDialog('user', actBtn.dataset.u),
    'submit-report': () => { closeOverlay(); toast('flag', 'Report sent', 'A real moderator will look at it. Thanks for helping.') },
    invite: () => invite(actBtn.dataset.u),
    expand: () => { view.expanded.has(id) ? view.expanded.delete(id) : view.expanded.add(id); keepScroll(renderTimeline) },
    ask: () => send(actBtn.dataset.q),
    appeal: () => {
      const r = room(view.room)
      r.msgs = r.msgs.filter(m => m.id !== id)
      r.msgs.push({ id: nid(), sys: true, icon: 'shield-check', text: 'Sent to a moderator. You will get a notification when they decide.', t: nowTime(), day: 'Today' })
      renderTimeline()
    },
    dismiss: () => { const r = room(view.room); r.msgs = r.msgs.filter(m => m.id !== id); keepScroll(renderTimeline) },
    unblur: () => actBtn.classList.remove('blurred'),
    'reset-settings': () => { settings = { ...defaults }; saveSettings(); renderAll(); settingsDialog() },
    'flip-theme': () => { settings.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; saveSettings(); closeOverlay(); renderAll() },
    'sign-out': () => toast('log-out', 'Demo mode', 'Signing out will work once the backend is connected.')
  }
  if (actions[a]) actions[a]()
})

document.addEventListener('input', e => {
  if (e.target.id === 'input') updateWarn()
})

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    return document.querySelector('.palette') ? closeOverlay() : paletteDialog()
  }
  if (e.key === 'Escape') {
    closeOverlay()
    closePopovers()
    document.body.classList.remove('drawer-open')
    if (view.tray) { view.tray = null; keepScroll(renderTimeline) }
    return
  }
  if (e.target.id === 'input' && e.key === 'Enter' && !e.shiftKey && (settings.enterSends || e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    submitComposer()
    return
  }
  if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const list = [...document.querySelectorAll('.room-list [data-room]')].map(b => b.dataset.room)
    const i = list.indexOf(view.room)
    const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]
    if (next) openRoom(next)
  }
  if (e.key === '/' && view.space === 'inbox' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    e.preventDefault()
    $('#inboxSearch').focus()
  }
})

$('#shade').addEventListener('click', () => document.body.classList.remove('drawer-open'))
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (settings.theme === 'system') renderAll() })

openRoom(view.room)

setTimeout(() => incoming('bio-q', 'park', 'Change of plans: tomorrows lab is in Room 2108. Bring goggles!'), 6000)
setTimeout(() => incoming('oc-general', 'sora', '@Daniel the new homepage looks so good'), 13000)
setTimeout(() => incoming('rb-build', 'ethan', 'servos came in!! build day is gonna be crazy'), 21000)
