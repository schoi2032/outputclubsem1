const net = {
  onEvent() {},
  onDown() {},
  onAuthFail() {}
}

let sock = null
let sockToken = null
let reqSeq = 0
let retryDelay = 1000
const waiting = new Map()

function connect(token) {
  sockToken = token
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
  const ws = new WebSocket(proto + location.host + '/ws')
  sock = ws

  ws.onopen = () => {
    retryDelay = 1000
    ws.send(JSON.stringify({ t: 'auth', token }))
  }

  ws.onmessage = e => {
    let msg
    try { msg = JSON.parse(e.data) } catch (err) { return }
    if (msg.t === 'res') {
      const w = waiting.get(msg.id)
      if (!w) return
      waiting.delete(msg.id)
      clearTimeout(w.timer)
      if (msg.ok) w.resolve(msg.data)
      else w.reject(new Error(msg.error))
      return
    }
    if (msg.t === 'authFail') {
      sockToken = null
      net.onAuthFail()
      return
    }
    net.onEvent(msg)
  }

  ws.onclose = () => {
    if (ws !== sock) return
    for (const w of waiting.values()) {
      clearTimeout(w.timer)
      w.reject(new Error('Lost connection'))
    }
    waiting.clear()
    if (!sockToken) return
    net.onDown()
    setTimeout(() => {
      if (sockToken && ws === sock) connect(sockToken)
    }, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 15000)
  }
}

function disconnect() {
  sockToken = null
  const ws = sock
  sock = null
  if (ws) ws.close()
}

function request(t, data = {}) {
  return new Promise((resolve, reject) => {
    if (!sock || sock.readyState !== 1) return reject(new Error('Not connected right now'))
    const id = ++reqSeq
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error('The server took to long to answer'))
    }, 15000)
    waiting.set(id, { resolve, reject, timer })
    sock.send(JSON.stringify({ ...data, t, id }))
  })
}

function fire(t, data = {}) {
  if (sock && sock.readyState === 1) sock.send(JSON.stringify({ ...data, t }))
}

async function api(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || 'Request failed')
  return data
}

async function uploadFile(file, token) {
  const r = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      Authorization: token,
      'X-Filename': encodeURIComponent(file.name || 'file'),
      'Content-Type': 'application/octet-stream'
    },
    body: file
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || 'Upload failed')
  return data
}
