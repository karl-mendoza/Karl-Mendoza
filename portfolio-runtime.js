(() => {
  const themeKey = 'karl.theme'
  const home = new URL('./', window.location.href)
  let theme = 'dark'

  try {
    theme = window.localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark'
  } catch {
    // The page still works when browser storage is blocked.
  }
  // Apply the saved theme before anything mounts or paints (no dark-first
  // flash, and the ASD builds its first picture in the right theme).
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme

  function applyTheme(next) {
    if (next !== 'dark' && next !== 'light') return
    theme = next
    document.documentElement.dataset.theme = next
    document.documentElement.classList.toggle('dark', next === 'dark')
    document.documentElement.style.colorScheme = next
    const button = document.querySelector('.asd-theme-toggle')
    if (button) {
      const label = next === 'dark' ? 'LIGHT MODE' : 'DARK MODE'
      // Only write when it changes: a text write is a DOM mutation and would re-trigger the observer.
      if (button.textContent !== label) button.textContent = label
      button.setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} mode`)
      button.setAttribute('aria-pressed', String(next === 'light'))
    }
    try {
      window.localStorage.setItem(themeKey, next)
    } catch {
      // Theme stays active for this page session.
    }
  }

  /**
   * Hero background: canvas air situation display (asd-scope.js) driven by a
   * pan/zoom camera (map-viewport.js) with a Google Maps-style control
   * cluster (map-controls.js).
   */
  /**
   * The wheel-zoom "map area": the radar side of the hero, i.e. right of the
   * copy column on two-column layouts, or below it when the copy spans the
   * width. Only while the hero sits at the top of the page.
   */
  function isInMapZone(hero, x, y) {
    const heroRect = hero.getBoundingClientRect()
    if (heroRect.top < -4 || y < heroRect.top || y > heroRect.bottom) return false
    let copy = hero.querySelector('h1')
    while (copy && copy.parentElement !== hero) copy = copy.parentElement
    if (!copy) return true
    const r = copy.getBoundingClientRect()
    const stacked = r.width > heroRect.width * 0.7
    return stacked ? y > r.bottom + 24 : x > r.right + 24
  }

  function mountHeroMap(hero) {
    const scope = window.KMAsdScope?.mount(hero)
    if (!scope || hero.kmMap || !window.KMMapViewport) return

    const layer = scope.layer
    layer.removeAttribute('aria-hidden')
    layer.tabIndex = 0
    layer.setAttribute('role', 'region')
    layer.setAttribute('aria-roledescription', 'map')
    layer.setAttribute('aria-label', 'Illustrative air situation display. Arrow keys pan, plus and minus zoom, 0 recenters.')

    const viewport = new window.KMMapViewport(hero, {
      minZoom: -1,
      maxZoom: 3,
      keyboardTarget: layer,
      // Plain wheel zooms in quarter levels (4 notches = one +/− step), only
      // with clear intent so normal page scrolling is never hijacked.
      wheelNeedsModifier: false,
      wheelStep: 0.25,
      // +/− buttons and keys use the same quarter-level increment and glide.
      zoomStep: 0.25,
      wheelZone: (x, y) => isInMapZone(hero, x, y),
      wheelHoverDelay: 350,
      wheelScrollGuard: 500,
      draggingClass: 'asd-map-dragging',
      hoverClass: 'asd-map-hover',
    })
    scope.attachViewport(viewport)
    const controls = window.KMMapControls?.mount(hero, viewport, {
      onRecenter: () => viewport.reset(),
      recenterLabel: 'Recenter on radar head',
      fullscreenTarget: hero,
    })
    // Google Maps-style style picker (bottom-left): ATM/ATC display styles + map details.
    const picker = window.KMMapLayerPicker?.mount(hero, {
      styles: scope.styles,
      value: scope.style,
      primary: 'radar',
      alternate: 'terrain',
      onChange: id => scope.setStyle(id),
      details: scope.details,
      onDetailChange: (id, on) => scope.setLayer(id, on),
      adjustments: scope.adjustments,
      onAdjust: (id, value) => scope.setAdjustment(id, value),
      onResetAdjustments: () => scope.resetAdjustments(),
    })
    if (picker) {
      scope.onPreviews(previews => picker.setPreviews(previews))
      scope.onStyleChange(id => picker.setValue(id))
    }
    hero.classList.add('asd-map-ready')
    hero.kmMap = { scope, viewport, controls, picker }
  }

  function mount() {
    const hero = document.querySelector('#top')
    if (!hero) return false
    hero.classList.add('asd-hero')
    mountHeroMap(hero)

    const nav = document.querySelector('nav[aria-label="Primary"]')
    const list = nav?.querySelector('ul')
    if (!list) return false

    if (!list.querySelector('.asd-static-login')) {
      const item = document.createElement('li')
      const link = document.createElement('a')
      link.className = 'asd-static-login relative whitespace-nowrap py-1 transition hover:text-foreground'
      const app = new URL('app.html', home)
      app.hash = '/ui-ux'
      link.href = app.href
      const number = document.createElement('span')
      number.className = 'mr-1.5 text-ok'
      number.textContent = '06'
      link.append(number, document.createTextNode('UI/UX'))
      item.append(link)
      list.append(item)
    }

    if (!list.querySelector('.asd-theme-toggle')) {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'asd-theme-toggle'
      button.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'))
      item.append(button)
      list.append(item)
    }

    if (nav && !nav.dataset.sectionLinksMounted) {
      nav.dataset.sectionLinksMounted = 'true'
      nav.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return
        const link = event.target.closest('a[href^="#"]')
        const hash = link?.getAttribute('href')
        const target = hash ? document.getElementById(hash.slice(1)) : null
        if (target) {
          event.preventDefault()
          if (window.location.hash !== hash) window.location.hash = hash
          target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
        }
      })
    }

    applyTheme(theme)
    return true
  }

  // Flag of Canada (official 1:2:1 proportions, Pantone 032 red #D52B1E).
  const CANADA_FLAG = '<svg class="asd-flag" viewBox="0 0 9600 4800" role="img" aria-label="Canadian flag" focusable="false"><title>Canada</title><path fill="#d52b1e" d="M0 0h2400v4800H0zm7200 0h2400v4800H7200z"/><path fill="#fff" d="M2400 0h4800v4800H2400z"/><path fill="#d52b1e" d="m4890 4430-45-863a95 95 0 0 1 111-98l859 151-116-320a65 65 0 0 1 20-73l941-762-212-99a65 65 0 0 1-34-79l186-572-542 115a65 65 0 0 1-73-38l-105-247-423 454a65 65 0 0 1-111-57l204-1052-327 189a65 65 0 0 1-91-27l-332-652-332 652a65 65 0 0 1-91 27l-327-189 204 1052a65 65 0 0 1-111 57l-423-454-105 247a65 65 0 0 1-73 38l-542-115 186 572a65 65 0 0 1-34 79l-212 99 941 762a65 65 0 0 1 20 73l-116 320 859-151a95 95 0 0 1 111 98l-45 863z"/></svg>'

  function emphasizeIntro() {
    const hero = document.querySelector('#top')
    const paragraph = hero && Array.from(hero.querySelectorAll('p')).find(item => item.textContent?.includes('AI-Driven UI/UX Design Architect & UI Engineer'))
    if (!paragraph || paragraph.querySelector('[data-intro-emphasis]')) return
    const emphasis = document.createElement('strong')
    emphasis.dataset.introEmphasis = 'true'
    emphasis.textContent = 'AI-driven UI/UX design architect and UI engineer'
    // Name + a small Canadian flag, kept together on one line.
    const name = document.createElement('span')
    name.className = 'asd-intro-name'
    name.append('Karl Mendoza')
    name.insertAdjacentHTML('beforeend', CANADA_FLAG)
    paragraph.replaceChildren(
      document.createTextNode("I'm "),
      name,
      document.createTextNode(', an '),
      emphasis,
      document.createTextNode(". Across 25 years — five in aviation and aerospace engineering, twenty in web, mobile and app development — I've focused on making complex, safety-critical ATM and ATC systems human-factors engineered."),
    )
  }

  // Stop observing as soon as the nav is mounted, so our own DOM writes can't loop back into mount().
  const observer = new MutationObserver(() => {
    if (mount()) observer.disconnect()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  const finish = () => window.setTimeout(() => {
    mount()
    emphasizeIntro()
    observer.disconnect()
  }, 180)
  if (document.readyState === 'complete') finish()
  else window.addEventListener('load', finish, { once: true })
})()
