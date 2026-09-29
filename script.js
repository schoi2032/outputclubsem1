const btn = document.getElementById('writeBtn')
const lines = Array.from(document.querySelectorAll('.w'))
const texts = lines.map(el => el.textContent.replace(/\s+/g, ' ').trim())

let writing = false
let skip = false

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function writeLine(el, text) {
  el.classList.remove('waiting')
  el.classList.add('pen')
  if (!skip) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

  for (let i = 0; i < text.length; i++) {
    if (skip) break
    el.textContent += text[i]
    let delay = 25 + Math.random() * 45
    if (',.!?'.includes(text[i])) delay += 200
    await wait(delay)
  }

  el.textContent = text
  el.classList.remove('pen')
}

btn.addEventListener('click', async () => {
  if (writing) {
    skip = true
    return
  }

  writing = true
  skip = false
  btn.textContent = 'skip ⏩'
  window.scrollTo({ top: 0, behavior: 'smooth' })

  lines.forEach(el => {
    el.textContent = ''
    el.classList.add('waiting')
  })

  for (let i = 0; i < lines.length; i++) {
    await writeLine(lines[i], texts[i])
    if (!skip) await wait(300)
  }

  writing = false
  btn.textContent = 'write it again ✏️'
})
