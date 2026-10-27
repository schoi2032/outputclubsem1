gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin)

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const scenes = [...document.querySelectorAll('.scene')]
const glyphs = '▲△◆◇▼▽01#/'

let lenis = null
if (!still) {
  lenis = new Lenis({ lerp: 0.075, smoothWheel: true })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add(t => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
}

let keys = []

function measure() {
  keys = scenes.map(s => s.offsetTop + (s.offsetHeight - window.innerHeight) / 2)
  keys[0] = 0
}

function scrollPos() {
  return lenis ? lenis.scroll : window.scrollY
}

function sceneFloat() {
  const y = scrollPos()
  if (y <= keys[0]) return 0
  for (let i = 0; i < keys.length - 1; i++) {
    if (y < keys[i + 1]) return i + (y - keys[i]) / (keys[i + 1] - keys[i])
  }
  return keys.length - 1
}

function goTo(i) {
  const y = Math.max(0, keys[i])
  if (lenis) lenis.scrollTo(y, { duration: 1.8 })
  else window.scrollTo(0, y)
}

document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href')
    if (id.length < 2) return
    const i = scenes.findIndex(s => '#' + s.id === id)
    if (i < 0) return
    e.preventDefault()
    goTo(i)
  })
})

const dotsBox = document.getElementById('dots')
const dots = scenes.map((s, i) => {
  const b = document.createElement('button')
  b.setAttribute('aria-label', s.dataset.name)
  b.addEventListener('click', () => goTo(i))
  dotsBox.appendChild(b)
  return b
})

const hudNum = document.getElementById('hudNum')
const hudName = document.getElementById('hudName')
let active = -1

function setActive(i) {
  if (i === active) return
  active = i
  dots.forEach((d, k) => d.classList.toggle('on', k === i))
  gsap.to(hudNum, { duration: 0.6, scrambleText: { text: String(i).padStart(2, '0'), chars: '0123456789' } })
  gsap.to(hudName, { duration: 0.9, scrambleText: { text: scenes[i].dataset.name, chars: glyphs, speed: 0.6 } })
}

function scramble(el, duration) {
  if (!el) return
  if (!el.dataset.text) el.dataset.text = el.textContent
  gsap.to(el, { duration: duration, scrambleText: { text: el.dataset.text, chars: glyphs, speed: 0.5, revealDelay: 0.2 } })
}

function buildText() {
  scenes.forEach((scene, i) => {
    const first = i === 0
    const last = i === scenes.length - 1
    const label = scene.querySelector('.label')
    const fades = scene.querySelectorAll('.fade')
    const split = new SplitText(scene.querySelector('.jumble'), { type: 'words,chars', charsClass: 'ch' })
    const chars = split.chars

    if (still) return

    const jumbled = {
      x: 'random(-320, 320)',
      y: 'random(-240, 240)',
      rotation: 'random(-140, 140)',
      scale: 'random(0.2, 2.4)',
      opacity: 0,
      filter: 'blur(10px)'
    }

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: scene,
        start: first ? 'top top' : 'top 85%',
        end: last ? 'bottom bottom' : 'bottom 15%',
        scrub: 1.2
      }
    })

    if (!first) {
      tl.from(chars, { ...jumbled, duration: 1, ease: 'power3.out', stagger: { each: 0.015, from: 'random' } })
      tl.from(fades, { opacity: 0, y: 50, filter: 'blur(12px)', duration: 0.7, stagger: 0.08 }, '<0.35')
    }

    tl.to({}, { duration: first ? 0.5 : 1.1 })

    if (!last) {
      tl.to(chars, { ...jumbled, duration: 1, ease: 'power2.in', stagger: { each: 0.015, from: 'random' } })
      tl.to(fades, { opacity: 0, y: -50, filter: 'blur(12px)', duration: 0.6, stagger: 0.05 }, '<')
    }

    if (first) {
      gsap.from(chars, { ...jumbled, duration: 1.8, delay: 0.2, ease: 'expo.out', stagger: { each: 0.025, from: 'random' }, immediateRender: true })
      gsap.from(fades, { opacity: 0, y: 30, filter: 'blur(12px)', duration: 1.2, delay: 0.9, stagger: 0.12 })
      scramble(label, 1.4)
    }

    ScrollTrigger.create({
      trigger: scene,
      start: 'top 70%',
      end: 'bottom 30%',
      onEnter: () => scramble(label, 1.2),
      onEnterBack: () => scramble(label, 1.2)
    })
  })
}

const shapes = {
  bubble(c, w, h) {
    const bw = w * 0.9
    const bh = h * 0.62
    const x = (w - bw) / 2
    const y = h * 0.12
    c.beginPath()
    c.roundRect(x, y, bw, bh, bh * 0.3)
    c.moveTo(x + bw * 0.16, y + bh - 2)
    c.lineTo(x + bw * 0.06, y + bh + h * 0.2)
    c.lineTo(x + bw * 0.38, y + bh - 2)
    c.fill()
    c.globalCompositeOperation = 'destination-out'
    const r = bh * 0.085
    for (let i = -1; i <= 1; i++) {
      c.beginPath()
      c.arc(w / 2 + i * r * 3.6, y + bh / 2, r, 0, Math.PI * 2)
      c.fill()
    }
    c.globalCompositeOperation = 'source-over'
  },
  three(c, w, h) {
    glyph(c, w, h, '3')
  },
  question(c, w, h) {
    glyph(c, w, h, '?')
  },
  shield(c, w, h) {
    const s = w * 0.92
    const x = w / 2
    const y = (h - s) / 2
    c.beginPath()
    c.moveTo(x, y)
    c.quadraticCurveTo(x + s * 0.25, y + s * 0.1, x + s * 0.42, y + s * 0.1)
    c.quadraticCurveTo(x + s * 0.45, y + s * 0.7, x, y + s)
    c.quadraticCurveTo(x - s * 0.45, y + s * 0.7, x - s * 0.42, y + s * 0.1)
    c.quadraticCurveTo(x - s * 0.25, y + s * 0.1, x, y)
    c.fill()
    c.globalCompositeOperation = 'destination-out'
    c.lineWidth = s * 0.08
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.beginPath()
    c.moveTo(x - s * 0.16, y + s * 0.47)
    c.lineTo(x - s * 0.03, y + s * 0.6)
    c.lineTo(x + s * 0.19, y + s * 0.36)
    c.stroke()
    c.globalCompositeOperation = 'source-over'
  },
  heart(c, w, h) {
    const s = w / 36
    c.beginPath()
    for (let t = 0; t < Math.PI * 2; t += 0.02) {
      const px = 16 * Math.pow(Math.sin(t), 3)
      const py = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      c.lineTo(w / 2 + px * s, h / 2 - py * s - s * 2)
    }
    c.fill()
  }
}

function glyph(c, w, h, ch) {
  const size = w * 1.15
  c.font = `800 ${size}px Inter, sans-serif`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(ch, w / 2, h / 2 + size * 0.04)
}

function dust(out, j) {
  const r = 1.3 + Math.random() * 1.6
  const a = Math.random() * Math.PI * 2
  const b = Math.acos(Math.random() * 2 - 1)
  out[j * 3] = Math.sin(b) * Math.cos(a) * r
  out[j * 3 + 1] = Math.sin(b) * Math.sin(a) * r
  out[j * 3 + 2] = Math.cos(b) * r
}

function fromMask(draw, n) {
  const size = 360
  const off = document.createElement('canvas')
  off.width = size
  off.height = size
  const c = off.getContext('2d')
  c.fillStyle = '#fff'
  c.strokeStyle = '#fff'
  draw(c, size, size)
  const data = c.getImageData(0, 0, size, size).data
  const pts = []
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      if (data[(y * size + x) * 4 + 3] > 128) pts.push(x, y)
    }
  }
  const out = new Float32Array(n * 3)
  for (let j = 0; j < n; j++) {
    if (Math.random() < 0.1 || pts.length === 0) {
      dust(out, j)
      continue
    }
    const k = Math.floor(Math.random() * (pts.length / 2)) * 2
    const x = (pts[k] / size - 0.5) * 2
    const y = -(pts[k + 1] / size - 0.5) * 2
    const bulge = 1 - Math.min(1, x * x + y * y) * 0.6
    out[j * 3] = x
    out[j * 3 + 1] = y
    out[j * 3 + 2] = (Math.random() - 0.5) * 0.4 * bulge
  }
  return out
}

function galaxy(n) {
  const out = new Float32Array(n * 3)
  const tilt = -1.05
  for (let j = 0; j < n; j++) {
    const r = Math.pow(Math.random(), 0.7) * 2.4 + 0.15
    const arm = Math.floor(Math.random() * 3) * Math.PI * 2 / 3
    const a = arm + r * 2.2 + (Math.random() - 0.5) * 0.7
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const y = (Math.random() - 0.5) * 0.25 * (2.6 - r)
    out[j * 3] = x
    out[j * 3 + 1] = y * Math.cos(tilt) - z * Math.sin(tilt)
    out[j * 3 + 2] = y * Math.sin(tilt) + z * Math.cos(tilt)
  }
  return out
}

function tunnel(n) {
  const out = new Float32Array(n * 3)
  for (let j = 0; j < n; j++) {
    const a = Math.random() * Math.PI * 2
    const r = 1.25 + Math.random() * 1.2
    out[j * 3] = Math.cos(a) * r
    out[j * 3 + 1] = Math.sin(a) * r
    out[j * 3 + 2] = -Math.random() * 6 + 0.8
  }
  return out
}

async function buildWorld() {
  const [THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import('three'),
    import('three/addons/postprocessing/EffectComposer.js'),
    import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js')
  ])

  const canvas = document.getElementById('world')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.setClearColor(0x000000, 1)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x000000, 0.03)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 0, 16)

  scene.add(new THREE.AmbientLight(0xffffff, 0.45))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(4, 6, 10)
  scene.add(sun)
  const violet = new THREE.PointLight(0x8052ff, 60, 40)
  const amber = new THREE.PointLight(0xffb829, 40, 40)
  const teal = new THREE.PointLight(0x3ad1b0, 40, 40)
  scene.add(violet, amber, teal)

  const small = window.innerWidth < 700
  const n = small ? 1500 : 3200
  const geo = new THREE.TetrahedronGeometry(0.075)
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.3, metalness: 0.25, emissive: 0x0c0720 })
  const mesh = new THREE.InstancedMesh(geo, mat, n)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(mesh)

  const palette = ['#8052ff', '#8052ff', '#a98bff', '#ffb829', '#15846e', '#3ad1b0', '#e255ff', '#4d7cff', '#ff5c8a']
  const color = new THREE.Color()
  for (let j = 0; j < n; j++) {
    mesh.setColorAt(j, color.set(palette[Math.floor(Math.random() * palette.length)]))
  }
  mesh.instanceColor.needsUpdate = true

  const locals = [
    fromMask(shapes.bubble, n),
    fromMask(shapes.three, n),
    fromMask(shapes.shield, n),
    fromMask(shapes.question, n),
    fromMask(shapes.heart, n),
    galaxy(n),
    tunnel(n)
  ]

  const pos = new Float32Array(n * 3)
  const rot = new Float32Array(n * 3)
  const spin = new Float32Array(n * 3)
  const wander = new Float32Array(n * 3)
  const lag = new Float32Array(n)
  const size = new Float32Array(n)
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < 3; k++) {
      pos[j * 3 + k] = (Math.random() - 0.5) * 40
      rot[j * 3 + k] = Math.random() * Math.PI * 2
      spin[j * 3 + k] = (Math.random() - 0.5) * 0.04
      wander[j * 3 + k] = (Math.random() - 0.5) * 2
    }
    lag[j] = Math.random()
    size[j] = 0.5 + Math.random() * 0.9
  }

  let places = []

  function layout() {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z
    const halfW = halfH * camera.aspect
    const narrow = camera.aspect < 0.9
    const side = (dir, extra = 1) => narrow
      ? { x: 0, y: halfH * 0.36, z: 0, s: Math.min(halfW * 0.78, halfH * 0.42) * extra }
      : { x: dir * halfW * 0.47, y: 0, z: 0, s: Math.min(halfW * 0.38, halfH * 0.68) * extra }
    places = [
      side(1),
      side(-1),
      side(1),
      side(-1),
      side(1),
      { x: 0, y: narrow ? 0 : -halfH * 0.1, z: narrow ? -9 : -3, s: narrow ? halfW * 1.5 : halfW * 0.62 },
      { x: 0, y: 0, z: 0, s: narrow ? halfW * 0.8 : halfH * 0.62 }
    ]
    measure()
  }

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.45, 0.2)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  layout()
  window.addEventListener('resize', () => {
    layout()
    ScrollTrigger.refresh()
  })

  const mouse = new THREE.Vector2(0, 0)
  const smooth = new THREE.Vector2(0, 0)
  const ray = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  const hit = new THREE.Vector3(999, 999, 0)
  let pointer = false

  window.addEventListener('pointermove', e => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
    pointer = true
  })
  document.addEventListener('pointerleave', () => { pointer = false })

  const dummy = new THREE.Object3D()
  const clock = new THREE.Clock()

  function target(i, j, t, angY, angX, out) {
    const L = locals[i]
    const p = places[i]
    let x = L[j * 3]
    let y = L[j * 3 + 1]
    let z = L[j * 3 + 2]
    let ay = angY
    if (i === 6) {
      const a = t * 0.15 + z * 0.2
      const cx = x * Math.cos(a) - y * Math.sin(a)
      y = x * Math.sin(a) + y * Math.cos(a)
      x = cx
      z = ((z + t * 0.6) % 6.8 + 6.8) % 6.8 - 6
      ay = angY * 0.3
    } else if (i === 5) {
      const a = t * 0.06
      const cx = x * Math.cos(a) - z * Math.sin(a)
      z = x * Math.sin(a) + z * Math.cos(a)
      x = cx
      ay = angY * 0.4
    }
    const cy = Math.cos(ay)
    const sy = Math.sin(ay)
    const rx = x * cy + z * sy
    const rz = -x * sy + z * cy
    const cxa = Math.cos(angX)
    const sxa = Math.sin(angX)
    const ry = y * cxa - rz * sxa
    const rz2 = y * sxa + rz * cxa
    out[0] = p.x + rx * p.s
    out[1] = p.y + ry * p.s
    out[2] = p.z + rz2 * p.s
  }

  const a = [0, 0, 0]
  const b = [0, 0, 0]
  let lastActive = -1

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1)
    const t = clock.elapsedTime
    const f = sceneFloat()
    const i0 = Math.floor(f)
    const i1 = Math.min(i0 + 1, locals.length - 1)
    const raw = f - i0
    const k = Math.min(1, Math.max(0, (raw - 0.18) / 0.64))
    const mix = k * k * (3 - 2 * k)
    const now = Math.round(f)
    if (now !== lastActive) {
      lastActive = now
      setActive(now)
    }

    smooth.lerp(mouse, 0.05)
    const vel = lenis ? Math.min(Math.abs(lenis.velocity) * 0.025, 1.6) : 0

    if (pointer) {
      ray.setFromCamera(mouse, camera)
      ray.ray.intersectPlane(plane, hit)
    } else {
      hit.set(999, 999, 0)
    }

    const angY = Math.sin(t * 0.25) * 0.45 + smooth.x * 0.5
    const angX = Math.cos(t * 0.2) * 0.12 - smooth.y * 0.3
    const ease = still ? 1 : 1 - Math.pow(0.93, dt * 60)

    for (let j = 0; j < n; j++) {
      const m = Math.min(1, Math.max(0, mix * 1.5 - lag[j] * 0.5))
      target(i0, j, t, angY, angX, a)
      target(i1, j, t, angY, angX, b)
      const swirl = Math.sin(m * Math.PI) * 2.2 + vel
      const wob = Math.sin(t * 0.9 + j) * 0.04
      const tx = a[0] + (b[0] - a[0]) * m + wander[j * 3] * swirl + wob
      const ty = a[1] + (b[1] - a[1]) * m + wander[j * 3 + 1] * swirl + wob
      const tz = a[2] + (b[2] - a[2]) * m + wander[j * 3 + 2] * swirl

      let px = pos[j * 3] + (tx - pos[j * 3]) * ease
      let py = pos[j * 3 + 1] + (ty - pos[j * 3 + 1]) * ease
      let pz = pos[j * 3 + 2] + (tz - pos[j * 3 + 2]) * ease

      const dx = px - hit.x
      const dy = py - hit.y
      const d2 = dx * dx + dy * dy
      if (d2 < 3.2) {
        const d = Math.sqrt(d2) || 0.001
        const push = (1 - d / 1.79) * 0.35
        px += dx / d * push
        py += dy / d * push
        pz += push * 1.5
      }

      pos[j * 3] = px
      pos[j * 3 + 1] = py
      pos[j * 3 + 2] = pz

      rot[j * 3] += spin[j * 3] * (1 + vel * 4)
      rot[j * 3 + 1] += spin[j * 3 + 1] * (1 + vel * 4)
      rot[j * 3 + 2] += spin[j * 3 + 2]

      dummy.position.set(px, py, pz)
      dummy.rotation.set(rot[j * 3], rot[j * 3 + 1], rot[j * 3 + 2])
      dummy.scale.setScalar(size[j] * (1 + Math.sin(t * 2 + j) * 0.12))
      dummy.updateMatrix()
      mesh.setMatrixAt(j, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    violet.position.set(Math.cos(t * 0.4) * 9, Math.sin(t * 0.3) * 5, 6)
    amber.position.set(Math.cos(t * 0.3 + 2) * 9, Math.sin(t * 0.5 + 1) * 5, 5)
    teal.position.set(Math.sin(t * 0.2) * 7, -4, 7)

    camera.position.x += (smooth.x * 1.2 - camera.position.x) * 0.05
    camera.position.y += (smooth.y * 0.8 - camera.position.y) * 0.05
    camera.position.z = 16 - Math.sin(raw * Math.PI) * 1.6
    camera.lookAt(0, 0, 0)

    composer.render()
  }

  gsap.ticker.add(frame)
}

document.fonts.ready.then(() => {
  measure()
  buildText()
  setActive(0)
  buildWorld().catch(() => document.body.classList.add('no-gl'))
  ScrollTrigger.refresh()
})
