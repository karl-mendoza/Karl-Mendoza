/*
 * MapControls: Google Maps-style control cluster for a KMMapViewport.
 *
 * Bottom-right stack: locate / recenter (round), zoom + / − (card), and a bar
 * with full screen, layer thumbnails and a collapse chevron. Also renders the
 * "use Ctrl + scroll to zoom" hint when the viewport reports a plain wheel.
 *
 * KMMapControls.mount(host, viewport, {
 *   layers: [{ id, label, pressed, thumb }],   // thumb = inline SVG markup
 *   onLayerChange(id, pressed), onRecenter(), fullscreenTarget, recenterLabel,
 * }) => { element, destroy() }
 */
(() => {
  'use strict'

  const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`
  const ICONS = {
    locate: svg('<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    plus: svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
    minus: svg('<path d="M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
    enterFullscreen: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    exitFullscreen: svg('<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    chevrons: svg('<path d="M7 12.5l5-5 5 5M7 18l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  }

  let uid = 0
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '')

  function button(className, label, icon) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = `asd-map-btn ${className}`.trim()
    el.setAttribute('aria-label', label)
    el.title = label
    el.innerHTML = icon
    return el
  }

  function mount(host, viewport, options = {}) {
    const { layers = [], onLayerChange = () => {}, onRecenter = () => viewport.reset(), fullscreenTarget = host, recenterLabel = 'Recenter map' } = options
    const id = `asd-map-${++uid}`
    const cleanup = []
    const on = (target, type, handler) => {
      target.addEventListener(type, handler)
      cleanup.push(() => target.removeEventListener(type, handler))
    }

    const root = document.createElement('div')
    root.className = 'asd-map-controls'
    root.setAttribute('role', 'group')
    root.setAttribute('aria-label', 'Map controls')
    root.dataset.mapIgnore = ''

    // Locate / recenter
    const locate = button('asd-map-locate', recenterLabel, ICONS.locate)
    on(locate, 'click', () => onRecenter())

    // Zoom
    const zoom = document.createElement('div')
    zoom.className = 'asd-map-zoom'
    zoom.setAttribute('role', 'group')
    zoom.setAttribute('aria-label', 'Zoom')
    const zoomIn = button('', 'Zoom in', ICONS.plus)
    const zoomOut = button('', 'Zoom out', ICONS.minus)
    const sep = document.createElement('span')
    sep.className = 'asd-map-sep'
    sep.setAttribute('aria-hidden', 'true')
    zoom.append(zoomIn, sep, zoomOut)
    on(zoomIn, 'click', () => viewport.canZoomIn && viewport.zoomIn())
    on(zoomOut, 'click', () => viewport.canZoomOut && viewport.zoomOut())

    // Bottom bar: full screen | layer thumbnails | chevron
    const bar = document.createElement('div')
    bar.className = 'asd-map-bar'
    const canFullscreen = Boolean(document.fullscreenEnabled && fullscreenTarget.requestFullscreen)
    const fullscreen = button('asd-map-fullscreen', 'Enter full screen', ICONS.enterFullscreen)
    fullscreen.hidden = !canFullscreen
    on(fullscreen, 'click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.()
      else fullscreenTarget.requestFullscreen?.().catch(() => {})
    })
    const syncFullscreen = () => {
      const active = document.fullscreenElement === fullscreenTarget
      fullscreen.innerHTML = active ? ICONS.exitFullscreen : ICONS.enterFullscreen
      fullscreen.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen')
      fullscreen.title = fullscreen.getAttribute('aria-label')
    }
    on(document, 'fullscreenchange', syncFullscreen)

    const strip = document.createElement('div')
    strip.className = 'asd-map-layers'
    strip.id = `${id}-layers`
    strip.setAttribute('role', 'group')
    strip.setAttribute('aria-label', 'Map layers')
    for (const layer of layers) {
      const thumb = document.createElement('button')
      thumb.type = 'button'
      thumb.className = 'asd-map-thumb'
      thumb.setAttribute('aria-label', `${layer.label} layer`)
      thumb.setAttribute('aria-pressed', String(layer.pressed !== false))
      thumb.title = layer.label
      thumb.innerHTML = layer.thumb
      on(thumb, 'click', () => {
        const pressed = thumb.getAttribute('aria-pressed') !== 'true'
        thumb.setAttribute('aria-pressed', String(pressed))
        onLayerChange(layer.id, pressed)
      })
      strip.append(thumb)
    }
    const more = button('asd-map-more', 'Hide layers', ICONS.chevrons)
    more.setAttribute('aria-expanded', 'true')
    more.setAttribute('aria-controls', strip.id)
    on(more, 'click', () => {
      const expanded = more.getAttribute('aria-expanded') !== 'true'
      more.setAttribute('aria-expanded', String(expanded))
      more.setAttribute('aria-label', expanded ? 'Hide layers' : 'Show layers')
      more.title = more.getAttribute('aria-label')
      strip.hidden = !expanded
    })
    // Layer thumbnails are optional (the hero uses the separate style picker).
    bar.append(fullscreen)
    if (layers.length) bar.append(strip, more)
    if (bar.querySelectorAll('button:not([hidden])').length === 0) bar.hidden = true

    root.append(locate, zoom, bar)

    // Wheel hint (cooperative scrolling)
    const hint = document.createElement('div')
    hint.className = 'asd-map-hint'
    hint.setAttribute('aria-hidden', 'true')
    hint.innerHTML = `<span>Use ${isMac ? '⌘' : 'Ctrl'} + scroll to zoom the map</span>`
    let hintTimer = 0
    on(viewport, 'hint', () => {
      hint.classList.add('is-visible')
      window.clearTimeout(hintTimer)
      hintTimer = window.setTimeout(() => hint.classList.remove('is-visible'), 1400)
    })

    // Disabled state at the zoom limits (aria-disabled keeps the buttons focusable).
    let lastIn = null
    let lastOut = null
    const syncZoom = () => {
      const canIn = viewport.canZoomIn
      const canOut = viewport.canZoomOut
      if (canIn !== lastIn) zoomIn.setAttribute('aria-disabled', String(!(lastIn = canIn)))
      if (canOut !== lastOut) zoomOut.setAttribute('aria-disabled', String(!(lastOut = canOut)))
    }
    on(viewport, 'change', syncZoom)
    on(root, 'click', syncZoom)
    syncZoom()

    host.append(hint, root)
    return {
      element: root,
      destroy() {
        for (const off of cleanup) off()
        window.clearTimeout(hintTimer)
        root.remove()
        hint.remove()
      },
    }
  }

  window.KMMapControls = { mount }
})()
