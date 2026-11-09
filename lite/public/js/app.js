const S = {
  token: store.get('token', null),
  ready: false,
  me: null,
  users: {},
  servers: {},
  channels: {},
  msgs: {},
  more: {},
  loading: {},
  friends: {},
  serverId: '@me',
  channelId: null,
  lastIn: store.get('lastIn', {}),
  typing: {},
  reply: null,
  editing: null,
  files: [],
  drafts: {},
  right: store.get('right', 'people'),
  friendsTab: 'online',
  hiddenDms: store.get('hiddenDms', {}),
  stick: false,
  atBottom: true,
  prepending: false,
  jumpTarget: null,
  loadingOlder: false,
  pins: null,
  search: null,
  searchQ: '',
  ac: null,
  popup: null
}

if (innerWidth < 1100) S.right = null

const prefs = Object.assign({ sounds: true, desktop: false, compact: false, enterSends: true }, store.get('prefs', {}))
const QUICK = ['👍', '❤️', '😂', '🔥']
const COLORS = ['#5865f2', '#e0632f', '#ac3ba8', '#e64f7a', '#2dc2c5', '#23a55a', '#f0b232', '#368bd6', '#9b59b6', '#eb459e', '#747f8d', '#1abc9c']
const ALL = ['rail', 'side', 'user', 'head', 'center', 'msgs', 'right', 'typing']

function user(id) {
  return S.users[id] || { id, name: 'Unknown User', username: 'unknown', color: '#4e5058', status: 'offline', about: '', customStatus: '', created: 0 }
}

function chan() {
  return S.channels[S.channelId] || null
}

function dmOther(ch) {
  return user(ch.members.find(id => id !== S.me.id) || S.me.id)
}

function chName(ch) {
  return ch.type === 'dm' ? '@' + dmOther(ch).name : '#' + ch.name
}

function isOwner(serverId, userId) {
  const s = S.servers[serverId]
  return !!s && s.owner === (userId || S.me.id)
}

function canModerate(ch) {
  return ch.type === 'dm' || isOwner(ch.serverId)
}

function memberIds(ch) {
  if (!ch) return []
  if (ch.type === 'dm') return ch.members
  return (S.servers[ch.serverId] || {}).members || []
}

function isMentioned(m) {
  return m.author !== S.me.id && !m.system && (!!m.everyone || (m.mentions || []).includes(S.me.id))
}

function serverChannels(s) {
  return s.channels.map(id => S.channels[id]).filter(Boolean)
}

function sortedServers() {
  return Object.values(S.servers).sort((a, b) => a.created - b.created)
}

function dmList() {
  return Object.values(S.channels)
    .filter(c => {
      if (c.type !== 'dm') return false
      if (c.id === S.channelId) return true
      if (!(c.lastAt > c.created) && !c.opened) return false
      const hidden = S.hiddenDms[c.id]
      return !(hidden && hidden >= c.lastAt)
    })
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
}

function findDm(userId) {
  return Object.values(S.channels).find(c => c.type === 'dm' && c.members.includes(userId) && c.members.includes(S.me.id))
}

function incomingCount() {
  return Object.values(S.friends).filter(v => v === 'incoming').length
}

function serverState(s) {
  let unread = false
  let mentions = 0
  for (const c of serverChannels(s)) {
    if (c.unread) unread = true
    mentions += c.mentions || 0
  }
  return { unread, mentions }
}

function mutualServers(userId) {
  return sortedServers().filter(s => s.members.includes(userId))
}

let dirty = {}
let raf = 0
function queue(...parts) {
  for (const p of parts) dirty[p] = true
  if (!raf) raf = requestAnimationFrame(flush)
}

function flush() {
  raf = 0
  const d = dirty
  dirty = {}
  if (!S.ready) return
  if (d.rail) renderRail()
  if (d.side) renderSide()
  if (d.user) renderUserbar()
  if (d.head) renderHead()
  if (d.center) renderCenter()
  if (d.msgs) renderMessages()
  if (d.right) renderRight()
  if (d.typing) renderTyping()
  updateTitle()
}

let authMode = 'login'

function showAuth() {
  S.ready = false
  $('#loading').classList.add('hidden')
  $('#app').classList.add('hidden')
  $('#auth').classList.remove('hidden')
  setAuthMode(authMode)
}

function showLoading() {
  $('#auth').classList.add('hidden')
  $('#app').classList.add('hidden')
  $('#loading').classList.remove('hidden')
}

function setAuthMode(mode) {
  authMode = mode
  const reg = mode === 'register'
  $('#authTitle').textContent = reg ? 'Create an account' : 'Welcome back!'
  $('#authSub').textContent = reg ? 'Pick a username, you can change your display name whenever you want.' : "We're so exited to see you again!"
  $('#authBtn').textContent = reg ? 'Continue' : 'Log In'
  $('#authSwitchText').textContent = reg ? 'Already have an account?' : 'Need an account?'
  $('#authSwitch').textContent = reg ? 'Log In' : 'Register'
  $$('.reg-only').forEach(el => el.classList.toggle('hidden', !reg))
  $('[name=password]').autocomplete = reg ? 'new-password' : 'current-password'
  $('#authError').textContent = ''
}

$('.auth-logo').innerHTML = icon('logo', 34)

$('#authSwitch').addEventListener('click', e => {
  e.preventDefault()
  setAuthMode(authMode === 'login' ? 'register' : 'login')
})

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(e.target))
  const btn = $('#authBtn')
  btn.disabled = true
  $('#authError').textContent = ''
  try {
    const r = await api('/api/' + authMode, data)
    S.token = r.token
    store.set('token', r.token)
    e.target.reset()
    showLoading()
    connect(r.token)
  } catch (err) {
    $('#authError').textContent = err.message
  }
  btn.disabled = false
})

async function logout() {
  try { await api('/api/logout', { token: S.token }) } catch (e) {}
  disconnect()
  store.del('token')
  S.token = null
  S.ready = false
  S.msgs = {}
  closeModal()
  closePopups()
  setAuthMode('login')
  showAuth()
}

net.onAuthFail = () => {
  store.del('token')
  S.token = null
  showAuth()
}

net.onDown = () => {
  if (S.ready) $('#banner').classList.remove('hidden')
}

net.onEvent = e => {
  switch (e.t) {
    case 'ready': return onReady(e)
    case 'message': return onMessage(e.msg)
    case 'messageUpdate': return onMessageUpdate(e.msg)
    case 'messageDelete': return onMessageDelete(e.channelId, e.id)
    case 'typing': return onTyping(e.channelId, e.userId)
    case 'user': return onUser(e.user)
    case 'me': return onMe(e.me)
    case 'server': return onServer(e.server, e.channels)
    case 'serverRemove': return onServerRemove(e)
    case 'channel': return onChannel(e.channel)
    case 'channelRemove': return onChannelRemove(e.channelId, e.serverId)
    case 'friends': return onFriends(e.friends)
    case 'read': return onRead(e.channelId)
  }
}

function onReady(e) {
  const first = !S.ready
  S.me = e.me
  S.users = {}
  for (const u of e.users) S.users[u.id] = u
  S.servers = {}
  for (const s of e.servers) S.servers[s.id] = s
  S.channels = {}
  for (const c of e.channels) S.channels[c.id] = c
  S.friends = e.friends || {}
  S.msgs = {}
  S.more = {}
  S.loading = {}
  S.typing = {}
  S.ready = true
  document.body.classList.toggle('compact', !!prefs.compact)
  $('#auth').classList.add('hidden')
  $('#loading').classList.add('hidden')
  $('#app').classList.remove('hidden')
  $('#banner').classList.add('hidden')
  if (first) route()
  else go(S.serverId, S.channelId, true)
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'invite' && parts[1]) {
    go('@me', null)
    joinServerModal(parts[1])
    return
  }
  if (parts[0] && parts[0] !== '@me' && S.servers[parts[0]]) return go(parts[0], parts[1])
  if (parts[0] === '@me' && parts[1] && S.channels[parts[1]]) return go('@me', parts[1])
  const last = store.get('lastServer', '@me')
  if (last !== '@me' && S.servers[last]) return go(last)
  go('@me', S.lastIn['@me'] && S.channels[S.lastIn['@me']] ? S.lastIn['@me'] : null)
}

window.addEventListener('hashchange', () => {
  if (S.ready) route()
})

function go(serverId, channelId, keep) {
  saveDraft()
  if (!keep) {
    S.reply = null
    S.editing = null
    S.files = []
    S.search = null
    if (S.right === 'search' || S.right === 'pins') S.right = store.get('right', 'people')
  }
  if (serverId !== '@me') {
    const s = S.servers[serverId]
    if (!s) return go('@me', null)
    if (!channelId || !s.channels.includes(channelId)) {
      const last = S.lastIn[serverId]
      channelId = last && s.channels.includes(last) ? last : s.channels[0]
    }
  } else if (channelId && !S.channels[channelId]) {
    channelId = null
  }
  const changed = S.serverId !== serverId || S.channelId !== channelId
  S.serverId = serverId
  S.channelId = channelId
  S.lastIn[serverId] = channelId
  store.set('lastIn', S.lastIn)
  store.set('lastServer', serverId)
  const hash = '#/' + serverId + (channelId ? '/' + channelId : '')
  if (location.hash !== hash) history.replaceState(null, '', hash)
  if (channelId) {
    const ch = S.channels[channelId]
    if (S.hiddenDms[channelId]) {
      delete S.hiddenDms[channelId]
      store.set('hiddenDms', S.hiddenDms)
    }
    if (ch.type === 'dm') ch.opened = true
    S.stick = true
    loadChannel(channelId)
    markRead(channelId)
  }
  if (changed) {
    hideAc()
    restoreDraft()
  }
  closeDrawer()
  queue(...ALL)
  if (channelId && changed && !matchMedia('(pointer: coarse)').matches) setTimeout(() => $('#input').focus(), 0)
}

function loadChannel(id) {
  if (S.msgs[id]) {
    queue('msgs')
    return Promise.resolve()
  }
  if (S.loading[id]) return S.loading[id]
  const p = request('history', { channelId: id })
    .then(r => {
      S.msgs[id] = r.messages
      S.more[id] = r.more
      if (S.channelId === id) {
        S.stick = true
        queue('msgs')
      }
    })
    .catch(e => toast(e.message, 'bad'))
    .finally(() => { delete S.loading[id] })
  S.loading[id] = p
  return p
}

async function loadOlder(id) {
  if (S.loadingOlder || !S.more[id]) return
  const list = S.msgs[id]
  if (!list || !list.length) return
  S.loadingOlder = true
  try {
    const r = await request('history', { channelId: id, before: list[0].id })
    S.msgs[id] = r.messages.concat(S.msgs[id] || [])
    S.more[id] = r.more
    if (S.channelId === id) {
      S.prepending = true
      queue('msgs')
    }
  } catch (e) {
    toast(e.message, 'bad')
  }
  S.loadingOlder = false
}

function markRead(id, force) {
  const ch = S.channels[id]
  if (!ch) return
  if (!force && !ch.unread && !ch.mentions) return
  ch.unread = 0
  ch.mentions = 0
  fire('read', { channelId: id })
  queue('rail', 'side')
}

function viewing(id) {
  return S.channelId === id && !document.hidden && document.hasFocus()
}

function onMessage(m) {
  const ch = S.channels[m.channelId]
  if (!ch) return
  ch.lastAt = m.time
  const list = S.msgs[m.channelId]
  if (list && !list.some(x => x.id === m.id)) list.push(m)
  const mine = m.author === S.me.id
  if (!mine) {
    if (viewing(ch.id)) {
      markRead(ch.id, true)
    } else {
      ch.unread = (ch.unread || 0) + 1
      if (!m.system && (ch.type === 'dm' || isMentioned(m))) {
        ch.mentions = (ch.mentions || 0) + 1
        notify(m, ch)
      }
    }
  }
  if (ch.type === 'dm' && S.hiddenDms[ch.id]) {
    delete S.hiddenDms[ch.id]
    store.set('hiddenDms', S.hiddenDms)
  }
  if (S.typing[ch.id]) delete S.typing[ch.id][m.author]
  if (S.channelId === ch.id) {
    if (mine) S.stick = true
    queue('msgs', 'typing')
  }
  queue('rail', 'side')
}

function onMessageUpdate(m) {
  const list = S.msgs[m.channelId]
  if (list) {
    const i = list.findIndex(x => x.id === m.id)
    if (i >= 0) list[i] = m
  }
  if (S.channelId === m.channelId) {
    queue('msgs')
    if (S.right === 'pins') loadPins()
  }
}

function onMessageDelete(channelId, id) {
  const list = S.msgs[channelId]
  if (list) {
    S.msgs[channelId] = list.filter(x => x.id !== id)
    for (const m of S.msgs[channelId]) if (m.replyTo === id) m.reply = { id, missing: true }
  }
  if (S.editing && S.editing.id === id) S.editing = null
  if (S.reply && S.reply.id === id) {
    S.reply = null
    renderReplyBar()
  }
  if (S.channelId === channelId) {
    queue('msgs')
    if (S.right === 'pins') loadPins()
    if (S.search) S.search.messages = S.search.messages.filter(x => x.id !== id)
    queue('right')
  }
}

function onTyping(channelId, userId) {
  S.typing[channelId] = S.typing[channelId] || {}
  S.typing[channelId][userId] = Date.now() + 6000
  if (channelId === S.channelId) queue('typing')
}

function onUser(u) {
  S.users[u.id] = u
  if (S.me && u.id === S.me.id) S.me = Object.assign({}, S.me, u)
  queue('side', 'head', 'msgs', 'right', 'center', 'user')
}

function onMe(me) {
  S.me = me
  S.users[me.id] = Object.assign({}, S.users[me.id], me)
  queue('user', 'side', 'msgs', 'right', 'head')
}

function onServer(s, channels) {
  S.servers[s.id] = s
  if (channels) for (const c of channels) S.channels[c.id] = Object.assign(S.channels[c.id] || {}, c)
  if (S.serverId === s.id && !s.channels.includes(S.channelId)) go(s.id)
  queue(...ALL)
}

function onServerRemove(e) {
  const s = S.servers[e.serverId]
  const name = (s && s.name) || e.name || 'the server'
  delete S.servers[e.serverId]
  for (const id in S.channels) {
    if (S.channels[id].serverId === e.serverId) {
      delete S.channels[id]
      delete S.msgs[id]
    }
  }
  if (e.reason === 'kicked') toast('You were kicked from ' + name, 'bad')
  else if (e.reason === 'deleted') toast(name + ' was deleted')
  if (S.serverId === e.serverId) go('@me', null)
  else queue(...ALL)
}

function onChannel(c) {
  const old = S.channels[c.id]
  S.channels[c.id] = Object.assign(old || { unread: 0, mentions: 0, lastAt: c.created }, c)
  queue(...ALL)
}

function onChannelRemove(id, serverId) {
  delete S.channels[id]
  delete S.msgs[id]
  if (S.channelId === id) go(serverId)
  else queue(...ALL)
}

function onFriends(f) {
  const before = incomingCount()
  S.friends = f || {}
  if (incomingCount() > before) {
    if (prefs.sounds && S.me.setStatus !== 'dnd') beep(520)
    toast('You got a new friend request')
  }
  queue('rail', 'side', 'center', 'head', 'right')
}

function onRead(id) {
  const ch = S.channels[id]
  if (!ch) return
  ch.unread = 0
  ch.mentions = 0
  queue('rail', 'side')
}

function notify(m, ch) {
  if (S.me.setStatus === 'dnd') return
  if (prefs.sounds) beep()
  if (prefs.desktop && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const u = user(m.author)
    try {
      const n = new Notification(u.name + (ch.type === 'dm' ? '' : ' (#' + ch.name + ')'), { body: m.text || 'Sent an attachment', tag: ch.id })
      n.onclick = () => {
        window.focus()
        go(ch.type === 'dm' ? '@me' : ch.serverId, ch.id)
        n.close()
      }
    } catch (e) {}
  }
}

function updateTitle() {
  let total = incomingCount()
  for (const id in S.channels) total += S.channels[id].mentions || 0
  const ch = chan()
  document.title = (total ? '(' + total + ') ' : '') + (ch ? chName(ch) + ' | ' : S.serverId === '@me' ? 'Friends | ' : '') + 'Wicky Lite'
}

function pill(o) {
  return '<div class="rail-item' + (o.active ? ' active' : '') + (o.unread ? ' unread' : '') + '"><span class="pip"></span>' +
    '<button class="pill ' + (o.cls || '') + '" data-act="' + o.act + '"' + (o.id ? ' data-id="' + o.id + '"' : '') + ' title="' + esc(o.title) + '"' + (o.color ? ' style="--c:' + esc(o.color) + '"' : '') + '>' + o.inner + '</button>' +
    (o.badge ? '<span class="badge">' + (o.badge > 99 ? '99+' : o.badge) + '</span>' : '') + '</div>'
}

function renderRail() {
  let h = pill({ act: 'home', active: S.serverId === '@me', inner: icon('logo', 26), title: 'Direct Messages', badge: incomingCount(), cls: 'home' })
  for (const c of Object.values(S.channels)) {
    if (c.type !== 'dm' || !c.mentions || (S.serverId === '@me' && S.channelId === c.id)) continue
    const u = dmOther(c)
    h += pill({ act: 'dm', id: c.id, inner: avatar(u, 48), title: u.name, badge: c.mentions, cls: 'dm-pill' })
  }
  h += '<div class="rail-sep"></div>'
  for (const s of sortedServers()) {
    const st = serverState(s)
    h += pill({ act: 'server', id: s.id, active: S.serverId === s.id, inner: '<span>' + esc(initials(s.name)) + '</span>', title: s.name, badge: st.mentions, unread: st.unread, color: s.color })
  }
  h += pill({ act: 'create', inner: icon('plus', 22), title: 'Add a Server', cls: 'action' })
  h += pill({ act: 'join', inner: icon('compass', 22), title: 'Join a Server', cls: 'action' })
  $('#rail').innerHTML = h
}

function renderSide() {
  if (S.serverId === '@me') {
    $('#sideTop').innerHTML = '<button class="find-btn" data-act="switcher">Find or start a conversation</button>'
    let h = '<div class="nav-item' + (!S.channelId ? ' active' : '') + '" data-act="friends">' + icon('users', 22) + '<span>Friends</span>' + (incomingCount() ? '<span class="count">' + incomingCount() + '</span>' : '') + '</div>'
    h += '<div class="side-label"><span>Direct Messages</span><button class="mini" data-act="newDm" title="Create DM">' + icon('plus', 16) + '</button></div>'
    const list = dmList()
    if (!list.length) h += '<div class="side-empty">No DMs yet. Head over to Friends or press Ctrl+K to find someone to talk too.</div>'
    for (const c of list) {
      const u = dmOther(c)
      h += '<div class="dm-row' + (c.id === S.channelId ? ' active' : '') + (c.unread ? ' unread' : '') + '" data-act="openDm" data-id="' + c.id + '">' + avatar(u, 32, true) +
        '<div class="dm-text"><div class="dm-name">' + esc(u.name) + '</div>' + (u.customStatus ? '<div class="dm-sub">' + esc(u.customStatus) + '</div>' : '') + '</div>' +
        (c.mentions ? '<span class="count">' + c.mentions + '</span>' : '') +
        '<button class="mini close" data-act="hideDm" data-id="' + c.id + '" title="Close DM">' + icon('x', 14) + '</button></div>'
    }
    $('#sideList').innerHTML = h
    return
  }
  const s = S.servers[S.serverId]
  if (!s) return
  $('#sideTop').innerHTML = '<button class="server-head" data-act="serverMenu"><span>' + esc(s.name) + '</span>' + icon('chevron', 18) + '</button>'
  const owner = isOwner(s.id)
  let h = '<div class="side-label"><span>Text Channels</span>' + (owner ? '<button class="mini" data-act="newChannel" title="Create Channel">' + icon('plus', 16) + '</button>' : '') + '</div>'
  for (const c of serverChannels(s)) {
    h += '<div class="ch-row' + (c.id === S.channelId ? ' active' : '') + (c.unread ? ' unread' : '') + '" data-act="openChannel" data-id="' + c.id + '" title="' + esc(c.topic || '') + '">' + icon('hash', 18) +
      '<span class="ch-name">' + esc(c.name) + '</span>' +
      (c.mentions ? '<span class="count">' + c.mentions + '</span>' : '') +
      (owner ? '<button class="mini gear" data-act="editChannel" data-id="' + c.id + '" title="Edit Channel">' + icon('gear', 14) + '</button>' : '') + '</div>'
  }
  if (owner) h += '<button class="side-invite" data-act="invite">' + icon('invite', 16) + ' Invite people</button>'
  $('#sideList').innerHTML = h
}

function myShownStatus() {
  const st = S.me.setStatus || 'online'
  return st === 'invisible' ? 'offline' : st
}

function renderUserbar() {
  const u = Object.assign({}, S.me, { status: myShownStatus() })
  $('#userbar').innerHTML = '<div class="me-box" data-act="statusMenu" title="Set status">' + avatar(u, 32, true) +
    '<div class="me-text"><div class="me-name">' + esc(u.name) + '</div><div class="me-sub">' + esc(u.customStatus || STATUS_LABEL[S.me.setStatus || 'online']) + '</div></div></div>' +
    '<button class="icon-btn" data-act="settings" title="User Settings">' + icon('gear', 18) + '</button>'
}

function renderHead() {
  const ch = chan()
  const focused = document.activeElement && document.activeElement.id === 'searchBox'
  let left = '<button class="icon-btn menu-btn" data-act="drawer" title="Menu">' + icon('menu') + '</button>'
  let right = ''
  if (!ch) {
    left += '<span class="head-icon">' + icon('users', 22) + '</span><span class="head-title">Friends</span><span class="head-sep"></span>'
    const tabs = [['online', 'Online'], ['all', 'All'], ['pending', 'Pending'], ['add', 'Add Friend']]
    for (const [k, label] of tabs) {
      left += '<button class="tab' + (S.friendsTab === k ? ' active' : '') + (k === 'add' ? ' add' : '') + '" data-act="tab" data-tab="' + k + '">' + label +
        (k === 'pending' && incomingCount() ? ' <span class="count">' + incomingCount() + '</span>' : '') + '</button>'
    }
  } else {
    if (ch.type === 'dm') {
      const u = dmOther(ch)
      left += avatar(u, 26, true) + '<span class="head-title clicky" data-user="' + u.id + '">' + esc(u.name) + '</span>' + (u.customStatus ? '<span class="head-sep"></span><span class="head-topic">' + esc(u.customStatus) + '</span>' : '')
    } else {
      left += '<span class="head-icon">' + icon('hash', 22) + '</span><span class="head-title">' + esc(ch.name) + '</span>' +
        (ch.topic ? '<span class="head-sep"></span><span class="head-topic" title="' + esc(ch.topic) + '">' + esc(ch.topic) + '</span>' : '')
    }
    right += '<button class="icon-btn' + (S.right === 'pins' ? ' on' : '') + '" data-act="pins" title="Pinned Messages">' + icon('pin') + '</button>'
    right += '<button class="icon-btn' + (S.right === 'people' ? ' on' : '') + '" data-act="people" title="' + (ch.type === 'dm' ? 'Show User Profile' : 'Show Member List') + '">' + icon(ch.type === 'dm' ? 'user' : 'users') + '</button>'
    right += '<div class="search"><input id="searchBox" placeholder="Search" autocomplete="off" value="' + esc(S.searchQ) + '">' + icon('search', 16) + '</div>'
  }
  let sel = null
  if (focused) sel = [$('#searchBox').selectionStart, $('#searchBox').selectionEnd]
  $('#head').innerHTML = '<div class="head-left">' + left + '</div><div class="head-right">' + right + '</div>'
  if (focused && $('#searchBox')) {
    $('#searchBox').focus()
    $('#searchBox').setSelectionRange(sel[0], sel[1])
  }
}

function renderCenter() {
  const ch = chan()
  $('#friendsView').classList.toggle('hidden', !!ch)
  $('#chatView').classList.toggle('hidden', !ch)
  if (!ch) return renderFriends()
  $('#input').placeholder = 'Message ' + chName(ch)
  renderReplyBar()
  renderUploads()
}

function friendRow(u, state) {
  let sub = STATUS_LABEL[u.status] || 'Offline'
  if (u.customStatus && state === 'friends') sub = u.customStatus
  if (state === 'incoming') sub = 'Incoming Friend Request'
  if (state === 'outgoing') sub = 'Outgoing Friend Request'
  let actions = ''
  if (state === 'friends') {
    actions = '<button class="round-btn" data-act="msg" data-id="' + u.id + '" title="Message">' + icon('message', 18) + '</button>' +
      '<button class="round-btn danger" data-act="unfriend" data-id="' + u.id + '" title="Remove Friend">' + icon('x', 18) + '</button>'
  } else if (state === 'incoming') {
    actions = '<button class="round-btn good" data-act="accept" data-id="' + u.id + '" title="Accept">' + icon('check', 18) + '</button>' +
      '<button class="round-btn danger" data-act="decline" data-id="' + u.id + '" title="Ignore">' + icon('x', 18) + '</button>'
  } else if (state === 'outgoing') {
    actions = '<button class="round-btn danger" data-act="decline" data-id="' + u.id + '" title="Cancel">' + icon('x', 18) + '</button>'
  } else {
    actions = '<button class="btn small primary" data-act="addFriend" data-id="' + u.id + '">Add Friend</button>'
  }
  return '<div class="friend-row" data-act="' + (state === 'friends' ? 'msg' : 'profile') + '" data-id="' + u.id + '">' + avatar(u, 36, true) +
    '<div class="friend-text"><div class="friend-name">' + esc(u.name) + ' <span class="friend-user">' + esc(u.username) + '</span></div><div class="friend-sub">' + esc(sub) + '</div></div>' +
    '<div class="friend-actions">' + actions + '</div></div>'
}

function renderFriends() {
  const el = $('#friendsView')
  const tab = S.friendsTab
  if (tab === 'add') {
    if (!$('#addFriendForm', el)) {
      el.innerHTML = '<div class="add-friend"><h2>Add Friend</h2><p class="muted">You can add friends with there Wicky username.</p>' +
        '<form id="addFriendForm" class="add-row"><input name="username" placeholder="Type a username" autocomplete="off" spellcheck="false"><button class="btn primary">Send Friend Request</button></form>' +
        '<div id="addFriendMsg" class="add-msg"></div></div><div class="list-label">People you might know</div><div id="suggest"></div>'
      setTimeout(() => { const i = $('#addFriendForm input'); if (i) i.focus() }, 0)
    }
    const shared = new Set()
    for (const s of Object.values(S.servers)) for (const id of s.members) shared.add(id)
    const people = [...shared].filter(id => id !== S.me.id && !S.friends[id] && S.users[id]).map(user).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30)
    $('#suggest').innerHTML = people.length ? people.map(u => friendRow(u, null)).join('') : '<div class="empty small">Nobody new to add right now. Invite people to your servers first!</div>'
    return
  }
  const ids = Object.keys(S.friends).filter(id => S.users[id])
  let rows
  let label
  if (tab === 'online') {
    rows = ids.filter(id => S.friends[id] === 'friends' && user(id).status !== 'offline')
    label = 'Online'
  } else if (tab === 'all') {
    rows = ids.filter(id => S.friends[id] === 'friends')
    label = 'All Friends'
  } else {
    rows = ids.filter(id => S.friends[id] !== 'friends')
    label = 'Pending'
  }
  rows = rows.map(user).sort((a, b) => {
    if (tab === 'pending' && S.friends[a.id] !== S.friends[b.id]) return S.friends[a.id] === 'incoming' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  let h = '<div class="friends-search"><input id="friendFilter" placeholder="Search" autocomplete="off"></div><div class="list-label">' + label + ' · ' + rows.length + '</div>'
  if (!rows.length) {
    const empty = {
      online: 'No one is online right now. Maybe their all doing homework.',
      all: 'You dont have any friends yet. Add some from the Add Friend tab!',
      pending: 'There are no pending friend requests. Here\'s a turtle for now 🐢'
    }
    h += '<div class="empty">' + empty[tab] + '</div>'
  }
  h += '<div id="friendList">' + rows.map(u => friendRow(u, S.friends[u.id])).join('') + '</div>'
  el.innerHTML = h
}

function welcomeHtml(ch) {
  if (ch.type === 'dm') {
    const u = dmOther(ch)
    const state = S.friends[u.id]
    let btn = ''
    if (!state) btn = '<button class="btn small primary" data-act="addFriend" data-id="' + u.id + '">Add Friend</button>'
    else if (state === 'incoming') btn = '<button class="btn small primary" data-act="accept" data-id="' + u.id + '">Accept Friend Request</button>'
    else if (state === 'outgoing') btn = '<button class="btn small" disabled>Friend Request Sent</button>'
    else btn = '<button class="btn small" data-act="unfriend" data-id="' + u.id + '">Remove Friend</button>'
    const mutual = mutualServers(u.id).length
    return '<div class="welcome">' + avatar(u, 80) + '<h1>' + esc(u.name) + '</h1><div class="welcome-user">' + esc(u.username) + '</div>' +
      '<p>This is the beginning of your direct message history with <b>' + esc(u.name) + '</b>.</p>' +
      '<div class="welcome-row">' + (mutual ? '<span class="muted">' + mutual + ' Mutual Server' + (mutual > 1 ? 's' : '') + '</span>' : '<span class="muted">No servers in common</span>') + btn + '</div></div>'
  }
  return '<div class="welcome"><div class="welcome-hash">' + icon('hash', 44) + '</div><h1>Welcome to #' + esc(ch.name) + '!</h1>' +
    '<p>This is the start of the #' + esc(ch.name) + ' channel.' + (ch.topic ? ' ' + esc(ch.topic) : '') + '</p>' +
    (isOwner(ch.serverId) ? '<button class="btn small" data-act="editChannel" data-id="' + ch.id + '">' + icon('edit', 14) + ' Edit Channel</button>' : '') + '</div>'
}

function replyPreview(m) {
  const r = m.reply
  if (!r || r.missing) return '<div class="reply-preview missing"><span class="reply-line"></span><span class="muted">Original message was deleted</span></div>'
  const u = user(r.author)
  const text = r.text ? esc(r.text.replace(/\s+/g, ' ')) : '<i>Click to see attachment</i>'
  return '<div class="reply-preview" data-act="jumpReply" data-id="' + r.id + '"><span class="reply-line"></span>' + avatar(u, 16) + '<span class="name" style="color:' + esc(u.color) + '">' + esc(u.name) + '</span><span class="reply-text">' + text + '</span></div>'
}

function attachmentsHtml(list) {
  if (!list || !list.length) return ''
  return '<div class="atts">' + list.map(a => {
    const url = esc(a.url)
    if (/^image\//.test(a.type)) return '<img class="att-img" src="' + url + '" alt="' + esc(a.name) + '" loading="lazy" data-act="viewImage">'
    if (/^video\//.test(a.type)) return '<video class="att-video" src="' + url + '" controls preload="metadata"></video>'
    if (/^audio\//.test(a.type)) return '<div class="att-file"><div class="att-name">' + esc(a.name) + '</div><audio src="' + url + '" controls preload="none"></audio></div>'
    return '<div class="att-file">' + icon('file', 30) + '<div><a class="att-name" href="' + url + '" download="' + esc(a.name) + '">' + esc(a.name) + '</a><div class="muted small">' + fileSize(a.size) + '</div></div>' +
      '<a class="icon-btn" href="' + url + '" download="' + esc(a.name) + '" title="Download">' + icon('download', 18) + '</a></div>'
  }).join('') + '</div>'
}

function reactionsHtml(m) {
  const keys = Object.keys(m.reactions || {})
  if (!keys.length) return ''
  return '<div class="reactions">' + keys.map(e => {
    const ids = m.reactions[e]
    const names = ids.map(id => user(id).name)
    const title = names.slice(0, 5).join(', ') + (names.length > 5 ? ' and ' + (names.length - 5) + ' more' : '') + ' reacted with ' + e
    return '<button class="react' + (ids.includes(S.me.id) ? ' me' : '') + '" data-act="toggleReact" data-emoji="' + esc(e) + '" title="' + esc(title) + '">' + esc(e) + '<span>' + ids.length + '</span></button>'
  }).join('') + '<button class="react add" data-act="react" title="Add Reaction">' + icon('smile', 16) + '</button></div>'
}

function canDelete(m) {
  const ch = S.channels[m.channelId]
  return m.author === S.me.id || (ch && ch.type !== 'dm' && isOwner(ch.serverId))
}

function canPin(m) {
  const ch = S.channels[m.channelId]
  return !m.system && ch && (canModerate(ch) || m.author === S.me.id)
}

function toolsHtml(m) {
  const mine = m.author === S.me.id
  let h = '<div class="tools">'
  for (const e of QUICK.slice(0, 3)) h += '<button data-act="quickReact" data-emoji="' + e + '" title="React with ' + e + '">' + e + '</button>'
  h += '<button data-act="react" title="Add Reaction">' + icon('smile', 18) + '</button>'
  h += '<button data-act="reply" title="Reply">' + icon('reply', 18) + '</button>'
  if (mine) h += '<button data-act="edit" title="Edit">' + icon('edit', 18) + '</button>'
  if (canPin(m)) h += '<button data-act="pin" title="' + (m.pinned ? 'Unpin' : 'Pin') + '">' + icon('pin', 18) + '</button>'
  if (canDelete(m)) h += '<button class="danger" data-act="delete" title="Delete (hold shift to skip confirm)">' + icon('trash', 18) + '</button>'
  return h + '</div>'
}

function messageHtml(m, prev) {
  const u = user(m.author)
  if (m.system === 'join') {
    const lines = ['just joined the server.', 'hopped into the server.', 'just showed up!', 'is here, everyone say hi.', 'joined the party.']
    const line = lines[parseInt(m.id.slice(-2), 16) % lines.length]
    return '<div class="msg system" data-id="' + m.id + '"><span class="sys-icon">' + icon('join', 16) + '</span><span><b class="name clicky" data-user="' + u.id + '">' + esc(u.name) + '</b> ' + line + '</span><span class="time">' + stamp(m.time) + '</span></div>'
  }
  const grouped = prev && !prev.system && prev.author === m.author && !m.replyTo && m.time - prev.time < 7 * 60000 && sameDay(prev.time, m.time)
  const ch = S.channels[m.channelId]
  let cls = 'msg' + (grouped ? ' grouped' : ' first') + (isMentioned(m) ? ' mentioned' : '') + (S.reply && S.reply.id === m.id ? ' replying' : '') + (m.replyTo ? ' has-reply' : '')
  let h = '<div class="' + cls + '" data-id="' + m.id + '">'
  if (m.replyTo) h += replyPreview(m)
  if (grouped) h += '<span class="side-time" title="' + esc(stamp(m.time)) + '">' + clock(m.time) + '</span>'
  else h += avatar(u, 40)
  h += '<div class="body">'
  if (!grouped) {
    h += '<div class="meta"><span class="name clicky" data-user="' + u.id + '" style="color:' + esc(u.color) + '">' + esc(u.name) + '</span>' +
      (ch && ch.type !== 'dm' && isOwner(ch.serverId, u.id) ? '<span class="crown" title="Server Owner">' + icon('crown', 14) + '</span>' : '') +
      '<span class="time" title="' + esc(new Date(m.time).toLocaleString()) + '">' + stamp(m.time) + '</span>' +
      (m.pinned ? '<span class="pinned-tag" title="Pinned">' + icon('pin', 12) + '</span>' : '') + '</div>'
  }
  if (S.editing && S.editing.id === m.id) {
    h += '<div class="edit-wrap"><textarea class="edit-box" rows="1">' + esc(S.editing.text) + '</textarea><div class="edit-hint">escape to <a href="#" data-act="cancelEdit">cancel</a> · enter to <a href="#" data-act="saveEdit">save</a></div></div>'
  } else if (m.text) {
    h += '<div class="text' + (onlyEmoji(m.text) ? ' jumbo' : '') + '">' + markdown(m.text) + (m.edited ? ' <span class="edited" title="' + esc(stamp(m.edited)) + '">(edited)</span>' : '') + '</div>'
  }
  h += attachmentsHtml(m.attachments)
  h += reactionsHtml(m)
  h += '</div>'
  if (!(S.editing && S.editing.id === m.id)) h += toolsHtml(m)
  return h + '</div>'
}

function renderMessages() {
  const box = $('#msgs')
  const id = S.channelId
  if (!id) {
    box.innerHTML = ''
    return
  }
  const ch = S.channels[id]
  const list = S.msgs[id]
  if (!list) {
    box.innerHTML = '<div class="msgs-loading">' + '<div class="ghost"></div>'.repeat(6) + '</div>'
    return
  }
  const keepBottom = S.stick || S.atBottom
  const prevH = box.scrollHeight
  const prevTop = box.scrollTop
  const editFocused = document.activeElement && document.activeElement.classList.contains('edit-box')
  let h = S.more[id] ? '<div class="history-loader"><div class="spinner small"></div></div>' : welcomeHtml(ch)
  let prev = null
  for (const m of list) {
    if (!prev || !sameDay(prev.time, m.time)) h += '<div class="divider"><span>' + dayLabel(m.time) + '</span></div>'
    h += messageHtml(m, prev)
    prev = m
  }
  box.innerHTML = h
  if (S.jumpTarget) {
    const el = box.querySelector('.msg[data-id="' + S.jumpTarget + '"]')
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.classList.add('flash')
      setTimeout(() => el.classList.remove('flash'), 2000)
    }
    S.jumpTarget = null
  } else if (S.prepending) {
    box.scrollTop = box.scrollHeight - prevH + prevTop
  } else if (keepBottom) {
    box.scrollTop = box.scrollHeight
  } else {
    box.scrollTop = prevTop
  }
  S.stick = false
  S.prepending = false
  S.atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
  if (S.editing) {
    const ta = box.querySelector('.edit-box')
    if (ta) {
      autosize(ta)
      if (!S.editing.focused || editFocused) {
        ta.focus()
        if (!S.editing.focused) ta.setSelectionRange(ta.value.length, ta.value.length)
        S.editing.focused = true
      }
    }
  }
}

function renderTyping() {
  const el = $('#typing')
  const map = S.typing[S.channelId] || {}
  const now = Date.now()
  const names = Object.keys(map).filter(id => map[id] > now && id !== S.me.id).map(id => '<b>' + esc(user(id).name) + '</b>')
  let text = ''
  if (names.length === 1) text = names[0] + ' is typing...'
  else if (names.length === 2) text = names[0] + ' and ' + names[1] + ' are typing...'
  else if (names.length === 3) text = names[0] + ', ' + names[1] + ' and ' + names[2] + ' are typing...'
  else if (names.length > 3) text = 'Several people are typing...'
  el.innerHTML = text ? '<span class="dots"><i></i><i></i><i></i></span>' + text : ''
}

function profileCard(u, opts = {}) {
  const st = S.me && u.id === S.me.id ? myShownStatus() : u.status
  const shown = Object.assign({}, u, { status: st })
  const mutual = mutualServers(u.id)
  let h = '<div class="pcard"><div class="pbanner" style="background:' + esc(u.color) + '"></div><div class="pav">' + avatar(shown, 80, true) + '</div>' +
    '<div class="pbody"><div class="pname">' + esc(u.name) + '</div><div class="puser">' + esc(u.username) + '</div>' +
    (u.customStatus ? '<div class="pstatus">' + esc(u.customStatus) + '</div>' : '') + '<div class="psep"></div>'
  if (u.about) h += '<div class="plabel">About Me</div><div class="pabout">' + markdown(u.about) + '</div>'
  h += '<div class="plabel">Member Since</div><div class="ptext">' + (u.created ? longDate(u.created) : 'Unknown') + '</div>'
  if (opts.serverId && S.servers[opts.serverId]) {
    const s = S.servers[opts.serverId]
    if (s.owner === u.id) h += '<div class="plabel">Role</div><div class="ptext"><span class="role">' + icon('crown', 12) + ' Server Owner</span></div>'
  }
  if (u.id !== S.me.id && mutual.length) h += '<div class="plabel">Mutual Servers · ' + mutual.length + '</div><div class="ptext">' + mutual.slice(0, 6).map(s => esc(s.name)).join(', ') + '</div>'
  if (opts.actions) {
    h += '<div class="pactions">'
    if (u.id === S.me.id) h += '<button class="btn small" data-act="settings">' + icon('edit', 14) + ' Edit Profile</button>'
    else {
      h += '<button class="btn small primary" data-act="msg" data-id="' + u.id + '">' + icon('message', 14) + ' Message</button>'
      const state = S.friends[u.id]
      if (!state) h += '<button class="btn small" data-act="addFriend" data-id="' + u.id + '">Add Friend</button>'
      else if (state === 'incoming') h += '<button class="btn small good" data-act="accept" data-id="' + u.id + '">Accept Request</button>'
      else if (state === 'outgoing') h += '<button class="btn small" disabled>Request Sent</button>'
    }
    h += '</div>'
  }
  return h + '</div></div>'
}

function memberRow(u, s) {
  return '<div class="member' + (u.status === 'offline' ? ' off' : '') + '" data-user="' + u.id + '">' + avatar(u, 32, true) +
    '<div class="member-text"><div class="member-name" style="color:' + (u.status === 'offline' ? 'inherit' : esc(u.color)) + '">' + esc(u.name) +
    (s && s.owner === u.id ? '<span class="crown" title="Server Owner">' + icon('crown', 13) + '</span>' : '') + '</div>' +
    (u.customStatus ? '<div class="member-sub">' + esc(u.customStatus) + '</div>' : '') + '</div></div>'
}

function cardHtml(m, opts = {}) {
  const u = user(m.author)
  const ch = S.channels[m.channelId]
  return '<div class="card" data-act="jump" data-ch="' + m.channelId + '" data-id="' + m.id + '">' +
    (opts.showChannel && ch && ch.type !== 'dm' ? '<div class="card-ch">#' + esc(ch.name) + '</div>' : '') +
    '<div class="card-msg">' + avatar(u, 32) + '<div class="card-body"><div class="meta"><span class="name" style="color:' + esc(u.color) + '">' + esc(u.name) + '</span><span class="time">' + stamp(m.time) + '</span></div>' +
    (m.text ? '<div class="text">' + markdown(m.text) + '</div>' : '') +
    (m.attachments.length ? '<div class="card-att">' + icon('file', 14) + ' ' + m.attachments.length + ' attachment' + (m.attachments.length > 1 ? 's' : '') + '</div>' : '') + '</div></div>' +
    (opts.unpin ? '<button class="mini close" data-act="unpin" data-ch="' + m.channelId + '" data-id="' + m.id + '" title="Unpin">' + icon('x', 14) + '</button>' : '') + '</div>'
}

function renderRight() {
  const el = $('#right')
  const ch = chan()
  const mode = ch ? S.right : 'active'
  el.classList.toggle('hidden', !mode)
  document.body.classList.toggle('right-open', !!mode && !!ch)
  if (!mode) {
    el.innerHTML = ''
    return
  }
  if (mode === 'active') {
    const on = Object.keys(S.friends).filter(id => S.friends[id] === 'friends' && user(id).status !== 'offline').map(user)
    let h = '<div class="panel-title">Active Now</div>'
    if (!on.length) h += '<div class="empty small">Its quiet for now...<br><br>When a friend comes online they will show up here.</div>'
    else h += on.map(u => '<div class="active-card" data-act="msg" data-id="' + u.id + '">' + avatar(u, 32, true) + '<div><div class="member-name">' + esc(u.name) + '</div><div class="member-sub">' + esc(u.customStatus || STATUS_LABEL[u.status]) + '</div></div></div>').join('')
    el.innerHTML = h
    return
  }
  if (mode === 'people') {
    if (ch.type === 'dm') {
      el.innerHTML = profileCard(dmOther(ch))
      return
    }
    const s = S.servers[ch.serverId]
    const users = s.members.map(user)
    const on = users.filter(u => u.status !== 'offline').sort((a, b) => a.name.localeCompare(b.name))
    const off = users.filter(u => u.status === 'offline').sort((a, b) => a.name.localeCompare(b.name))
    let h = ''
    if (on.length) h += '<div class="panel-label">Online · ' + on.length + '</div>' + on.map(u => memberRow(u, s)).join('')
    if (off.length) h += '<div class="panel-label">Offline · ' + off.length + '</div>' + off.map(u => memberRow(u, s)).join('')
    el.innerHTML = h
    return
  }
  if (mode === 'pins') {
    let h = '<div class="panel-head">' + icon('pin', 18) + '<span>Pinned Messages</span><button class="mini" data-act="closeRight">' + icon('x', 16) + '</button></div>'
    if (!S.pins || S.pins.channelId !== ch.id) h += '<div class="empty small">Loading pins...</div>'
    else if (!S.pins.messages.length) h += '<div class="empty small">This channel doesnt have any pinned messages... yet.</div>'
    else h += S.pins.messages.map(m => cardHtml(m, { unpin: canPin(m) })).join('')
    el.innerHTML = h
    return
  }
  if (mode === 'search') {
    const r = S.search
    let h = '<div class="panel-head">' + icon('search', 18) + '<span>' + (r && !r.loading ? r.total + ' Result' + (r.total === 1 ? '' : 's') : 'Searching...') + '</span><button class="mini" data-act="closeRight">' + icon('x', 16) + '</button></div>'
    if (r && r.error) h += '<div class="empty small">' + esc(r.error) + '</div>'
    else if (r && !r.loading && !r.messages.length) h += '<div class="empty small">We looked everywhere but couldnt find anything for <b>' + esc(r.q) + '</b>.</div>'
    else if (r && r.messages) h += r.messages.map(m => cardHtml(m, { showChannel: true })).join('')
    h += '<div class="muted small search-tip">Tip: use <code class="inline">from:username</code> to only search one person.</div>'
    el.innerHTML = h
  }
}

async function loadPins() {
  const id = S.channelId
  if (!id) return
  try {
    const r = await request('pins', { channelId: id })
    S.pins = { channelId: id, messages: r.messages }
  } catch (e) {
    S.pins = { channelId: id, messages: [] }
    toast(e.message, 'bad')
  }
  queue('right')
}

async function doSearch(q) {
  const ch = chan()
  if (!ch || !q.trim()) return
  S.right = 'search'
  S.search = { q, loading: true, messages: [] }
  queue('right', 'head')
  try {
    const r = await request('search', ch.type === 'dm' ? { channelId: ch.id, q } : { serverId: ch.serverId, q })
    S.search = { q, total: r.total, messages: r.messages }
  } catch (e) {
    S.search = { q, error: e.message, messages: [] }
  }
  queue('right')
}

async function jumpTo(chId, msgId) {
  const ch = S.channels[chId]
  if (!ch) return
  if (S.channelId !== chId) go(ch.type === 'dm' ? '@me' : ch.serverId, chId, true)
  for (let i = 0; i < 40; i++) {
    const list = S.msgs[chId]
    if (list && list.some(m => m.id === msgId)) break
    if (list && !S.more[chId]) return toast('Couldnt find that message, it might be deleted')
    if (!list) await loadChannel(chId)
    else await loadOlder(chId)
  }
  S.jumpTarget = msgId
  queue('msgs')
}

function saveDraft() {
  if (S.channelId) S.drafts[S.channelId] = $('#input').value
}

function restoreDraft() {
  const input = $('#input')
  input.value = (S.channelId && S.drafts[S.channelId]) || ''
  autosize(input)
}

function autosize(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, Math.round(innerHeight * 0.45)) + 'px'
}

function renderReplyBar() {
  const el = $('#replyBar')
  if (!S.reply) {
    el.classList.add('hidden')
    el.innerHTML = ''
    return
  }
  const u = user(S.reply.author)
  el.classList.remove('hidden')
  el.innerHTML = '<span>Replying to <b style="color:' + esc(u.color) + '">' + esc(u.name) + '</b></span><button class="mini" data-act="cancelReply" title="Cancel">' + icon('x', 16) + '</button>'
}

function renderUploads() {
  const el = $('#uploads')
  if (!S.files.length) {
    el.classList.add('hidden')
    el.innerHTML = ''
    return
  }
  el.classList.remove('hidden')
  el.innerHTML = S.files.map((f, i) =>
    '<div class="up' + (f.uploading ? ' busy' : '') + '">' +
    (f.preview ? '<img src="' + f.preview + '" alt="">' : '<div class="up-icon">' + icon('file', 34) + '</div>') +
    '<div class="up-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div><div class="up-size">' + (f.uploading ? 'Uploading...' : fileSize(f.size)) + '</div>' +
    '<button class="mini close" data-i="' + i + '" title="Remove">' + icon('trash', 14) + '</button></div>'
  ).join('')
}

async function addFiles(files) {
  if (!S.channelId) return toast('Open a channel first')
  for (const file of files) {
    if (S.files.length >= 10) {
      toast('You can only add 10 files at once')
      break
    }
    if (file.size > 10 * 1024 * 1024) {
      toast(file.name + ' is to big, 10 MB is the max', 'bad')
      continue
    }
    const item = { name: file.name || 'file', size: file.size, uploading: true, preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : null }
    S.files.push(item)
    renderUploads()
    try {
      item.data = await uploadFile(file, S.token)
      item.uploading = false
    } catch (e) {
      toast(e.message, 'bad')
      S.files = S.files.filter(f => f !== item)
    }
    renderUploads()
  }
}

function startReply(m) {
  S.reply = { id: m.id, author: m.author }
  renderReplyBar()
  queue('msgs')
  $('#input').focus()
}

function cancelReply() {
  S.reply = null
  renderReplyBar()
  queue('msgs')
}

function startEdit(m) {
  S.editing = { id: m.id, channelId: m.channelId, text: m.text, focused: false }
  queue('msgs')
}

function cancelEdit() {
  S.editing = null
  queue('msgs')
  $('#input').focus()
}

async function saveEdit() {
  const e = S.editing
  if (!e) return
  const text = e.text.trim()
  const list = S.msgs[e.channelId] || []
  const m = list.find(x => x.id === e.id)
  if (!text && m && !m.attachments.length) {
    S.editing = null
    queue('msgs')
    return askDelete(m)
  }
  S.editing = null
  queue('msgs')
  $('#input').focus()
  if (m && text === m.text) return
  try {
    await request('edit', { channelId: e.channelId, messageId: e.id, text })
  } catch (err) {
    toast(err.message, 'bad')
  }
}

function askDelete(m, skip) {
  const run = () => request('delete', { channelId: m.channelId, messageId: m.id }).catch(e => toast(e.message, 'bad'))
  if (skip) return run()
  const u = user(m.author)
  modal({
    title: 'Delete Message',
    body: '<p class="confirm-text">Are you sure you want to delete this message?</p><div class="confirm-msg">' + avatar(u, 32) + '<div><div class="meta"><span class="name" style="color:' + esc(u.color) + '">' + esc(u.name) + '</span><span class="time">' + stamp(m.time) + '</span></div><div class="text">' + (m.text ? markdown(m.text) : '<i>attachment</i>') + '</div></div></div><p class="muted small">Protip: hold shift when clicking delete to skip this.</p>',
    ok: 'Delete',
    danger: true,
    onOk: run
  })
}

function togglePin(m) {
  request('pin', { channelId: m.channelId, messageId: m.id })
    .then(r => toast(r.pinned ? 'Message pinned' : 'Message unpinned'))
    .catch(e => toast(e.message, 'bad'))
}

function react(m, emoji) {
  let recent = store.get('recentEmoji', [])
  recent = [emoji].concat(recent.filter(e => e !== emoji)).slice(0, 16)
  store.set('recentEmoji', recent)
  request('react', { channelId: m.channelId, messageId: m.id, emoji }).catch(e => toast(e.message, 'bad'))
}

const SLASH = {
  shrug: t => (t ? t + ' ' : '') + '¯\\_(ツ)_/¯',
  tableflip: t => (t ? t + ' ' : '') + '(╯°□°)╯︵ ┻━┻',
  unflip: t => (t ? t + ' ' : '') + '┬─┬ノ( º _ ºノ)',
  lenny: t => (t ? t + ' ' : '') + '( ͡° ͜ʖ ͡°)',
  spoiler: t => '||' + t + '||',
  me: t => '*' + t + '*'
}

async function sendMessage() {
  const input = $('#input')
  const ch = chan()
  if (!ch) return
  let text = input.value.trim()
  if (S.files.some(f => f.uploading)) return toast('Wait for your files to finish uploading')
  const slash = text.match(/^\/(\w+)\s*([\s\S]*)$/)
  if (slash && SLASH[slash[1]]) text = SLASH[slash[1]](slash[2].trim())
  else if (slash && slash[1] === 'nick') {
    if (!slash[2].trim()) return toast('Usage: /nick new name')
    input.value = ''
    autosize(input)
    return request('updateMe', { name: slash[2].trim() }).then(() => toast('Display name changed')).catch(e => toast(e.message, 'bad'))
  } else if (slash && slash[1] === 'status') {
    input.value = ''
    autosize(input)
    return request('updateMe', { customStatus: slash[2].trim() }).then(() => toast('Status updated')).catch(e => toast(e.message, 'bad'))
  }
  if (!text && !S.files.length) return
  if (text.length > 4000) return toast('Your message is to long, 4000 characters max', 'bad')
  const payload = { channelId: ch.id, text, replyTo: S.reply ? S.reply.id : null, attachments: S.files.map(f => f.data) }
  const oldValue = input.value
  input.value = ''
  autosize(input)
  S.drafts[ch.id] = ''
  S.reply = null
  S.files = []
  renderReplyBar()
  renderUploads()
  hideAc()
  lastTyping = 0
  try {
    await request('send', payload)
  } catch (e) {
    toast(e.message, 'bad')
    if (!input.value) {
      input.value = oldValue
      autosize(input)
    }
  }
}

let lastTyping = 0
function sendTyping() {
  const input = $('#input')
  if (!S.channelId || !input.value.trim() || input.value.startsWith('/')) return
  if (Date.now() - lastTyping < 3000) return
  lastTyping = Date.now()
  fire('typing', { channelId: S.channelId })
}

function checkAutocomplete() {
  const input = $('#input')
  const before = input.value.slice(0, input.selectionStart)
  let m = before.match(/(^|\s)@([a-z0-9_.]{0,20})$/i)
  if (m) {
    const q = m[2].toLowerCase()
    const ch = chan()
    const pool = memberIds(ch).filter(id => id !== S.me.id).map(user)
    const items = pool.filter(u => u.username.startsWith(q) || u.name.toLowerCase().startsWith(q))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8)
      .map(u => ({ insert: '@' + u.username + ' ', html: avatar(u, 24, true) + '<span class="ac-name">' + esc(u.name) + '</span><span class="ac-sub">' + esc(u.username) + '</span>' }))
    if (ch && ch.type !== 'dm') {
      for (const word of ['everyone', 'here']) {
        if (word.startsWith(q)) items.push({ insert: '@' + word + ' ', html: '<span class="ac-at">@</span><span class="ac-name">@' + word + '</span><span class="ac-sub">' + (word === 'everyone' ? 'Notify everyone in the server' : 'Notify everyone online') + '</span>' })
      }
    }
    return showAc(items, before.length - m[2].length - 1, 'Members')
  }
  m = before.match(/(^|\s):([a-z0-9_+-]{2,})$/i)
  if (m) {
    const q = m[2].toLowerCase()
    const items = EMOJI.filter(([, n]) => n.includes(q)).sort((a, b) => (a[1].startsWith(q) ? 0 : 1) - (b[1].startsWith(q) ? 0 : 1)).slice(0, 9)
      .map(([e, n]) => ({ insert: e + ' ', html: '<span class="ac-emoji">' + e + '</span><span class="ac-name">:' + n + ':</span>' }))
    return showAc(items, before.length - m[2].length - 1, 'Emoji matching :' + esc(q))
  }
  hideAc()
}

function showAc(items, start, title) {
  if (!items.length) return hideAc()
  S.ac = { items, start, index: 0 }
  const el = $('#ac')
  el.classList.remove('hidden')
  el.innerHTML = '<div class="ac-title">' + title + '</div>' + items.map((it, i) => '<div class="ac-item' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' + it.html + '</div>').join('')
}

function hideAc() {
  S.ac = null
  const el = $('#ac')
  el.classList.add('hidden')
  el.innerHTML = ''
}

function moveAc(d) {
  const n = S.ac.items.length
  S.ac.index = (S.ac.index + d + n) % n
  $$('#ac .ac-item').forEach((el, i) => el.classList.toggle('on', i === S.ac.index))
}

function applyAc(i) {
  const it = S.ac.items[i]
  const input = $('#input')
  const after = input.value.slice(input.selectionStart)
  const head = input.value.slice(0, S.ac.start) + it.insert
  input.value = head + after
  input.setSelectionRange(head.length, head.length)
  input.focus()
  hideAc()
  autosize(input)
}

function insertAtCaret(text) {
  const input = $('#input')
  const s = input.selectionStart ?? input.value.length
  const e = input.selectionEnd ?? input.value.length
  input.value = input.value.slice(0, s) + text + input.value.slice(e)
  input.setSelectionRange(s + text.length, s + text.length)
  input.focus()
  autosize(input)
}

function closePopups() {
  if (S.popup) {
    S.popup.remove()
    S.popup = null
  }
}

function popupEl(cls) {
  closePopups()
  const el = document.createElement('div')
  el.className = cls
  document.body.appendChild(el)
  S.popup = el
  return el
}

function openMenu(items, x, y) {
  const list = items.filter(Boolean)
  const el = popupEl('menu')
  el.innerHTML = list.map((it, i) => {
    if (it === '-') return '<div class="menu-sep"></div>'
    if (it.row) return '<div class="menu-row">' + it.row.map(e => '<button data-i="' + i + '" data-e="' + e + '">' + e + '</button>').join('') + '</div>'
    return '<button class="menu-item' + (it.danger ? ' danger' : '') + '" data-i="' + i + '"><span>' + (it.html || esc(it.label)) + '</span>' + (it.icon ? icon(it.icon, 16) : '') + '</button>'
  }).join('')
  place(el, x, y)
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-i]')
    if (!b) return
    const it = list[b.dataset.i]
    closePopups()
    if (it.row) it.run(b.dataset.e)
    else it.run()
  })
}

function menuAt(anchor) {
  const r = anchor.getBoundingClientRect()
  return [r.left, r.bottom + 6]
}

function emojiPicker(x, y, onPick) {
  const el = popupEl('picker')
  el.innerHTML = '<input class="picker-search" placeholder="Find the perfect emoji" autocomplete="off"><div class="picker-grid"></div><div class="picker-foot muted small">Hold shift to pick more than one</div>'
  const grid = $('.picker-grid', el)
  const draw = q => {
    q = (q || '').toLowerCase().trim()
    const recent = store.get('recentEmoji', [])
    let h = ''
    if (!q && recent.length) h += '<div class="picker-label">Frequently Used</div>' + recent.map(e => '<button data-e="' + e + '">' + e + '</button>').join('')
    const list = EMOJI.filter(([, n]) => !q || n.includes(q))
    if (!q) h += '<div class="picker-label">People & Stuff</div>'
    h += list.map(([e, n]) => '<button data-e="' + e + '" title=":' + n + ':">' + e + '</button>').join('')
    if (!list.length) h += '<div class="empty small">No emoji found</div>'
    grid.innerHTML = h
  }
  draw('')
  place(el, x, y)
  const search = $('.picker-search', el)
  search.focus()
  search.addEventListener('input', () => draw(search.value))
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = grid.querySelector('[data-e]')
      if (first) first.click()
    }
  })
  grid.addEventListener('click', e => {
    const b = e.target.closest('[data-e]')
    if (!b) return
    onPick(b.dataset.e)
    if (!e.shiftKey) closePopups()
  })
}

function profilePopout(userId, x, y, serverId) {
  const el = popupEl('popout')
  el.innerHTML = profileCard(user(userId), { actions: true, serverId })
  place(el, x, y)
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]')
    if (!b) return
    closePopups()
    handleAction(b.dataset.act, b.dataset.id)
  })
}

function popoutFor(target, userId) {
  const r = target.getBoundingClientRect()
  const ch = chan()
  const serverId = ch && ch.type !== 'dm' ? ch.serverId : null
  let x = r.right + 10
  if (x + 310 > innerWidth) x = r.left - 310
  profilePopout(userId, x, r.top, serverId)
}

function modal(o) {
  closeModal()
  closePopups()
  const wrap = document.createElement('div')
  wrap.className = 'modal-bg'
  wrap.innerHTML = '<form class="modal ' + (o.cls || '') + '" novalidate><div class="modal-head"><h2>' + esc(o.title) + '</h2>' + (o.sub ? '<p class="muted">' + o.sub + '</p>' : '') +
    '<button type="button" class="mini x" data-close title="Close">' + icon('x', 20) + '</button></div>' +
    '<div class="modal-body">' + o.body + '</div><div class="modal-err"></div>' +
    (o.ok === false ? '' : '<div class="modal-foot">' + (o.extra || '') + '<button type="button" class="btn link" data-close>' + (o.cancel || 'Cancel') + '</button><button type="submit" class="btn ' + (o.danger ? 'danger' : 'primary') + '">' + esc(o.ok || 'Save') + '</button></div>') + '</form>'
  $('#layer').appendChild(wrap)
  const form = $('form', wrap)
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) closeModal() })
  $$('[data-close]', wrap).forEach(b => b.addEventListener('click', closeModal))
  form.addEventListener('submit', async e => {
    e.preventDefault()
    if (!o.onOk) return closeModal()
    const btn = $('.modal-foot [type=submit]', form)
    if (btn) btn.disabled = true
    $('.modal-err', form).textContent = ''
    try {
      const keep = await o.onOk(Object.fromEntries(new FormData(form)), form)
      if (keep !== true) closeModal()
    } catch (err) {
      $('.modal-err', form).textContent = err.message
    }
    if (btn) btn.disabled = false
  })
  if (o.onMount) o.onMount(form)
  const first = $('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([readonly]), textarea', form)
  if (first && o.focus !== false) setTimeout(() => { first.focus(); if (first.select && o.select) first.select() }, 30)
  return form
}

function closeModal() {
  $('#layer').innerHTML = ''
}

function modalOpen() {
  return !!$('#layer').firstChild
}

function swatches(name, current) {
  const list = COLORS.includes(current) ? COLORS : COLORS.concat(current || [])
  return '<div class="swatches">' + list.map(c => '<label class="swatch" style="background:' + c + '"><input type="radio" name="' + name + '" value="' + c + '"' + (c === current ? ' checked' : '') + '><span>' + icon('check', 16) + '</span></label>').join('') +
    '<label class="swatch custom" title="Custom color"><input type="color" data-for="' + name + '" value="' + esc(current || '#5865f2') + '">+</label></div>'
}

function wireSwatches(form, name, onChange) {
  const picker = $('input[type=color][data-for="' + name + '"]', form)
  if (picker) {
    picker.addEventListener('input', () => {
      let radio = $('input[name="' + name + '"][value="' + picker.value + '"]', form)
      if (!radio) {
        const label = document.createElement('label')
        label.className = 'swatch'
        label.style.background = picker.value
        label.innerHTML = '<input type="radio" name="' + name + '" value="' + picker.value + '"><span>' + icon('check', 16) + '</span>'
        picker.parentNode.before(label)
        radio = $('input', label)
      }
      radio.checked = true
      if (onChange) onChange(picker.value)
    })
  }
  $$('input[name="' + name + '"]', form).forEach(r => r.addEventListener('change', () => onChange && onChange(r.value)))
  form.addEventListener('change', e => {
    if (e.target.name === name && onChange) onChange(e.target.value)
  })
}

function createServerModal() {
  modal({
    title: 'Create Your Server',
    sub: 'Your server is where you and your friends hang out. Make yours and start talking.',
    body: '<label>Server Name<input name="name" maxlength="40" value="' + esc(S.me.name + "'s server") + '"></label>' +
      '<p class="muted small">By creating a server you agree to be nice to people. Thats the only rule.</p>' +
      '<div class="modal-alt">Have an invite already? <a href="#" data-alt>Join a Server</a></div>',
    ok: 'Create',
    select: true,
    onMount(form) {
      $('[data-alt]', form).addEventListener('click', e => {
        e.preventDefault()
        joinServerModal()
      })
    },
    async onOk(d) {
      const r = await request('createServer', { name: d.name })
      go(r.serverId)
      toast('Server created! Invite your friends with the invite code.')
    }
  })
}

function joinServerModal(code) {
  modal({
    title: 'Join a Server',
    sub: 'Enter an invite below to join an existing server.',
    body: '<label>Invite Link or Code<input name="invite" value="' + esc(code || '') + '" placeholder="lounge" autocomplete="off" spellcheck="false"></label>' +
      '<p class="muted small">Invites look like <code class="inline">x7h2ka</code> or <code class="inline">' + esc(location.origin) + '/#/invite/x7h2ka</code></p>' +
      '<div class="modal-alt">Dont have an invite? Try the code <a href="#" data-lounge>lounge</a> to join the Wicky Lounge.</div>',
    ok: 'Join Server',
    onMount(form) {
      $('[data-lounge]', form).addEventListener('click', e => {
        e.preventDefault()
        $('[name=invite]', form).value = 'lounge'
      })
    },
    async onOk(d) {
      if (!d.invite.trim()) throw new Error('Please enter an invite')
      const r = await request('joinServer', { invite: d.invite.trim() })
      go(r.serverId)
    }
  })
}

function inviteModal(serverId) {
  const s = S.servers[serverId]
  if (!s) return
  const link = location.origin + '/#/invite/' + s.invite
  modal({
    title: 'Invite friends to ' + s.name,
    body: '<label>Send a server invite link to a friend<div class="copy-row"><input readonly value="' + esc(link) + '"><button type="button" class="btn primary" data-copy="' + esc(link) + '">Copy</button></div></label>' +
      '<label>Or just the code<div class="copy-row"><input readonly value="' + esc(s.invite) + '"><button type="button" class="btn" data-copy="' + esc(s.invite) + '">Copy</button></div></label>' +
      (s.owner === S.me.id ? '<p class="muted small">Want a new code? You can reset it in Server Settings.</p>' : ''),
    ok: false,
    focus: false,
    onMount(form) {
      $$('[data-copy]', form).forEach(b => b.addEventListener('click', () => {
        copyText(b.dataset.copy)
        b.textContent = 'Copied'
        b.classList.add('good')
      }))
    }
  })
}

function serverSettingsModal(serverId) {
  const s = S.servers[serverId]
  if (!s) return
  const members = s.members.map(user).sort((a, b) => a.name.localeCompare(b.name))
  modal({
    title: 'Server Settings',
    cls: 'wide',
    body: '<div class="settings-cols"><div>' +
      '<div class="server-preview"><div class="pill big" id="srvPreview" style="background:' + esc(s.color) + '">' + esc(initials(s.name)) + '</div></div>' +
      '<label>Server Name<input name="name" maxlength="40" value="' + esc(s.name) + '"></label>' +
      '<div class="field-label">Server Color</div>' + swatches('color', s.color) +
      '<div class="field-label">Invite Code</div><div class="copy-row"><input readonly id="srvInvite" value="' + esc(s.invite) + '"><button type="button" class="btn" data-act="copyInvite">Copy</button><button type="button" class="btn" data-act="resetInvite">Reset</button></div>' +
      '</div><div>' +
      '<div class="field-label">Members · ' + members.length + '</div><div class="member-list">' +
      members.map(u => '<div class="member-line">' + avatar(u, 28, true) + '<span>' + esc(u.name) + ' <span class="muted small">' + esc(u.username) + '</span></span>' +
        (u.id === s.owner ? '<span class="role">' + icon('crown', 12) + ' Owner</span>' : '<button type="button" class="btn small danger-outline" data-kick="' + u.id + '">Kick</button>') + '</div>').join('') +
      '</div><div class="danger-zone"><div class="field-label">Danger Zone</div><button type="button" class="btn danger" data-act="deleteServer">Delete Server</button></div>' +
      '</div></div>',
    ok: 'Save Changes',
    onMount(form) {
      wireSwatches(form, 'color', c => { $('#srvPreview').style.background = c })
      $('[name=name]', form).addEventListener('input', e => { $('#srvPreview').textContent = initials(e.target.value || '?') })
      $('[data-act=copyInvite]', form).addEventListener('click', () => copyText($('#srvInvite').value))
      $('[data-act=resetInvite]', form).addEventListener('click', async () => {
        try {
          const r = await request('updateServer', { serverId, newInvite: true })
          $('#srvInvite').value = r.invite
          toast('Invite code reset, the old one wont work anymore')
        } catch (e) { toast(e.message, 'bad') }
      })
      $$('[data-kick]', form).forEach(b => b.addEventListener('click', async () => {
        const u = user(b.dataset.kick)
        try {
          await request('kick', { serverId, userId: u.id })
          b.closest('.member-line').remove()
          toast(u.name + ' was kicked')
        } catch (e) { toast(e.message, 'bad') }
      }))
      $('[data-act=deleteServer]', form).addEventListener('click', () => {
        modal({
          title: "Delete '" + s.name + "'",
          body: '<p class="confirm-text">Are you sure you want to delete <b>' + esc(s.name) + '</b>? This cant be undone, all the channels and messages will be gone forever.</p><label>Type the server name to confirm<input name="confirm" autocomplete="off"></label>',
          ok: 'Delete Server',
          danger: true,
          async onOk(d) {
            if (d.confirm.trim() !== s.name) throw new Error('You didnt type the server name correctly')
            await request('deleteServer', { serverId })
          }
        })
      })
    },
    async onOk(d) {
      await request('updateServer', { serverId, name: d.name, color: d.color })
      toast('Saved!')
    }
  })
}

function createChannelModal(serverId) {
  modal({
    title: 'Create Channel',
    sub: 'in ' + esc(S.servers[serverId].name),
    body: '<label>Channel Name<div class="input-icon">' + icon('hash', 18) + '<input name="name" maxlength="30" placeholder="new-channel" autocomplete="off"></div></label>' +
      '<label>Topic <span class="muted small">(optional)</span><input name="topic" maxlength="200" placeholder="What is this channel about?"></label>',
    ok: 'Create Channel',
    onMount(form) {
      const input = $('[name=name]', form)
      input.addEventListener('input', () => {
        const pos = input.selectionStart
        input.value = input.value.toLowerCase().replace(/\s/g, '-')
        input.setSelectionRange(pos, pos)
      })
    },
    async onOk(d) {
      const r = await request('createChannel', { serverId, name: d.name, topic: d.topic })
      go(serverId, r.channelId)
    }
  })
}

function channelSettingsModal(channelId) {
  const ch = S.channels[channelId]
  if (!ch) return
  const s = S.servers[ch.serverId]
  const i = s.channels.indexOf(ch.id)
  modal({
    title: 'Edit #' + ch.name,
    body: '<label>Channel Name<div class="input-icon">' + icon('hash', 18) + '<input name="name" maxlength="30" value="' + esc(ch.name) + '"></div></label>' +
      '<label>Channel Topic<textarea name="topic" maxlength="200" rows="3" placeholder="Let everyone know how to use this channel!">' + esc(ch.topic || '') + '</textarea></label>' +
      '<div class="field-label">Position</div><div class="btn-row"><button type="button" class="btn small" data-move="-1"' + (i <= 0 ? ' disabled' : '') + '>' + icon('arrowUp', 14) + ' Move Up</button><button type="button" class="btn small" data-move="1"' + (i >= s.channels.length - 1 ? ' disabled' : '') + '>' + icon('arrowDown', 14) + ' Move Down</button></div>',
    extra: '<button type="button" class="btn danger left" data-act="deleteChannel">Delete Channel</button>',
    ok: 'Save Changes',
    onMount(form) {
      $$('[data-move]', form).forEach(b => b.addEventListener('click', async () => {
        try {
          await request('moveChannel', { channelId, dir: Number(b.dataset.move) })
          channelSettingsModal(channelId)
        } catch (e) { toast(e.message, 'bad') }
      }))
      $('[data-act=deleteChannel]', form).addEventListener('click', () => {
        modal({
          title: 'Delete Channel',
          body: '<p class="confirm-text">Are you sure you want to delete <b>#' + esc(ch.name) + '</b>? This cant be undone.</p>',
          ok: 'Delete Channel',
          danger: true,
          onOk: () => request('deleteChannel', { channelId })
        })
      })
    },
    async onOk(d) {
      await request('updateChannel', { channelId, name: d.name, topic: d.topic })
      toast('Channel saved')
    }
  })
}

function customStatusModal() {
  modal({
    title: 'Set a custom status',
    body: '<label>Whats cookin\', ' + esc(S.me.name) + '?<input name="status" maxlength="60" value="' + esc(S.me.customStatus || '') + '" placeholder="Studying for the bio test 📚"></label>',
    extra: S.me.customStatus ? '<button type="button" class="btn link left" data-act="clearStatus">Clear Status</button>' : '',
    select: true,
    onMount(form) {
      const c = $('[data-act=clearStatus]', form)
      if (c) c.addEventListener('click', () => { request('updateMe', { customStatus: '' }).catch(e => toast(e.message, 'bad')); closeModal() })
    },
    onOk: d => request('updateMe', { customStatus: d.status })
  })
}

function settingsModal() {
  const u = S.me
  modal({
    title: 'User Settings',
    cls: 'wide',
    body: '<div class="settings-cols"><div>' +
      '<div class="field-label">Preview</div><div id="setPreview">' + profileCard(u) + '</div>' +
      '</div><div>' +
      '<label>Display Name<input name="name" maxlength="32" value="' + esc(u.name) + '"></label>' +
      '<div class="field-label">Username</div><div class="readonly-line">' + esc(u.username) + ' <span class="muted small">(cant be changed)</span></div>' +
      '<div class="field-label">Profile Color</div>' + swatches('color', u.color) +
      '<label>About Me<textarea name="about" maxlength="190" rows="3" placeholder="Tell people a bit about yourself">' + esc(u.about || '') + '</textarea></label>' +
      '<label>Custom Status<input name="customStatus" maxlength="60" value="' + esc(u.customStatus || '') + '"></label>' +
      '<div class="field-label">App Settings</div>' +
      '<label class="toggle"><input type="checkbox" name="sounds"' + (prefs.sounds ? ' checked' : '') + '><span></span>Play a sound for mentions and DMs</label>' +
      '<label class="toggle"><input type="checkbox" name="desktop"' + (prefs.desktop ? ' checked' : '') + '><span></span>Desktop notifications</label>' +
      '<label class="toggle"><input type="checkbox" name="compact"' + (prefs.compact ? ' checked' : '') + '><span></span>Compact message layout</label>' +
      '<label class="toggle"><input type="checkbox" name="enterSends"' + (prefs.enterSends ? ' checked' : '') + '><span></span>Enter sends the message (shift+enter for new line)</label>' +
      '<details class="pw"><summary>Change Password</summary><label>Current Password<input type="password" name="oldPw" autocomplete="current-password"></label><label>New Password<input type="password" name="newPw" autocomplete="new-password"></label></details>' +
      '</div></div>',
    extra: '<button type="button" class="btn danger-outline left" data-act="logout">' + icon('logout', 14) + ' Log Out</button>',
    ok: 'Save Changes',
    focus: false,
    onMount(form) {
      const preview = () => {
        const d = Object.fromEntries(new FormData(form))
        $('#setPreview').innerHTML = profileCard(Object.assign({}, u, { name: d.name || u.name, color: d.color || u.color, about: d.about, customStatus: d.customStatus }))
      }
      wireSwatches(form, 'color', preview)
      form.addEventListener('input', preview)
      $('[data-act=logout]', form).addEventListener('click', logout)
    },
    async onOk(d) {
      await request('updateMe', { name: d.name, color: d.color, about: d.about, customStatus: d.customStatus })
      if (d.oldPw || d.newPw) {
        await request('changePassword', { old: d.oldPw, next: d.newPw })
        toast('Password changed')
      }
      prefs.sounds = !!d.sounds
      prefs.compact = !!d.compact
      prefs.enterSends = !!d.enterSends
      const wantDesktop = !!d.desktop
      if (wantDesktop && !prefs.desktop && 'Notification' in window) {
        const p = await Notification.requestPermission()
        if (p !== 'granted') toast('Your browser blocked notifications', 'bad')
      }
      prefs.desktop = wantDesktop
      store.set('prefs', prefs)
      document.body.classList.toggle('compact', prefs.compact)
      queue('msgs')
      toast('Settings saved')
    }
  })
}

function imageViewer(src, name) {
  modal({
    title: name || 'Image',
    cls: 'viewer',
    body: '<img src="' + esc(src) + '" alt=""><a class="muted small" href="' + esc(src) + '" target="_blank" rel="noopener">Open original</a>',
    ok: false,
    focus: false
  })
}

function switcher(mode) {
  modal({
    title: mode === 'dm' ? 'Select a person' : 'Where would you like to go?',
    cls: 'switcher',
    body: '<input class="sw-input" placeholder="' + (mode === 'dm' ? 'Type the name or username of a person' : 'Search for servers, channels or people') + '" autocomplete="off" spellcheck="false"><div class="sw-list"></div><div class="muted small sw-tip">Tip: press Ctrl+K anywhere to open this</div>',
    ok: false,
    onMount(form) {
      const input = $('.sw-input', form)
      const box = $('.sw-list', form)
      let items = []
      let index = 0
      const draw = () => {
        const q = input.value.toLowerCase().trim()
        const all = []
        const people = Object.values(S.users).filter(u => u.id !== S.me.id)
        for (const u of people) {
          const dm = findDm(u.id)
          const score = (S.friends[u.id] === 'friends' ? 2 : 0) + (dm && dm.lastAt > dm.created ? 1 : 0)
          all.push({ score, key: (u.name + ' ' + u.username).toLowerCase(), html: avatar(u, 24, true) + '<span class="sw-name">' + esc(u.name) + '</span><span class="sw-sub">' + esc(u.username) + '</span>', run: () => openDmWith(u.id) })
        }
        if (mode !== 'dm') {
          for (const s of sortedServers()) {
            for (const c of serverChannels(s)) all.push({ score: c.unread ? 1.5 : 0.5, key: (c.name + ' ' + s.name).toLowerCase(), html: icon('hash', 18) + '<span class="sw-name">' + esc(c.name) + '</span><span class="sw-sub">' + esc(s.name) + '</span>', run: () => go(s.id, c.id) })
            all.push({ score: 0.4, key: s.name.toLowerCase(), html: '<span class="sw-pill" style="background:' + esc(s.color) + '">' + esc(initials(s.name)) + '</span><span class="sw-name">' + esc(s.name) + '</span><span class="sw-sub">Server</span>', run: () => go(s.id) })
          }
        }
        items = all.filter(it => !q || it.key.includes(q))
          .sort((a, b) => (q ? (a.key.startsWith(q) ? 0 : 1) - (b.key.startsWith(q) ? 0 : 1) : 0) || b.score - a.score || a.key.localeCompare(b.key))
          .slice(0, 12)
        index = 0
        box.innerHTML = items.length ? items.map((it, i) => '<div class="sw-item' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' + it.html + '</div>').join('') : '<div class="empty small">Cant find anything like that</div>'
      }
      const choose = i => {
        if (!items[i]) return
        closeModal()
        items[i].run()
      }
      input.addEventListener('input', draw)
      input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          if (!items.length) return
          index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          $$('.sw-item', box).forEach((el, i) => el.classList.toggle('on', i === index))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          choose(index)
        }
      })
      box.addEventListener('click', e => {
        const it = e.target.closest('[data-i]')
        if (it) choose(Number(it.dataset.i))
      })
      draw()
    }
  })
}

async function openDmWith(userId) {
  if (userId === S.me.id) return
  const dm = findDm(userId)
  if (dm) return go('@me', dm.id)
  try {
    const r = await request('openDm', { userId })
    go('@me', r.channelId)
  } catch (e) {
    toast(e.message, 'bad')
  }
}

async function friendAction(act, id) {
  try {
    if (act === 'addFriend') {
      await request('friendRequest', { userId: id })
      toast('Friend request sent to ' + user(id).name)
    } else if (act === 'accept') {
      await request('friendAccept', { userId: id })
      toast('You and ' + user(id).name + ' are now friends!', 'good')
    } else if (act === 'decline') {
      await request('friendRemove', { userId: id })
    } else if (act === 'unfriend') {
      const u = user(id)
      modal({
        title: "Remove '" + u.name + "'",
        body: '<p class="confirm-text">Are you sure you want to remove <b>' + esc(u.name) + '</b> from your friends?</p>',
        ok: 'Remove Friend',
        danger: true,
        onOk: () => request('friendRemove', { userId: id })
      })
    }
  } catch (e) {
    toast(e.message, 'bad')
  }
}

function handleAction(act, id) {
  if (act === 'msg') return openDmWith(id)
  if (act === 'settings') return settingsModal()
  if (['addFriend', 'accept', 'decline', 'unfriend'].includes(act)) return friendAction(act, id)
  if (act === 'profile') {
    const el = document.querySelector('[data-act="profile"][data-id="' + id + '"]')
    if (el) popoutFor(el, id)
  }
}

function statusMenu(anchor) {
  const r = anchor.getBoundingClientRect()
  const dot = st => '<i class="dot inline ' + st + '"></i>'
  const set = status => request('updateMe', { status }).catch(e => toast(e.message, 'bad'))
  openMenu([
    { html: dot('online') + 'Online', run: () => set('online') },
    { html: dot('idle') + 'Idle', run: () => set('idle') },
    { html: dot('dnd') + 'Do Not Disturb<div class="menu-sub">You wont get notification sounds</div>', run: () => set('dnd') },
    { html: dot('offline') + 'Invisible<div class="menu-sub">You will look offline but can still use everything</div>', run: () => set('invisible') },
    '-',
    { label: S.me.customStatus ? 'Edit Custom Status' : 'Set Custom Status', icon: 'smile', run: customStatusModal },
    { label: 'Edit Profile', icon: 'edit', run: settingsModal },
    { label: 'Copy Username', icon: 'copy', run: () => copyText(S.me.username) },
    '-',
    { label: 'Log Out', icon: 'logout', danger: true, run: logout }
  ], r.left, r.top - 330)
}

function serverMenu(serverId, x, y) {
  const s = S.servers[serverId]
  if (!s) return
  const owner = s.owner === S.me.id
  openMenu([
    { label: 'Invite People', icon: 'invite', run: () => inviteModal(serverId) },
    owner ? { label: 'Server Settings', icon: 'gear', run: () => serverSettingsModal(serverId) } : null,
    owner ? { label: 'Create Channel', icon: 'plus', run: () => createChannelModal(serverId) } : null,
    { label: 'Mark As Read', icon: 'check', run: () => { for (const c of serverChannels(s)) markRead(c.id) } },
    { label: 'Copy Server Name', icon: 'copy', run: () => copyText(s.name) },
    '-',
    owner
      ? { label: 'Delete Server', icon: 'trash', danger: true, run: () => serverSettingsModal(serverId) }
      : { label: 'Leave Server', icon: 'logout', danger: true, run: () => leaveServer(serverId) }
  ], x, y)
}

function leaveServer(serverId) {
  const s = S.servers[serverId]
  modal({
    title: "Leave '" + s.name + "'",
    body: '<p class="confirm-text">Are you sure you want to leave <b>' + esc(s.name) + '</b>? You wont be able to rejoin unless you are re-invited.</p>',
    ok: 'Leave Server',
    danger: true,
    onOk: () => request('leaveServer', { serverId })
  })
}

function channelMenu(channelId, x, y) {
  const ch = S.channels[channelId]
  if (!ch) return
  if (ch.type === 'dm') {
    const u = dmOther(ch)
    return openMenu([
      { label: 'Mark As Read', icon: 'check', run: () => markRead(ch.id, true) },
      { label: 'Profile', icon: 'user', run: () => profilePopout(u.id, x, y) },
      { label: 'Copy Username', icon: 'copy', run: () => copyText(u.username) },
      '-',
      { label: 'Close DM', icon: 'x', danger: true, run: () => hideDm(ch.id) }
    ], x, y)
  }
  const owner = isOwner(ch.serverId)
  openMenu([
    { label: 'Mark As Read', icon: 'check', run: () => markRead(ch.id, true) },
    { label: 'Copy Channel Name', icon: 'copy', run: () => copyText('#' + ch.name) },
    owner ? '-' : null,
    owner ? { label: 'Edit Channel', icon: 'gear', run: () => channelSettingsModal(ch.id) } : null,
    owner ? { label: 'Delete Channel', icon: 'trash', danger: true, run: () => modal({ title: 'Delete Channel', body: '<p class="confirm-text">Are you sure you want to delete <b>#' + esc(ch.name) + '</b>? This cant be undone.</p>', ok: 'Delete Channel', danger: true, onOk: () => request('deleteChannel', { channelId: ch.id }) }) } : null
  ], x, y)
}

function userMenu(userId, x, y) {
  if (!S.users[userId]) return
  const u = user(userId)
  const ch = chan()
  const serverId = ch && ch.type !== 'dm' ? ch.serverId : null
  const state = S.friends[u.id]
  const isMe = u.id === S.me.id
  openMenu([
    { label: 'Profile', icon: 'user', run: () => profilePopout(u.id, x, y, serverId) },
    !isMe ? { label: 'Message', icon: 'message', run: () => openDmWith(u.id) } : null,
    ch && !isMe ? { label: 'Mention', icon: 'at', run: () => insertAtCaret('@' + u.username + ' ') } : null,
    '-',
    !isMe && !state ? { label: 'Add Friend', icon: 'invite', run: () => friendAction('addFriend', u.id) } : null,
    !isMe && state === 'incoming' ? { label: 'Accept Friend Request', icon: 'check', run: () => friendAction('accept', u.id) } : null,
    !isMe && state === 'friends' ? { label: 'Remove Friend', icon: 'x', danger: true, run: () => friendAction('unfriend', u.id) } : null,
    { label: 'Copy Username', icon: 'copy', run: () => copyText(u.username) },
    serverId && isOwner(serverId) && !isMe ? '-' : null,
    serverId && isOwner(serverId) && !isMe ? { label: 'Kick ' + u.name, icon: 'logout', danger: true, run: () => modal({ title: "Kick '" + u.name + "'", body: '<p class="confirm-text">Are you sure you want to kick <b>' + esc(u.name) + '</b>? They can join again if they have an invite.</p>', ok: 'Kick', danger: true, onOk: () => request('kick', { serverId, userId: u.id }) }) } : null
  ], x, y)
}

function messageMenu(m, x, y) {
  const mine = m.author === S.me.id
  openMenu([
    { row: QUICK, run: e => react(m, e) },
    { label: 'Add Reaction', icon: 'smile', run: () => emojiPicker(x, y, e => react(m, e)) },
    { label: 'Reply', icon: 'reply', run: () => startReply(m) },
    mine ? { label: 'Edit Message', icon: 'edit', run: () => startEdit(m) } : null,
    canPin(m) ? { label: m.pinned ? 'Unpin Message' : 'Pin Message', icon: 'pin', run: () => togglePin(m) } : null,
    m.text ? { label: 'Copy Text', icon: 'copy', run: () => copyText(m.text) } : null,
    { label: 'Mark Unread', icon: 'bell', run: () => markUnreadFrom(m) },
    canDelete(m) ? '-' : null,
    canDelete(m) ? { label: 'Delete Message', icon: 'trash', danger: true, run: () => askDelete(m) } : null
  ], x, y)
}

function markUnreadFrom(m) {
  const ch = S.channels[m.channelId]
  const list = S.msgs[m.channelId] || []
  const i = list.findIndex(x => x.id === m.id)
  ch.unread = list.slice(i).filter(x => x.author !== S.me.id).length || 1
  S.markedUnread = ch.id
  queue('rail', 'side')
  toast('Marked as unread')
}

function hideDm(id) {
  const ch = S.channels[id]
  if (!ch) return
  S.hiddenDms[id] = ch.lastAt || Date.now()
  ch.opened = false
  store.set('hiddenDms', S.hiddenDms)
  if (S.channelId === id) go('@me', null)
  else queue('side')
}

function findMsgById(id) {
  return (S.msgs[S.channelId] || []).find(m => m.id === id)
}

function openDrawer() {
  document.body.classList.add('drawer-open')
}

function closeDrawer() {
  document.body.classList.remove('drawer-open')
}

$('#shade').addEventListener('click', closeDrawer)

$('#rail').addEventListener('click', e => {
  const b = e.target.closest('[data-act]')
  if (!b) return
  const a = b.dataset.act
  if (a === 'home') go('@me', S.lastIn['@me'] && S.channels[S.lastIn['@me']] ? S.lastIn['@me'] : null)
  else if (a === 'dm') go('@me', b.dataset.id)
  else if (a === 'server') go(b.dataset.id)
  else if (a === 'create') createServerModal()
  else if (a === 'join') joinServerModal()
})

$('#rail').addEventListener('contextmenu', e => {
  const b = e.target.closest('[data-act=server]')
  if (!b) return
  e.preventDefault()
  serverMenu(b.dataset.id, e.clientX, e.clientY)
})

$('#side').addEventListener('click', e => {
  const b = e.target.closest('[data-act]')
  if (!b) return
  const a = b.dataset.act
  const id = b.dataset.id
  if (a === 'switcher') switcher()
  else if (a === 'newDm') switcher('dm')
  else if (a === 'friends') go('@me', null)
  else if (a === 'openDm') go('@me', id)
  else if (a === 'hideDm') hideDm(id)
  else if (a === 'openChannel') go(S.serverId, id)
  else if (a === 'editChannel') channelSettingsModal(id)
  else if (a === 'newChannel') createChannelModal(S.serverId)
  else if (a === 'invite') inviteModal(S.serverId)
  else if (a === 'serverMenu') {
    const [x, y] = menuAt(b)
    serverMenu(S.serverId, x + 10, y)
  } else if (a === 'statusMenu') statusMenu(b)
  else if (a === 'settings') settingsModal()
})

$('#side').addEventListener('contextmenu', e => {
  const row = e.target.closest('.ch-row, .dm-row')
  if (!row) return
  e.preventDefault()
  channelMenu(row.dataset.id, e.clientX, e.clientY)
})

$('#head').addEventListener('click', e => {
  const userEl = e.target.closest('[data-user]')
  if (userEl && userEl.dataset.user) return popoutFor(userEl, userEl.dataset.user)
  const b = e.target.closest('[data-act]')
  if (!b) return
  const a = b.dataset.act
  if (a === 'drawer') openDrawer()
  else if (a === 'tab') {
    S.friendsTab = b.dataset.tab
    queue('head', 'center')
  } else if (a === 'people') {
    S.right = S.right === 'people' ? null : 'people'
    store.set('right', S.right)
    queue('head', 'right')
  } else if (a === 'pins') {
    if (S.right === 'pins') S.right = store.get('right', 'people')
    else {
      S.right = 'pins'
      S.pins = null
      loadPins()
    }
    queue('head', 'right')
  }
})

$('#head').addEventListener('input', e => {
  if (e.target.id === 'searchBox') S.searchQ = e.target.value
})

$('#head').addEventListener('keydown', e => {
  if (e.target.id !== 'searchBox') return
  if (e.key === 'Enter') doSearch(e.target.value)
  if (e.key === 'Escape') {
    S.searchQ = ''
    e.target.value = ''
    if (S.right === 'search') S.right = store.get('right', 'people')
    queue('head', 'right')
    $('#input').focus()
  }
})

$('#right').addEventListener('click', e => {
  const b = e.target.closest('[data-act]')
  if (b) {
    e.stopPropagation()
    const a = b.dataset.act
    if (a === 'closeRight') {
      S.right = store.get('right', 'people')
      if (S.right === 'search' || S.right === 'pins') S.right = 'people'
      queue('head', 'right')
    } else if (a === 'unpin') {
      request('pin', { channelId: b.dataset.ch, messageId: b.dataset.id }).catch(err => toast(err.message, 'bad'))
    } else if (a === 'jump') {
      jumpTo(b.dataset.ch, b.dataset.id)
      if (innerWidth < 1000) {
        S.right = null
        queue('right', 'head')
      }
    } else handleAction(a, b.dataset.id)
    return
  }
  const u = e.target.closest('[data-user]')
  if (u && u.dataset.user) popoutFor(u, u.dataset.user)
})

$('#right').addEventListener('contextmenu', e => {
  const u = e.target.closest('.member[data-user]')
  if (!u) return
  e.preventDefault()
  userMenu(u.dataset.user, e.clientX, e.clientY)
})

$('#friendsView').addEventListener('click', e => {
  const b = e.target.closest('[data-act]')
  if (!b) return
  const a = b.dataset.act
  const id = b.dataset.id
  if (a === 'profile') return popoutFor(b.querySelector('.av') || b, id)
  handleAction(a, id)
})

$('#friendsView').addEventListener('submit', async e => {
  if (e.target.id !== 'addFriendForm') return
  e.preventDefault()
  const input = $('input', e.target)
  const msg = $('#addFriendMsg')
  const name = input.value.trim()
  if (!name) return
  try {
    const r = await request('friendRequest', { username: name })
    msg.className = 'add-msg good'
    msg.textContent = r.state === 'friends' ? 'You and ' + r.name + ' are now friends!' : 'Success! Your friend request to ' + r.name + ' was sent.'
    input.value = ''
  } catch (err) {
    msg.className = 'add-msg bad'
    msg.textContent = err.message
  }
})

$('#friendsView').addEventListener('input', e => {
  if (e.target.id !== 'friendFilter') return
  const q = e.target.value.toLowerCase()
  $$('#friendList .friend-row').forEach(row => {
    const u = user(row.dataset.id)
    row.classList.toggle('hidden', !!q && !(u.name.toLowerCase().includes(q) || u.username.includes(q)))
  })
})

$('#friendsView').addEventListener('contextmenu', e => {
  const row = e.target.closest('.friend-row')
  if (!row) return
  e.preventDefault()
  userMenu(row.dataset.id, e.clientX, e.clientY)
})

const msgsBox = $('#msgs')

msgsBox.addEventListener('scroll', () => {
  S.atBottom = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight < 80
  if (msgsBox.scrollTop < 300 && S.channelId) loadOlder(S.channelId)
})

msgsBox.addEventListener('load', e => {
  if (e.target.tagName === 'IMG' && S.atBottom) msgsBox.scrollTop = msgsBox.scrollHeight
}, true)

msgsBox.addEventListener('click', e => {
  const spoiler = e.target.closest('.spoiler')
  if (spoiler && !spoiler.classList.contains('shown')) {
    spoiler.classList.add('shown')
    return
  }
  const b = e.target.closest('[data-act]')
  const row = e.target.closest('.msg')
  const m = row ? findMsgById(row.dataset.id) : null
  if (b) {
    const a = b.dataset.act
    if (a !== 'viewImage') e.preventDefault()
    if (a === 'viewImage') return imageViewer(b.getAttribute('src'), b.getAttribute('alt'))
    if (a === 'cancelEdit') return cancelEdit()
    if (a === 'saveEdit') return saveEdit()
    if (a === 'jumpReply') return jumpTo(S.channelId, b.dataset.id)
    if (a === 'editChannel') return channelSettingsModal(b.dataset.id)
    if (['addFriend', 'accept', 'unfriend'].includes(a)) return friendAction(a, b.dataset.id)
    if (!m) return
    if (a === 'reply') return startReply(m)
    if (a === 'edit') return startEdit(m)
    if (a === 'delete') return askDelete(m, e.shiftKey)
    if (a === 'pin') return togglePin(m)
    if (a === 'quickReact') return react(m, b.dataset.emoji)
    if (a === 'toggleReact') return react(m, b.dataset.emoji)
    if (a === 'react') {
      const r = b.getBoundingClientRect()
      return emojiPicker(r.left - 300, r.bottom + 4, em => react(m, em))
    }
    return
  }
  const u = e.target.closest('[data-user]')
  if (u && u.dataset.user) popoutFor(u, u.dataset.user)
})

msgsBox.addEventListener('contextmenu', e => {
  if (e.target.closest('a, .edit-box')) return
  const u = e.target.closest('.name[data-user], .av[data-user]')
  if (u && u.dataset.user) {
    e.preventDefault()
    return userMenu(u.dataset.user, e.clientX, e.clientY)
  }
  const row = e.target.closest('.msg')
  if (!row || row.classList.contains('system')) return
  const m = findMsgById(row.dataset.id)
  if (!m) return
  e.preventDefault()
  messageMenu(m, e.clientX, e.clientY)
})

msgsBox.addEventListener('input', e => {
  if (!e.target.classList.contains('edit-box') || !S.editing) return
  S.editing.text = e.target.value
  autosize(e.target)
})

msgsBox.addEventListener('keydown', e => {
  if (!e.target.classList.contains('edit-box')) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    cancelEdit()
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    saveEdit()
  }
})

const input = $('#input')
$('#attachBtn').innerHTML = icon('plus', 20)
$('#emojiBtn').innerHTML = icon('smile', 22)

input.addEventListener('input', () => {
  autosize(input)
  sendTyping()
  checkAutocomplete()
})

input.addEventListener('click', checkAutocomplete)

input.addEventListener('keydown', e => {
  if (S.ac) {
    if (e.key === 'ArrowDown') { e.preventDefault(); return moveAc(1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); return moveAc(-1) }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return applyAc(S.ac.index) }
    if (e.key === 'Escape') { e.preventDefault(); return hideAc() }
  }
  const sendKey = prefs.enterSends ? e.key === 'Enter' && !e.shiftKey : e.key === 'Enter' && (e.ctrlKey || e.metaKey)
  if (sendKey && !e.isComposing) {
    e.preventDefault()
    sendMessage()
  } else if (e.key === 'Escape') {
    if (S.reply) cancelReply()
    else {
      msgsBox.scrollTop = msgsBox.scrollHeight
      markRead(S.channelId)
    }
  } else if (e.key === 'ArrowUp' && !input.value) {
    const list = S.msgs[S.channelId] || []
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].author === S.me.id && !list[i].system) {
        e.preventDefault()
        startEdit(list[i])
        break
      }
    }
  }
})

input.addEventListener('paste', e => {
  const files = [...(e.clipboardData && e.clipboardData.files || [])]
  if (files.length) {
    e.preventDefault()
    addFiles(files)
  }
})

input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) hideAc() }, 150))

$('#ac').addEventListener('mousedown', e => {
  const it = e.target.closest('[data-i]')
  if (!it) return
  e.preventDefault()
  applyAc(Number(it.dataset.i))
})

$('#attachBtn').addEventListener('click', () => $('#fileInput').click())

$('#fileInput').addEventListener('change', e => {
  addFiles([...e.target.files])
  e.target.value = ''
})

$('#emojiBtn').addEventListener('click', e => {
  e.stopPropagation()
  const r = $('#emojiBtn').getBoundingClientRect()
  emojiPicker(r.right - 340, r.top - 420, em => insertAtCaret(em))
})

$('#replyBar').addEventListener('click', e => {
  if (e.target.closest('[data-act=cancelReply]')) cancelReply()
})

$('#uploads').addEventListener('click', e => {
  const b = e.target.closest('[data-i]')
  if (!b) return
  const f = S.files[b.dataset.i]
  if (f && f.preview) URL.revokeObjectURL(f.preview)
  S.files.splice(Number(b.dataset.i), 1)
  renderUploads()
})

let dragDepth = 0
window.addEventListener('dragenter', e => {
  if (!S.channelId || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return
  dragDepth++
  $('#dropHint').classList.remove('hidden')
})

window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) $('#dropHint').classList.add('hidden')
})

window.addEventListener('dragover', e => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault()
})

window.addEventListener('drop', e => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return
  e.preventDefault()
  dragDepth = 0
  $('#dropHint').classList.add('hidden')
  addFiles([...e.dataTransfer.files])
})

document.addEventListener('mousedown', e => {
  if (S.popup && !S.popup.contains(e.target) && !e.target.closest('#emojiBtn')) closePopups()
})

window.addEventListener('resize', closePopups)

document.addEventListener('keydown', e => {
  if (!S.ready) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    return switcher()
  }
  if (e.key === 'Escape') {
    if (S.popup) return closePopups()
    if (modalOpen()) return closeModal()
    if (document.body.classList.contains('drawer-open')) return closeDrawer()
  }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    const list = S.serverId === '@me' ? dmList().map(c => c.id) : (S.servers[S.serverId] || { channels: [] }).channels
    const i = list.indexOf(S.channelId)
    const next = list[i + (e.key === 'ArrowUp' ? -1 : 1)]
    if (next) go(S.serverId, next)
    return
  }
  const tag = document.activeElement && document.activeElement.tagName
  if (S.channelId && !modalOpen() && !S.popup && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    input.focus()
  }
})

window.addEventListener('focus', () => {
  if (S.ready && S.channelId && S.markedUnread !== S.channelId) markRead(S.channelId)
})

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.ready && S.channelId && S.markedUnread !== S.channelId) markRead(S.channelId)
})

msgsBox.addEventListener('mousedown', () => {
  if (S.markedUnread === S.channelId) S.markedUnread = null
})

setInterval(() => {
  const now = Date.now()
  let changed = false
  for (const ch in S.typing) {
    for (const id in S.typing[ch]) {
      if (S.typing[ch][id] < now) {
        delete S.typing[ch][id]
        if (ch === S.channelId) changed = true
      }
    }
  }
  if (changed) queue('typing')
}, 1000)

if (S.token) {
  showLoading()
  connect(S.token)
} else {
  showAuth()
}
