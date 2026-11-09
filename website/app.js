(() => {
  'use strict'

  // The public repository. index.html carries the same links for visitors without JavaScript.
  const REPO_URL = 'https://github.com/riotrequest/riot-bot'

  const root = document.documentElement
  root.classList.add('js')
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const $ = (selector, scope = document) => scope.querySelector(selector)
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)]

  /* Sticky nav gets a hairline once the page scrolls */
  const nav = $('.nav')
  const onScroll = () => nav.classList.toggle('stuck', scrollY > 8)
  addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  /* Riot, the live mascot */
  const button = $('#bot')
  const svg = $('#botSvg')
  const moodName = $('#moodName')
  const moods = ['cheeky', 'happy', 'thinking', 'focused', 'surprised', 'sleeping']
  let mood = 'cheeky'
  let awakeMood = 'cheeky'
  let dozing = false

  function setMood (next) {
    mood = next
    svg.dataset.mood = next
    moodName.textContent = next
    if (next !== 'sleeping') awakeMood = next
  }

  button.addEventListener('click', () => {
    dozing = false
    setMood(moods[(moods.indexOf(mood) + 1) % moods.length])
    activity()
  })

  // Blinking
  function blink () {
    if (mood !== 'sleeping' && !document.hidden) {
      svg.classList.add('blink')
      setTimeout(() => svg.classList.remove('blink'), 130)
      if (Math.random() < 0.18) setTimeout(() => {
        svg.classList.add('blink')
        setTimeout(() => svg.classList.remove('blink'), 120)
      }, 260)
    }
    setTimeout(blink, 2400 + Math.random() * 3600)
  }

  // Eyes follow the pointer; on touch screens Riot glances around on its own
  let lastPointer = 0
  let frame = 0
  function look (x, y, tilt) {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      svg.style.setProperty('--lx', `${(x * 14).toFixed(1)}px`)
      svg.style.setProperty('--ly', `${(y * 9).toFixed(1)}px`)
      svg.style.setProperty('--tilt', `${(tilt * 5).toFixed(2)}deg`)
    })
  }
  function follow (event) {
    if (event.pointerType === 'touch') return
    lastPointer = Date.now()
    const box = svg.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + box.height * 0.6
    const clamp = value => Math.max(-1, Math.min(1, value))
    const x = clamp((event.clientX - cx) / (innerWidth / 2))
    const y = clamp((event.clientY - cy) / (innerHeight / 2))
    look(x, y, x)
  }
  function wander () {
    if (Date.now() - lastPointer > 4000 && mood !== 'sleeping' && !document.hidden) {
      const glance = Math.random() < 0.3 ? [0, 0] : [Math.random() * 2 - 1, Math.random() * 1.6 - 0.8]
      look(glance[0], glance[1], glance[0] * 0.6)
    }
    setTimeout(wander, 1800 + Math.random() * 2600)
  }

  // Doze off when nobody's around. Waking is a little startling.
  let idleTimer = 0
  function activity () {
    clearTimeout(idleTimer)
    if (dozing) {
      dozing = false
      setMood('surprised')
      setTimeout(() => { if (mood === 'surprised' && !dozing) setMood(awakeMood) }, 1100)
    }
    idleTimer = setTimeout(() => {
      if (document.hidden || mood === 'sleeping') return
      dozing = true
      look(0, 0.3, 0)
      setMood('sleeping')
    }, 30000)
  }
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart']) {
    addEventListener(type, activity, { passive: true })
  }
  activity()

  if (!reduceMotion) {
    addEventListener('pointermove', follow, { passive: true })
    setTimeout(blink, 1800)
    setTimeout(wander, 2500)
  }

  /* Scroll reveals */
  const revealed = $$('.reveal')
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealed.forEach(el => el.classList.add('in'))
  } else {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('in')
        observer.unobserve(entry.target)
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    revealed.forEach((el, index) => {
      el.style.transitionDelay = `${(index % 4) * 70}ms`
      observer.observe(el)
    })
  }

  /* Site-access demo */
  const card = $('#demoCard')
  const result = $('#demoResult')
  const face = $('#demoFace')
  const outcomes = {
    remember: ['happy', '✓ Remembered. Scout can work on account.example.com without asking again. Revoke it anytime in Bot settings.'],
    once: ['focused', '✓ Allowed for this task only. Scout will ask again next time.'],
    deny: ['thinking', '✕ Denied. Scout won\'t touch that site.']
  }
  function showFace (name) {
    face.src = `/img/${name}.webp`
    face.classList.remove('pop')
    void face.offsetWidth
    face.classList.add('pop')
    setTimeout(() => face.classList.remove('pop'), 380)
  }
  card.addEventListener('click', event => {
    const pick = event.target.closest('[data-pick]')
    if (!pick) return
    const [expression, text] = outcomes[pick.dataset.pick]
    card.classList.add('done')
    showFace(expression)
    result.textContent = text + ' '
    const again = document.createElement('button')
    again.type = 'button'
    again.textContent = 'Ask again'
    again.addEventListener('click', () => {
      card.classList.remove('done')
      result.hidden = true
      showFace('focused')
      card.querySelector('[data-pick]').focus()
    })
    result.append(again)
    result.hidden = false
  })

  /* GitHub links and clone command */
  const repoLinks = $$('[data-repo]')
  if (REPO_URL) {
    for (const link of repoLinks) {
      link.href = REPO_URL
      link.removeAttribute('aria-disabled')
      link.rel = 'noopener'
      const label = $('[data-repo-label]', link)
      if (label) label.textContent = 'Star it on GitHub'
    }
    $('#repoUrl').textContent = `${REPO_URL}.git`
    $('#cmds .c').textContent = '# clone it'
  } else {
    for (const link of repoLinks) link.addEventListener('click', event => event.preventDefault())
  }

  /* Copy the quick-start commands */
  const copy = $('#copy')
  copy.addEventListener('click', async () => {
    const commands = $('#cmds').innerText.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).join('\n')
    try {
      await navigator.clipboard.writeText(commands)
      copy.textContent = 'Copied!'
    } catch {
      copy.textContent = 'Select & copy'
    }
    copy.classList.add('ok')
    setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('ok') }, 1600)
  })
})()
