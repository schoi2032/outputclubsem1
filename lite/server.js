const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { WebSocketServer } = require('ws')

const PORT = Number(process.env.PORT) || 3000
const PUBLIC = path.join(__dirname, 'public')
const DATA = path.join(__dirname, 'data')
const UPLOADS = path.join(DATA, 'uploads')
const DB_FILE = path.join(DATA, 'db.json')
const MAX_UPLOAD = 10 * 1024 * 1024
const PAGE = 50
const STATUSES = ['online', 'idle', 'dnd', 'invisible']
const COLORS = ['#5865f2', '#e0632f', '#ac3ba8', '#e64f7a', '#2dc2c5', '#23a55a', '#f0b232', '#368bd6', '#9b59b6', '#eb459e']

fs.mkdirSync(UPLOADS, { recursive: true })

let db = { users: {}, tokens: {}, servers: {}, channels: {}, messages: {}, friends: {}, reads: {} }
try {
  if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')))
} catch (e) {
  console.error('could not read db.json, starting with an empty one')
}

let saveTimer = null
function save() {
  if (saveTimer) return
  saveTimer = setTimeout(writeNow, 300)
}

function writeNow() {
  clearTimeout(saveTimer)
  saveTimer = null
  const tmp = DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db))
  fs.renameSync(tmp, DB_FILE)
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (saveTimer) writeNow()
    process.exit(0)
  })
}

const uid = () => Date.now().toString(36) + crypto.randomBytes(5).toString('hex')
const pick = arr => arr[Math.floor(Math.random() * arr.length)]

function fail(msg) {
  const e = new Error(msg)
  e.expose = true
  throw e
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max)
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 64).toString('hex')
}

function checkPassword(u, pw) {
  const a = Buffer.from(hashPassword(pw, u.salt), 'hex')
  const b = Buffer.from(u.hash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function newToken(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  db.tokens[token] = userId
  save()
  return token
}

function newInvite() {
  let code
  do code = crypto.randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toLowerCase()
  while (code.length < 5 || Object.values(db.servers).some(s => s.invite === code))
  return code
}

function byUsername(name) {
  name = String(name || '').toLowerCase()
  return Object.values(db.users).find(u => u.username === name)
}

const sockets = new Map()

function presence(id) {
  const u = db.users[id]
  if (!u || !sockets.has(id)) return 'offline'
  return u.status === 'invisible' ? 'offline' : u.status
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    color: u.color,
    about: u.about,
    customStatus: u.customStatus,
    created: u.created,
    status: presence(u.id)
  }
}

function meUser(u) {
  return { ...publicUser(u), setStatus: u.status }
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload))
}

function sendTo(ids, payload) {
  const data = JSON.stringify(payload)
  for (const id of ids) {
    const set = sockets.get(id)
    if (!set) continue
    for (const ws of set) if (ws.readyState === 1) ws.send(data)
  }
}

function sendAll(payload) {
  sendTo([...sockets.keys()], payload)
}

function audience(ch) {
  if (ch.type === 'dm') return ch.members
  const s = db.servers[ch.serverId]
  return s ? s.members : []
}

function canSee(userId, ch) {
  return !!ch && audience(ch).includes(userId)
}

function getChannel(userId, id) {
  const ch = db.channels[id]
  if (!canSee(userId, ch)) fail('Channel not found')
  return ch
}

function getServer(userId, id, ownerOnly) {
  const s = db.servers[id]
  if (!s || !s.members.includes(userId)) fail('Server not found')
  if (ownerOnly && s.owner !== userId) fail('Only the server owner can do that')
  return s
}

function canModerate(userId, ch) {
  if (ch.type === 'dm') return true
  const s = db.servers[ch.serverId]
  return !!s && s.owner === userId
}

function findMsg(userId, channelId, messageId) {
  const ch = getChannel(userId, channelId)
  const list = db.messages[ch.id] || []
  const i = list.findIndex(m => m.id === messageId)
  if (i < 0) fail('Message not found')
  return { ch, list, m: list[i], i }
}

function isMention(m, userId) {
  return !!m.everyone || (m.mentions || []).includes(userId)
}

function channelFor(userId, ch) {
  const list = db.messages[ch.id] || []
  const read = (db.reads[userId] || {})[ch.id] || 0
  let unread = 0
  let mentions = 0
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m.time <= read) break
    if (m.author === userId) continue
    unread++
    if (!m.system && (ch.type === 'dm' || isMention(m, userId))) mentions++
  }
  const last = list[list.length - 1]
  return { ...ch, lastAt: last ? last.time : ch.created, unread, mentions }
}

function markRead(userId, channelId, time) {
  db.reads[userId] = db.reads[userId] || {}
  db.reads[userId][channelId] = Math.max(db.reads[userId][channelId] || 0, time)
  save()
}

function findMentions(text) {
  const ids = []
  for (const match of text.matchAll(/@([a-z0-9_.]{2,20})/gi)) {
    const u = byUsername(match[1].replace(/\.+$/, ''))
    if (u && !ids.includes(u.id)) ids.push(u.id)
  }
  return ids
}

function out(m) {
  if (!m.replyTo) return m
  const r = (db.messages[m.channelId] || []).find(x => x.id === m.replyTo)
  const reply = r
    ? { id: r.id, author: r.author, text: r.text.slice(0, 140), attachments: r.attachments.length }
    : { id: m.replyTo, missing: true }
  return { ...m, reply }
}

function addChannel(s, name, topic) {
  const ch = { id: uid(), serverId: s.id, type: 'text', name, topic: topic || '', created: Date.now() }
  db.channels[ch.id] = ch
  db.messages[ch.id] = []
  s.channels.push(ch.id)
  return ch
}

function ensureLounge() {
  let s = Object.values(db.servers).find(x => x.lounge)
  if (s) return s
  s = { id: uid(), name: 'Wicky Lounge', owner: null, lounge: true, color: '#5865f2', invite: 'lounge', members: [], channels: [], created: Date.now() }
  db.servers[s.id] = s
  addChannel(s, 'general', 'talk about anything, be nice')
  addChannel(s, 'homework-help', 'ask for help, dont just copy answers')
  addChannel(s, 'memes', '')
  addChannel(s, 'off-topic', '')
  save()
  return s
}

function systemPost(ch, author, kind) {
  const m = {
    id: uid(), channelId: ch.id, author, system: kind, text: '', time: Date.now(), edited: null,
    replyTo: null, reactions: {}, attachments: [], mentions: [], everyone: false, pinned: false
  }
  db.messages[ch.id].push(m)
  save()
  sendTo(audience(ch), { t: 'message', msg: m })
}

function addMember(userId, s) {
  if (s.members.includes(userId)) return
  const others = s.members.slice()
  s.members.push(userId)
  save()
  sendTo(others, { t: 'server', server: s })
  sendTo([userId], { t: 'server', server: s, channels: s.channels.map(id => channelFor(userId, db.channels[id])) })
  const first = db.channels[s.channels[0]]
  if (first) systemPost(first, userId, 'join')
}

function removeMember(userId, s, reason) {
  s.members = s.members.filter(id => id !== userId)
  save()
  sendTo([userId], { t: 'serverRemove', serverId: s.id, reason })
  sendTo(s.members, { t: 'server', server: s })
}

function pushFriends(...ids) {
  for (const id of ids) sendTo([id], { t: 'friends', friends: db.friends[id] || {} })
}

function setFriend(a, b, state) {
  db.friends[a] = db.friends[a] || {}
  if (state) db.friends[a][b] = state
  else delete db.friends[a][b]
}

function channelName(v) {
  const n = str(v, 60).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
  if (!n) fail('Pick a channel name')
  return n
}

const recent = new Map()
function rate(id) {
  const now = Date.now()
  const list = (recent.get(id) || []).filter(t => now - t < 5000)
  if (list.length >= 8) fail('Slow down, your sending messages too fast')
  list.push(now)
  recent.set(id, list)
}

function cleanAttachments(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, 10)
    .filter(a => a && typeof a.url === 'string' && /^\/uploads\/[a-z0-9]+(\.[a-z0-9]{1,8})?$/.test(a.url))
    .map(a => ({ url: a.url, name: str(a.name, 200) || 'file', type: str(a.type, 100), size: Number(a.size) || 0 }))
}

const handlers = {
  send(me, d) {
    const ch = getChannel(me, d.channelId)
    const text = str(d.text, 4000)
    const attachments = cleanAttachments(d.attachments)
    if (!text && !attachments.length) fail('Message is empty')
    rate(me)
    const list = db.messages[ch.id] || (db.messages[ch.id] = [])
    const replied = d.replyTo ? list.find(m => m.id === d.replyTo && !m.system) : null
    const m = {
      id: uid(), channelId: ch.id, author: me, text, time: Date.now(), edited: null,
      replyTo: replied ? replied.id : null, reactions: {}, attachments,
      mentions: findMentions(text), everyone: ch.type !== 'dm' && /@(everyone|here)\b/.test(text), pinned: false
    }
    if (replied && replied.author !== me && !m.mentions.includes(replied.author)) m.mentions.push(replied.author)
    list.push(m)
    markRead(me, ch.id, m.time)
    sendTo(audience(ch), { t: 'message', msg: out(m) })
    return { id: m.id }
  },

  history(me, d) {
    const ch = getChannel(me, d.channelId)
    const list = db.messages[ch.id] || []
    let end = list.length
    if (d.before) {
      const i = list.findIndex(m => m.id === d.before)
      if (i >= 0) end = i
    }
    const start = Math.max(0, end - PAGE)
    return { messages: list.slice(start, end).map(out), more: start > 0 }
  },

  edit(me, d) {
    const { ch, m } = findMsg(me, d.channelId, d.messageId)
    if (m.author !== me || m.system) fail('You can only edit your own messages')
    const text = str(d.text, 4000)
    if (!text && !m.attachments.length) fail('Message is empty')
    if (text === m.text) return {}
    m.text = text
    m.edited = Date.now()
    m.mentions = findMentions(text)
    m.everyone = ch.type !== 'dm' && /@(everyone|here)\b/.test(text)
    save()
    sendTo(audience(ch), { t: 'messageUpdate', msg: out(m) })
    return {}
  },

  delete(me, d) {
    const { ch, list, m, i } = findMsg(me, d.channelId, d.messageId)
    if (m.author !== me && !(ch.type !== 'dm' && canModerate(me, ch))) fail('You cant delete that message')
    list.splice(i, 1)
    save()
    sendTo(audience(ch), { t: 'messageDelete', channelId: ch.id, id: m.id })
    return {}
  },

  react(me, d) {
    const { ch, m } = findMsg(me, d.channelId, d.messageId)
    const emoji = str(d.emoji, 32)
    if (!emoji || m.system) fail('Cant react to that')
    const users = m.reactions[emoji] || []
    if (users.includes(me)) {
      m.reactions[emoji] = users.filter(id => id !== me)
      if (!m.reactions[emoji].length) delete m.reactions[emoji]
    } else {
      if (!m.reactions[emoji] && Object.keys(m.reactions).length >= 20) fail('Too many diffrent reactions on this message')
      m.reactions[emoji] = users.concat(me)
    }
    save()
    sendTo(audience(ch), { t: 'messageUpdate', msg: out(m) })
    return {}
  },

  pin(me, d) {
    const { ch, m } = findMsg(me, d.channelId, d.messageId)
    if (m.system) fail('Cant pin that')
    if (!canModerate(me, ch) && m.author !== me) fail('Only the owner or the author can pin this')
    if (!m.pinned && (db.messages[ch.id] || []).filter(x => x.pinned).length >= 50) fail('This channel already has 50 pins')
    m.pinned = !m.pinned
    save()
    sendTo(audience(ch), { t: 'messageUpdate', msg: out(m) })
    return { pinned: m.pinned }
  },

  pins(me, d) {
    const ch = getChannel(me, d.channelId)
    return { messages: (db.messages[ch.id] || []).filter(m => m.pinned).reverse().map(out) }
  },

  search(me, d) {
    let q = str(d.q, 100).toLowerCase()
    let from = null
    q = q.replace(/from:@?([a-z0-9_.]+)/, (_, n) => {
      const u = byUsername(n)
      from = u ? u.id : '-'
      return ''
    }).trim()
    if (!q && !from) fail('Type something to search for')
    const chans = d.serverId
      ? getServer(me, d.serverId).channels.map(id => db.channels[id]).filter(Boolean)
      : [getChannel(me, d.channelId)]
    const results = []
    for (const ch of chans) {
      for (const m of db.messages[ch.id] || []) {
        if (m.system) continue
        if (from && m.author !== from) continue
        if (q && !m.text.toLowerCase().includes(q) && !m.attachments.some(a => a.name.toLowerCase().includes(q))) continue
        results.push(m)
      }
    }
    results.sort((a, b) => b.time - a.time)
    return { total: results.length, messages: results.slice(0, 50).map(out) }
  },

  typing(me, d) {
    const ch = getChannel(me, d.channelId)
    sendTo(audience(ch).filter(id => id !== me), { t: 'typing', channelId: ch.id, userId: me })
  },

  read(me, d) {
    const ch = getChannel(me, d.channelId)
    markRead(me, ch.id, Date.now())
    sendTo([me], { t: 'read', channelId: ch.id })
  },

  createServer(me, d) {
    const name = str(d.name, 40)
    if (!name) fail('Your server needs a name')
    if (Object.values(db.servers).filter(s => s.owner === me).length >= 25) fail('You own to many servers already')
    const s = { id: uid(), name, owner: me, color: pick(COLORS), invite: newInvite(), members: [me], channels: [], created: Date.now() }
    db.servers[s.id] = s
    addChannel(s, 'general', '')
    save()
    sendTo([me], { t: 'server', server: s, channels: s.channels.map(id => channelFor(me, db.channels[id])) })
    return { serverId: s.id }
  },

  joinServer(me, d) {
    let code = str(d.invite, 200).toLowerCase()
    code = code.split('/').filter(Boolean).pop() || ''
    const s = Object.values(db.servers).find(x => x.invite === code)
    if (!s) fail('That invite is invalid or has expired')
    addMember(me, s)
    return { serverId: s.id }
  },

  leaveServer(me, d) {
    const s = getServer(me, d.serverId)
    if (s.owner === me) fail('Owners cant leave, delete the server instead')
    removeMember(me, s, 'left')
    return {}
  },

  deleteServer(me, d) {
    const s = getServer(me, d.serverId, true)
    for (const id of s.channels) {
      delete db.channels[id]
      delete db.messages[id]
    }
    delete db.servers[s.id]
    save()
    sendTo(s.members, { t: 'serverRemove', serverId: s.id, reason: 'deleted', name: s.name })
    return {}
  },

  updateServer(me, d) {
    const s = getServer(me, d.serverId, true)
    if (d.name !== undefined) {
      const name = str(d.name, 40)
      if (!name) fail('Your server needs a name')
      s.name = name
    }
    if (d.color && /^#[0-9a-f]{6}$/i.test(d.color)) s.color = d.color
    if (d.newInvite) s.invite = newInvite()
    save()
    sendTo(s.members, { t: 'server', server: s })
    return { invite: s.invite }
  },

  kick(me, d) {
    const s = getServer(me, d.serverId, true)
    if (d.userId === me || !s.members.includes(d.userId)) fail('Cant kick that person')
    removeMember(d.userId, s, 'kicked')
    return {}
  },

  createChannel(me, d) {
    const s = getServer(me, d.serverId, true)
    if (s.channels.length >= 50) fail('A server can have 50 channels max')
    const ch = addChannel(s, channelName(d.name), str(d.topic, 200))
    save()
    for (const id of s.members) sendTo([id], { t: 'channel', channel: channelFor(id, ch) })
    sendTo(s.members, { t: 'server', server: s })
    return { channelId: ch.id }
  },

  updateChannel(me, d) {
    const ch = getChannel(me, d.channelId)
    if (ch.type === 'dm') fail('Cant edit a DM')
    getServer(me, ch.serverId, true)
    if (d.name !== undefined) ch.name = channelName(d.name)
    if (d.topic !== undefined) ch.topic = str(d.topic, 200)
    save()
    sendTo(audience(ch), { t: 'channel', channel: ch })
    return {}
  },

  deleteChannel(me, d) {
    const ch = getChannel(me, d.channelId)
    if (ch.type === 'dm') fail('Cant delete a DM')
    const s = getServer(me, ch.serverId, true)
    if (s.channels.length <= 1) fail('A server needs atleast one channel')
    s.channels = s.channels.filter(id => id !== ch.id)
    delete db.channels[ch.id]
    delete db.messages[ch.id]
    save()
    sendTo(s.members, { t: 'channelRemove', channelId: ch.id, serverId: s.id })
    sendTo(s.members, { t: 'server', server: s })
    return {}
  },

  moveChannel(me, d) {
    const ch = getChannel(me, d.channelId)
    const s = getServer(me, ch.serverId, true)
    const i = s.channels.indexOf(ch.id)
    const j = i + (d.dir < 0 ? -1 : 1)
    if (j < 0 || j >= s.channels.length) return {}
    s.channels[i] = s.channels[j]
    s.channels[j] = ch.id
    save()
    sendTo(s.members, { t: 'server', server: s })
    return {}
  },

  openDm(me, d) {
    const other = db.users[d.userId]
    if (!other || other.id === me) fail('User not found')
    let ch = Object.values(db.channels).find(c => c.type === 'dm' && c.members.includes(me) && c.members.includes(other.id))
    if (!ch) {
      ch = { id: uid(), type: 'dm', members: [me, other.id], created: Date.now() }
      db.channels[ch.id] = ch
      db.messages[ch.id] = []
      save()
      sendTo([other.id], { t: 'channel', channel: channelFor(other.id, ch) })
    }
    sendTo([me], { t: 'channel', channel: channelFor(me, ch) })
    return { channelId: ch.id }
  },

  friendRequest(me, d) {
    const other = d.userId ? db.users[d.userId] : byUsername(str(d.username, 40).replace(/^@/, ''))
    if (!other) fail('Hm, didnt work. Double check that the username is correct.')
    if (other.id === me) fail('You cant add yourself, sorry')
    const state = (db.friends[me] || {})[other.id]
    if (state === 'friends') fail('You are already friends with ' + other.name)
    if (state === 'outgoing') fail('You already sent them a request')
    if (state === 'incoming') {
      setFriend(me, other.id, 'friends')
      setFriend(other.id, me, 'friends')
    } else {
      setFriend(me, other.id, 'outgoing')
      setFriend(other.id, me, 'incoming')
    }
    save()
    pushFriends(me, other.id)
    return { state: db.friends[me][other.id], name: other.name }
  },

  friendAccept(me, d) {
    if ((db.friends[me] || {})[d.userId] !== 'incoming') fail('No request from that person')
    setFriend(me, d.userId, 'friends')
    setFriend(d.userId, me, 'friends')
    save()
    pushFriends(me, d.userId)
    return {}
  },

  friendRemove(me, d) {
    setFriend(me, d.userId, null)
    setFriend(d.userId, me, null)
    save()
    pushFriends(me, d.userId)
    return {}
  },

  updateMe(me, d) {
    const u = db.users[me]
    if (d.name !== undefined) {
      const name = str(d.name, 32)
      if (!name) fail('Display name cant be empty')
      u.name = name
    }
    if (d.color !== undefined && /^#[0-9a-f]{6}$/i.test(d.color)) u.color = d.color
    if (d.about !== undefined) u.about = str(d.about, 190)
    if (d.customStatus !== undefined) u.customStatus = str(d.customStatus, 60)
    if (d.status !== undefined && STATUSES.includes(d.status)) u.status = d.status
    save()
    sendAll({ t: 'user', user: publicUser(u) })
    sendTo([me], { t: 'me', me: meUser(u) })
    return {}
  },

  changePassword(me, d) {
    const u = db.users[me]
    if (!checkPassword(u, d.old || '')) fail('Your current password is wrong')
    if (String(d.next || '').length < 4) fail('New password needs atleast 4 characters')
    u.salt = crypto.randomBytes(16).toString('hex')
    u.hash = hashPassword(d.next, u.salt)
    save()
    return {}
  }
}

function ready(userId) {
  const u = db.users[userId]
  return {
    t: 'ready',
    me: meUser(u),
    users: Object.values(db.users).map(publicUser),
    servers: Object.values(db.servers).filter(s => s.members.includes(userId)),
    channels: Object.values(db.channels).filter(c => canSee(userId, c)).map(c => channelFor(userId, c)),
    friends: db.friends[userId] || {}
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
}
const INLINE_UPLOADS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg']

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooBig = false
    req.on('data', c => {
      size += c.length
      if (size > limit) tooBig = true
      else chunks.push(c)
    })
    req.on('end', () => {
      if (tooBig) {
        const e = new Error('That file is to big, 10 MB is the limit')
        e.expose = true
        e.status = 413
        reject(e)
      } else resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

async function api(req, res, route) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })

  if (route === '/api/upload') {
    const userId = db.tokens[req.headers.authorization]
    if (!userId) return json(res, 401, { error: 'Log in first' })
    const buf = await readBody(req, MAX_UPLOAD)
    if (!buf.length) fail('That file is empty')
    let name = 'file'
    try { name = decodeURIComponent(req.headers['x-filename'] || 'file') } catch (e) {}
    name = name.replace(/[\\/\0]/g, '_').slice(0, 120) || 'file'
    let ext = path.extname(name).toLowerCase()
    if (!/^\.[a-z0-9]{1,8}$/.test(ext)) ext = ''
    const file = uid() + ext
    fs.writeFileSync(path.join(UPLOADS, file), buf)
    return json(res, 200, { url: '/uploads/' + file, name, type: TYPES[ext] || 'application/octet-stream', size: buf.length })
  }

  let body = {}
  try { body = JSON.parse((await readBody(req, 100000)).toString() || '{}') } catch (e) { fail('Bad request') }

  if (route === '/api/register') {
    const username = str(body.username, 40).toLowerCase()
    if (!/^[a-z0-9_.]{2,20}$/.test(username)) fail('Usernames are 2 to 20 letters, numbers, dots or underscores')
    if (['everyone', 'here', 'system'].includes(username) || byUsername(username)) fail('That username is taken')
    const password = String(body.password || '')
    if (password.length < 4) fail('Password needs atleast 4 characters')
    const salt = crypto.randomBytes(16).toString('hex')
    const u = {
      id: uid(), username, name: str(body.name, 32) || username, hash: hashPassword(password, salt), salt,
      color: pick(COLORS), about: '', customStatus: '', status: 'online', created: Date.now()
    }
    db.users[u.id] = u
    const token = newToken(u.id)
    sendAll({ t: 'user', user: publicUser(u) })
    const lounge = ensureLounge()
    if (!lounge.owner) lounge.owner = u.id
    addMember(u.id, lounge)
    save()
    return json(res, 200, { token })
  }

  if (route === '/api/login') {
    const u = byUsername(str(body.username, 40))
    if (!u || !checkPassword(u, body.password || '')) fail('Wrong username or password')
    return json(res, 200, { token: newToken(u.id) })
  }

  if (route === '/api/logout') {
    delete db.tokens[body.token]
    save()
    return json(res, 200, {})
  }

  json(res, 404, { error: 'Not found' })
}

function serveFile(res, file, headers) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('Not found')
    }
    res.writeHead(200, { 'Content-Length': st.size, ...headers })
    fs.createReadStream(file).pipe(res)
  })
}

const server = http.createServer(async (req, res) => {
  let route
  try { route = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch (e) { route = '/' }

  if (route.startsWith('/api/')) {
    try {
      await api(req, res, route)
    } catch (e) {
      if (!e.expose) console.error(e)
      if (!res.headersSent) json(res, e.status || (e.expose ? 400 : 500), { error: e.expose ? e.message : 'Something went wrong' })
    }
    return
  }

  if (route.startsWith('/uploads/')) {
    const file = path.basename(route)
    const ext = path.extname(file).toLowerCase()
    const inline = INLINE_UPLOADS.includes(ext)
    return serveFile(res, path.join(UPLOADS, file), {
      'Content-Type': inline ? TYPES[ext] : 'application/octet-stream',
      'Content-Disposition': inline ? 'inline' : 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=604800'
    })
  }

  const file = path.normalize(path.join(PUBLIC, route === '/' ? 'index.html' : route))
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403)
    return res.end()
  }
  serveFile(res, file, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
})

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 })

wss.on('connection', ws => {
  ws.alive = true
  ws.on('pong', () => { ws.alive = true })

  ws.on('message', raw => {
    let msg
    try { msg = JSON.parse(raw) } catch (e) { return }
    if (!msg || typeof msg !== 'object') return

    if (!ws.userId) {
      if (msg.t !== 'auth') return
      const userId = db.tokens[msg.token]
      if (!userId || !db.users[userId]) {
        send(ws, { t: 'authFail' })
        return ws.close()
      }
      ws.userId = userId
      const first = !sockets.has(userId)
      if (first) sockets.set(userId, new Set())
      sockets.get(userId).add(ws)
      send(ws, ready(userId))
      if (first) sendAll({ t: 'user', user: publicUser(db.users[userId]) })
      return
    }

    if (!Object.hasOwn(handlers, msg.t)) return
    try {
      const data = handlers[msg.t](ws.userId, msg)
      if (msg.id) send(ws, { t: 'res', id: msg.id, ok: true, data: data || {} })
    } catch (e) {
      if (!e.expose) console.error(e)
      if (msg.id) send(ws, { t: 'res', id: msg.id, ok: false, error: e.expose ? e.message : 'Something went wrong' })
    }
  })

  ws.on('close', () => {
    const set = sockets.get(ws.userId)
    if (!set) return
    set.delete(ws)
    if (set.size) return
    sockets.delete(ws.userId)
    const u = db.users[ws.userId]
    if (u) sendAll({ t: 'user', user: publicUser(u) })
  })
})

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate()
      continue
    }
    ws.alive = false
    ws.ping()
  }
}, 30000)

ensureLounge()

server.listen(PORT, () => {
  console.log('Wicky Lite is running on http://localhost:' + PORT)
})
