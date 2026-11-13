export const MAX_LIVE_CODE = 30_000

const FILE_REF = /\/api\/files\/([0-9a-f-]{36})\/content\?inline=1/gi

export function liveImageIds(code: string) {
  return [...new Set([...code.matchAll(FILE_REF)].map((m) => m[1]!.toLowerCase()))]
}

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

export interface LiveInfo {
  kind: string
  dark: boolean
  reducedMotion: boolean
  scheme: string
}

export function buildLiveDoc(code: string, images: Record<string, string>, info: LiveInfo) {
  const withImages = code.replace(FILE_REF, (m, id: string) => images[id.toLowerCase()] ?? m)
  const wicky = JSON.stringify(info).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color-scheme:${/^[a-z ]+$/.test(info.scheme) ? info.scheme : 'normal'}}</style><script>window.wicky=${wicky};window.open=function(){return null};window.addEventListener('error',function(e){parent.postMessage({wickyError:String(e.message||e)},'*')});</script></head><body>${withImages}</body></html>`
}

export const LIVE_STARTERS: Record<string, string> = {
  default: `<canvas id="c"></canvas>
<style>
  canvas { width: 100%; height: 100%; display: block; }
</style>
<script>
  const c = document.getElementById('c')
  const g = c.getContext('2d')
  const dots = Array.from({ length: 24 }, () => ({
    x: Math.random(), y: Math.random(), s: Math.random() * 2 + 1, v: Math.random() * 0.004 + 0.001,
  }))
  function frame(t) {
    c.width = c.clientWidth * devicePixelRatio
    c.height = c.clientHeight * devicePixelRatio
    g.clearRect(0, 0, c.width, c.height)
    for (const d of dots) {
      d.y -= d.v
      if (d.y < 0) d.y = 1
      g.fillStyle = 'hsl(' + ((t / 20 + d.x * 360) % 360) + ' 90% 65%)'
      g.beginPath()
      g.arc(d.x * c.width, d.y * c.height, d.s * devicePixelRatio, 0, 7)
      g.fill()
    }
    if (!wicky.reducedMotion) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
</script>`,
}
