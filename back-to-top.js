/*
 * BackToTop: aviation-themed "back to top" button.
 *
 * A small instrument-style button (bottom-right) with a top-down airliner and
 * contrails. It appears once the visitor has scrolled down. Clicking it
 * smoothly scrolls to the top while a copy of the plane "takes off" from the
 * button and climbs out of the top of the screen, leaving a fading contrail.
 * Keyboard activation also moves focus to the top of the page. With reduced
 * motion the page jumps to the top and nothing flies.
 *
 * KMBackToTop.mount({ showAfter: () => px, focusTarget: () => element }) → { element, destroy() }
 */
(() => {
  'use strict'

  // Top-down airliner, nose up (24×24).
  const PLANE =
    '<svg class="asd-totop-plane" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 1.6c.85 0 1.35 1.05 1.35 2.4v5.05l7.35 4.3v1.95l-7.35-2.25v4.7l2.15 1.65v1.75L12 20.1l-3.5 1.05V19.4l2.15-1.65v-4.7l-7.35 2.25v-1.95l7.35-4.3V4c0-1.35.5-2.4 1.35-2.4Z"/>' +
    '</svg>'

  function mount(options = {}) {
    const {
      showAfter = () => window.innerHeight * 0.6,
      focusTarget = () => document.querySelector('a[href="#top"]'),
    } = options
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cleanup = []
    const on = (target, type, handler, opts) => {
      target.addEventListener(type, handler, opts)
      cleanup.push(() => target.removeEventListener(type, handler, opts))
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'asd-totop'
    button.setAttribute('aria-label', 'Back to top')
    button.title = 'Back to top'
    // Starts hidden: out of the tab order until the visitor has scrolled down.
    button.tabIndex = -1
    button.setAttribute('aria-hidden', 'true')
    button.innerHTML =
      '<span class="asd-totop-craft" aria-hidden="true">' +
      PLANE +
      '<span class="asd-totop-trail asd-totop-trail--l"></span><span class="asd-totop-trail asd-totop-trail--r"></span>' +
      '</span>'
    document.body.append(button)

    /* ----------------------------------------------------- visibility ---- */
    let visible = false
    let queued = false
    function update() {
      queued = false
      const next = window.scrollY > showAfter()
      if (next === visible) return
      visible = next
      button.classList.toggle('is-visible', visible)
      // Hidden: out of the tab order and away from assistive tech.
      button.tabIndex = visible ? 0 : -1
      button.setAttribute('aria-hidden', String(!visible))
      if (visible) button.classList.remove('is-launched')
    }
    on(window, 'scroll', () => {
      if (!queued) {
        queued = true
        requestAnimationFrame(update)
      }
    }, { passive: true })
    on(window, 'resize', update, { passive: true })
    update()

    /* ---------------------------------------------------------- flight ---- */
    function takeOff() {
      const r = button.getBoundingClientRect()
      const flyer = document.createElement('span')
      flyer.className = 'asd-totop-flyer'
      flyer.setAttribute('aria-hidden', 'true')
      flyer.innerHTML = PLANE + '<span class="asd-totop-flyer-trail"></span>'
      flyer.style.left = `${r.left + r.width / 2}px`
      flyer.style.top = `${r.top + r.height / 2}px`
      document.body.append(flyer)

      const climb = -(r.top + r.height / 2 + 80) // to just above the top edge
      const flight = flyer.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
          { transform: `translate(-50%, -50%) translate(-6px, ${climb * 0.18}px) rotate(-10deg) scale(1.08)`, opacity: 1, offset: 0.22 },
          { transform: `translate(-50%, -50%) translate(-22px, ${climb * 0.62}px) rotate(-4deg) scale(.92)`, opacity: 1, offset: 0.7 },
          { transform: `translate(-50%, -50%) translate(-14px, ${climb}px) rotate(2deg) scale(.7)`, opacity: 0 },
        ],
        { duration: 1150, easing: 'cubic-bezier(.45, 0, .7, .45)', fill: 'forwards' },
      )
      const trail = flyer.querySelector('.asd-totop-flyer-trail')
      trail.animate(
        [
          { height: '0px', opacity: 0.9 },
          { height: '140px', opacity: 0.75, offset: 0.6 },
          { height: '220px', opacity: 0 },
        ],
        { duration: 1150, easing: 'ease-out', fill: 'forwards' },
      )
      flight.onfinish = () => flyer.remove()
    }

    on(button, 'click', event => {
      const keyboard = event.detail === 0 // Enter / Space
      if (reduceMotion.matches) {
        window.scrollTo({ top: 0, behavior: 'auto' })
      } else {
        button.classList.add('is-launched') // the button's own plane has left
        takeOff()
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
      if (keyboard) {
        // Keyboard users land at the top of the page, not on a hidden button.
        const target = focusTarget()
        const settle = () => target?.focus({ preventScroll: true })
        if (reduceMotion.matches || !('onscrollend' in window)) window.setTimeout(settle, reduceMotion.matches ? 0 : 900)
        else window.addEventListener('scrollend', settle, { once: true })
      }
    })

    return {
      element: button,
      destroy() {
        for (const off of cleanup) off()
        button.remove()
      },
    }
  }

  window.KMBackToTop = { mount }
})()
