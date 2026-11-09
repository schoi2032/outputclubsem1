const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('lite.' + key)
      return v == null ? fallback : JSON.parse(v)
    } catch (e) {
      return fallback
    }
  },
  set(key, value) {
    try { localStorage.setItem('lite.' + key, JSON.stringify(value)) } catch (e) {}
  },
  del(key) {
    try { localStorage.removeItem('lite.' + key) } catch (e) {}
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function initials(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2)
  return words.slice(0, 3).map(w => w[0]).join('')
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function clock(t) {
  const d = new Date(t)
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function stamp(t) {
  const now = Date.now()
  if (sameDay(t, now)) return 'Today at ' + clock(t)
  if (sameDay(t, now - 86400000)) return 'Yesterday at ' + clock(t)
  const d = new Date(t)
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + clock(t)
}

function dayLabel(t) {
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function longDate(t) {
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fileSize(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

const ICONS = {
  logo: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  crown: '<path d="m2 18 2-11 5 5 3-7 3 7 5-5 2 11z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  invite: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  arrowUp: '<path d="m18 15-6-6-6 6"/>',
  arrowDown: '<path d="m6 9 6 6 6-6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>',
  join: '<path d="M5 12h14M12 5l7 7-7 7"/>'
}

function icon(name, size = 20) {
  return '<svg class="ico" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>'
}

const EMOJI = [
  ['😀', 'grinning'], ['😃', 'smiley'], ['😄', 'smile'], ['😁', 'grin'], ['😆', 'laughing'], ['😅', 'sweat_smile'],
  ['😂', 'joy'], ['🤣', 'rofl'], ['😊', 'blush'], ['😇', 'innocent'], ['🙂', 'slight_smile'], ['😉', 'wink'],
  ['😍', 'heart_eyes'], ['🥰', 'smiling_hearts'], ['😘', 'kissing_heart'], ['😋', 'yum'], ['😛', 'tongue'], ['😜', 'winking_tongue'],
  ['🤪', 'zany'], ['🤓', 'nerd'], ['😎', 'sunglasses'], ['🥳', 'partying'], ['😏', 'smirk'], ['😒', 'unamused'],
  ['😞', 'disappointed'], ['😔', 'pensive'], ['😟', 'worried'], ['😕', 'confused'], ['🙁', 'frown'], ['😣', 'persevere'],
  ['😫', 'tired'], ['😩', 'weary'], ['🥺', 'pleading'], ['😢', 'cry'], ['😭', 'sob'], ['😤', 'triumph'],
  ['😠', 'angry'], ['😡', 'rage'], ['🤬', 'cursing'], ['🤯', 'exploding_head'], ['😳', 'flushed'], ['🥵', 'hot'],
  ['🥶', 'cold'], ['😱', 'scream'], ['😨', 'fearful'], ['🤔', 'thinking'], ['🤫', 'shush'], ['🤭', 'hand_over_mouth'],
  ['🙄', 'eye_roll'], ['😬', 'grimace'], ['😴', 'sleeping'], ['🤤', 'drool'], ['😷', 'mask'], ['🤢', 'nauseated'],
  ['🤮', 'vomit'], ['🤡', 'clown'], ['💀', 'skull'], ['👻', 'ghost'], ['👽', 'alien'], ['🤖', 'robot'],
  ['💩', 'poop'], ['🎃', 'jack_o_lantern'], ['👍', 'thumbsup'], ['👎', 'thumbsdown'], ['👌', 'ok_hand'], ['✌️', 'v'],
  ['🤞', 'crossed_fingers'], ['🤙', 'call_me'], ['👋', 'wave'], ['👏', 'clap'], ['🙌', 'raised_hands'], ['🙏', 'pray'],
  ['💪', 'muscle'], ['👀', 'eyes'], ['🧠', 'brain'], ['❤️', 'heart'], ['🧡', 'orange_heart'], ['💛', 'yellow_heart'],
  ['💚', 'green_heart'], ['💙', 'blue_heart'], ['💜', 'purple_heart'], ['🖤', 'black_heart'], ['💔', 'broken_heart'], ['💯', '100'],
  ['🔥', 'fire'], ['✨', 'sparkles'], ['⭐', 'star'], ['🎉', 'tada'], ['🎮', 'video_game'], ['📚', 'books'],
  ['✏️', 'pencil'], ['🍕', 'pizza'], ['☕', 'coffee'], ['🏀', 'basketball'], ['⚽', 'soccer'], ['🎵', 'musical_note'],
  ['✅', 'white_check_mark'], ['❌', 'x'], ['❓', 'question'], ['❗', 'exclamation'], ['⚠️', 'warning'], ['🐢', 'turtle']
]
const SHORTCODES = Object.fromEntries(EMOJI.map(([e, n]) => [n, e]))

function findByUsername(name) {
  name = String(name).toLowerCase()
  for (const id in S.users) if (S.users[id].username === name) return S.users[id]
  return null
}

function markdown(text) {
  const keep = []
  const stash = html => '\u0001' + (keep.push(html) - 1) + '\u0001'
  let s = esc(text)
  s = s.replace(/```(?:[\w+-]*\n)?([\s\S]*?)```/g, (_, code) => stash('<pre class="code-block"><code>' + code.replace(/^\n+|\n+$/g, '') + '</code></pre>'))
  s = s.replace(/`([^`\n]+?)`/g, (_, code) => stash('<code class="inline">' + code + '</code>'))
  s = s.replace(/\bhttps?:\/\/[^\s<\u0001]+[^\s<.,:;!?)\]\u0001]/g, url => stash('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'))
  s = s.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>')
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/__(.+?)__/g, '<u>$1</u>')
  s = s.replace(/(^|[^*])\*(?![\s*])(.+?)\*(?!\*)/g, '$1<i>$2</i>')
  s = s.replace(/(^|\s)_(?![\s_])(.+?)_(?=\s|$|[.,!?])/g, '$1<i>$2</i>')
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>')
  s = s.replace(/@(everyone|here)\b/g, (all) => stash('<span class="mention">' + all + '</span>'))
  s = s.replace(/@([a-z0-9_.]{2,20})/gi, (all, name) => {
    const clean = name.replace(/\.+$/, '')
    const u = findByUsername(clean)
    if (!u) return all
    return stash('<span class="mention' + (S.me && u.id === S.me.id ? ' me' : '') + '" data-user="' + u.id + '">@' + esc(u.name) + '</span>') + name.slice(clean.length)
  })
  s = s.replace(/:([a-z0-9_+-]+):/g, (all, n) => SHORTCODES[n] || all)
  const lines = s.split('\n')
  const outLines = []
  let quote = null
  for (const line of lines) {
    if (line.startsWith('&gt; ') || line === '&gt;') {
      quote = quote || []
      quote.push(line.replace(/^&gt; ?/, ''))
      continue
    }
    if (quote) {
      outLines.push('<blockquote>' + quote.join('<br>') + '</blockquote>')
      quote = null
    }
    outLines.push(line + '<br>')
  }
  if (quote) outLines.push('<blockquote>' + quote.join('<br>') + '</blockquote>')
  s = outLines.join('').replace(/<br>$/, '')
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => keep[i])
}

function onlyEmoji(text) {
  const t = String(text || '').replace(/:([a-z0-9_+-]+):/g, (all, n) => SHORTCODES[n] || all).trim()
  if (!t || t.length > 40) return false
  return /^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s)+$/u.test(t)
}

const STATUS_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible', offline: 'Offline' }

function avatar(u, size = 40, status = false) {
  u = u || { name: '?', color: '#4e5058' }
  const letter = esc(String(u.name || '?').trim().charAt(0).toUpperCase() || '?')
  return '<div class="av" data-user="' + esc(u.id || '') + '" style="width:' + size + 'px;height:' + size + 'px;background:' + esc(u.color) + ';font-size:' + Math.round(size * 0.42) + 'px">' + letter +
    (status ? '<i class="dot ' + esc(u.status || 'offline') + '" title="' + STATUS_LABEL[u.status || 'offline'] + '"></i>' : '') + '</div>'
}

function toast(text, kind) {
  const el = document.createElement('div')
  el.className = 'toast' + (kind ? ' ' + kind : '')
  el.textContent = text
  $('#toasts').appendChild(el)
  setTimeout(() => el.classList.add('out'), 3200)
  setTimeout(() => el.remove(), 3600)
}

let audioCtx = null
function beep(freq = 660) {
  try {
    audioCtx = audioCtx || new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.07, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3)
    o.connect(g)
    g.connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + 0.3)
  } catch (e) {}
}

function copyText(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied!'), () => toast('Couldnt copy that'))
  else toast('Copy isnt supported here')
}

function place(el, x, y) {
  const w = el.offsetWidth
  const h = el.offsetHeight
  if (x + w > innerWidth - 8) x = innerWidth - w - 8
  if (y + h > innerHeight - 8) y = innerHeight - h - 8
  el.style.left = Math.max(8, x) + 'px'
  el.style.top = Math.max(8, y) + 'px'
}
