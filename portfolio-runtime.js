(() => {
  const themeKey = 'karl.theme'
  const home = new URL('./', window.location.href)
  const systemLight = window.matchMedia?.('(prefers-color-scheme: light)')

  // Theme: the visitor's saved choice wins; otherwise follow the system
  // (NIGHT = dark, DAY = light) until they pick one with the switch.
  let savedTheme = null
  try {
    const stored = window.localStorage.getItem(themeKey)
    if (stored === 'light' || stored === 'dark') savedTheme = stored
  } catch {
    // The page still works when browser storage is blocked.
  }
  let theme = savedTheme ?? (systemLight?.matches ? 'light' : 'dark')
  // Apply before anything mounts or paints (no wrong-theme flash, and the ASD
  // builds its first picture in the right theme).
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme

  function applyTheme(next, { persist = false } = {}) {
    if (next !== 'dark' && next !== 'light') return
    theme = next
    document.documentElement.dataset.theme = next
    document.documentElement.classList.toggle('dark', next === 'dark')
    document.documentElement.style.colorScheme = next
    syncModeSwitch()
    if (!persist) return
    savedTheme = next
    try {
      window.localStorage.setItem(themeKey, next)
    } catch {
      // Theme stays active for this page session.
    }
  }

  // Follow system changes until the visitor has made an explicit choice.
  systemLight?.addEventListener?.('change', event => {
    if (!savedTheme) applyTheme(event.matches ? 'light' : 'dark')
  })

  /* ------------------------------------------------- UI/UX sub-menu ---- */
  // "03 UI/UX" plus its pages (Design System, Application User Manual): the same markup,
  // classes (`.km-nav-group*`, `.km-sub` in App.css) and keyboard behaviour as
  // src/components/site/UiuxNavItem.tsx. Dropdown on desktop, expandable list
  // in the wrapped mobile header.
  const uiuxPages = [
    { number: '03.1', label: 'Design System', path: '/ui-ux/design-system' },
    { number: '03.2', label: 'Application User Manual', path: '/ui-ux/user-manual' },
  ]
  const desktopHover = window.matchMedia?.('(min-width: 721px) and (hover: hover) and (pointer: fine)')

  function appLink(path) {
    const url = new URL('app.html', home)
    url.hash = path
    return url.href
  }

  function createUiuxNavItem() {
    const group = document.createElement('li')
    group.className = 'km-nav-group'

    const link = document.createElement('a')
    link.className = 'asd-static-uiux relative whitespace-nowrap py-1 transition hover:text-foreground'
    link.href = appLink('/ui-ux')
    const number = document.createElement('span')
    number.className = 'mr-1.5 text-ok'
    number.textContent = '03'
    link.append(number, document.createTextNode('UI/UX'))

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'km-nav-toggle'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-haspopup', 'true')
    toggle.setAttribute('aria-controls', 'km-uiux-pages')
    toggle.setAttribute('aria-label', 'UI/UX pages')
    toggle.innerHTML = '<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true" focusable="false"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'

    const menu = document.createElement('ul')
    menu.id = 'km-uiux-pages'
    menu.className = 'km-sub'
    // inert while closed: the links leave the tab order at once, even mid fade-out.
    menu.inert = true
    for (const page of uiuxPages) {
      const item = document.createElement('li')
      const pageLink = document.createElement('a')
      pageLink.href = appLink(page.path)
      const pageNumber = document.createElement('span')
      pageNumber.textContent = page.number
      pageLink.append(pageNumber, document.createTextNode(page.label))
      item.append(pageLink)
      menu.append(item)
    }

    group.append(link, toggle, menu)
    const links = () => Array.from(menu.querySelectorAll('a'))
    let closeTimer

    function setOpen(open) {
      group.classList.toggle('is-open', open)
      toggle.setAttribute('aria-expanded', String(open))
      menu.inert = !open
    }
    const isOpen = () => group.classList.contains('is-open')
    function focusPage(index) {
      const items = links()
      items[(index + items.length) % items.length]?.focus()
    }
    function openAndFocus(index) {
      setOpen(true)
      window.requestAnimationFrame(() => focusPage(index))
    }

    toggle.addEventListener('click', () => setOpen(!isOpen()))
    toggle.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      openAndFocus(event.key === 'ArrowDown' ? 0 : -1)
    })
    group.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isOpen()) {
        event.preventDefault()
        setOpen(false)
        toggle.focus()
        return
      }
      const index = links().indexOf(document.activeElement)
      if (index < 0) return
      const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: -1 }
      if (event.key in moves) {
        event.preventDefault()
        focusPage(moves[event.key])
      }
    })
    group.addEventListener('focusout', event => {
      if (!group.contains(event.relatedTarget)) setOpen(false)
    })
    document.addEventListener('pointerdown', event => {
      if (isOpen() && !group.contains(event.target)) setOpen(false)
    })
    group.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse' || !desktopHover?.matches) return
      window.clearTimeout(closeTimer)
      setOpen(true)
    })
    group.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'mouse' || !desktopHover?.matches) return
      closeTimer = window.setTimeout(() => setOpen(false), 180)
    })
    menu.addEventListener('click', () => setOpen(false))
    return group
  }

  /* ------------------------------------------------ DAY / NIGHT switch ---- */
  // The design system's ThemeSwitch (src/design-system/components/ThemeSwitch.tsx):
  // same markup and classes, styled by src/design-system/styles/components.css.
  function createModeSwitch() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ds-theme-switch'
    button.setAttribute('role', 'switch')
    button.setAttribute('aria-label', 'Night mode')
    button.innerHTML =
      '<span class="ds-theme-switch__led" aria-hidden="true"></span>' +
      '<span class="ds-theme-switch__track" aria-hidden="true">' +
      '<span class="ds-theme-switch__thumb"></span>' +
      '<span class="ds-theme-switch__option ds-theme-switch__option--day">DAY</span>' +
      '<span class="ds-theme-switch__option ds-theme-switch__option--night">NIGHT</span>' +
      '</span>'
    button.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark', { persist: true }))
    return button
  }

  function syncModeSwitch() {
    const button = document.querySelector('.ds-theme-switch')
    if (!button) return
    const night = theme === 'dark'
    // Attribute writes only when they change (no needless DOM mutations).
    if (button.getAttribute('aria-checked') !== String(night)) button.setAttribute('aria-checked', String(night))
    const title = night ? 'Night mode on: switch to day' : 'Day mode on: switch to night'
    if (button.title !== title) button.title = title
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
      alternate: 'technology',
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

    if (!list.querySelector('.asd-static-uiux')) list.append(createUiuxNavItem())

    // Header tools (DAY / NIGHT switch): a group that is a direct child
    // of the nav placed in the top-right grid cell by CSS (beside the UTC
    // clock), so the header markup itself is untouched.
    if (!nav.querySelector(':scope > .asd-header-tools')) {
      const tools = document.createElement('div')
      tools.className = 'asd-header-tools'
      nav.append(tools)
      tools.append(createModeSwitch())
      // The UTC clock reserves exactly the group's width (fonts can change it).
      new ResizeObserver(() => nav.style.setProperty('--asd-mode-w', `${tools.offsetWidth}px`)).observe(tools)
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

    syncModeSwitch()
    // Aviation-themed "back to top" (public/back-to-top.js), mounted once.
    if (!document.querySelector('.asd-totop')) window.KMBackToTop?.mount({ focusTarget: () => nav.querySelector(':scope > a') })
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
    emphasis.textContent = 'AI-driven UI/UX design architect & UI software engineer'
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
      document.createTextNode(". Across 30 years — five in aviation and aerospace engineering, twenty in web, mobile and app development — I've focused on making complex, safety-critical ATM and ATC systems human-factors engineered."),
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
