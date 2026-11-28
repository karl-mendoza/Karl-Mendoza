/*
 * MapViewport: reusable Google Maps-style pan/zoom input + camera for any surface.
 *
 * The camera is a 2D similarity transform: displayed = base * k + (tx, ty),
 * where "base" coordinates are the surface's own pixels at zoom 0. Renderers
 * read `viewport.transform` (e.g. once per animation frame) and listen for
 * `change` events; the viewport never touches layout itself.
 *
 * Input
 *   - Wheel zoom centred on the cursor (up = in, down = out). With
 *     `wheelNeedsModifier` (default) it only zooms while Ctrl/⌘ is held and a
 *     `hint` event is dispatched otherwise. `wheelStep` sets the levels per
 *     notch (fractions give finer increments); notches accumulate into one
 *     target the camera glides to (`wheelSmoothing`). A plain wheel only zooms inside
 *     `wheelZone`, after the pointer has rested there `wheelHoverDelay` ms,
 *     and not within `wheelScrollGuard` ms of a page scroll; over links/text
 *     and past the zoom limits it falls through, so the page keeps scrolling.
 *   - Drag to pan (with inertia), double-click / double-tap to zoom in
 *     (Shift + double-click zooms out).
 *   - Touch: one-finger drag pans, two-finger pinch zooms around the midpoint.
 *     Pair with `touch-action: pan-y` on the surface so vertical swipes still
 *     scroll the page.
 *   - Keyboard (on `keyboardTarget`): + / − zoom, arrows pan (Shift = faster),
 *     0 or Home resets.
 *
 * `enabled = false` ignores all input (e.g. while another view of the map,
 * such as the hero's 3D view, takes it); the camera keeps its state.
 *
 * Events: `change` (detail = transform), `hint` (detail = { type: 'wheel' }).
 * Exposes window.KMMapViewport.
 */
(() => {
  'use strict'

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const easeOutCubic = p => 1 - (1 - p) ** 3
  const LINE_HEIGHT = 16
  const WHEEL_NOTCH = 40 // |deltaY| px at or above which an event is a mouse-wheel notch
  const TWEEN_MS = 260
  const INERTIA_DECAY_MS = 325
  const DRAG_THRESHOLD = 3
  const TOUCH_SLOP = 8
  const DOUBLE_TAP_MS = 300

  const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable=""], [contenteditable="true"], [data-map-ignore]'
  const TEXT = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, code'

  /** Default rule: pan from empty background, never from controls, links or readable text. */
  function isPannableTarget(target, surface) {
    if (!(target instanceof Element) || !surface.contains(target)) return false
    if (target.closest(INTERACTIVE)) return false
    if (target instanceof SVGElement) return true
    if (target.closest(TEXT)) return false
    return ![...target.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
  }

  class MapViewport extends EventTarget {
    constructor(surface, options = {}) {
      super()
      this.surface = surface
      this.options = {
        minZoom: -1,
        maxZoom: 3,
        zoomStep: 1, // levels per +/− press (buttons and keyboard)
        gestureZoomStep: 1, // levels per double-click / double-tap
        panStep: 96,
        keyboardTarget: surface,
        wheelNeedsModifier: true,
        wheelStep: 0, // levels per mouse-wheel notch (0 = legacy half-level notches)
        wheelSmoothing: 90, // ms time constant of the wheel glide (~95% settled at 3×)
        wheelZone: () => true, // (clientX, clientY) => whether a plain wheel there may zoom
        wheelHoverDelay: 0, // ms the pointer must rest in the zone before the wheel zooms
        wheelScrollGuard: 0, // ms after a page scroll during which the wheel keeps scrolling
        canStartPan: target => isPannableTarget(target, surface),
        reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        draggingClass: 'is-map-dragging',
        hoverClass: '',
        ...options,
      }
      this.state = { k: 1, tx: 0, ty: 0 }
      this.size = { w: surface.clientWidth || 1, h: surface.clientHeight || 1 }
      this.constraint = null
      this.engaged = false
      this.pointers = new Map()
      this.gesture = null
      this.motion = null
      this.raf = 0
      this.lastTap = null
      this.enabled = true
      this.cleanup = []
      this.tick = this.tick.bind(this)
      this.bind()
    }

    /* --------------------------------------------------------------- state -- */
    get transform() {
      return { ...this.state, zoom: Math.log2(this.state.k) }
    }

    get zoom() {
      return Math.log2(this.state.k)
    }

    get targetZoom() {
      return this.motion?.targetZoom ?? this.zoom
    }

    get canZoomIn() {
      return this.targetZoom < this.options.maxZoom - 1e-3
    }

    get canZoomOut() {
      return this.targetZoom > this.options.minZoom + 1e-3
    }

    get isMoving() {
      return Boolean(this.motion || this.gesture?.moved)
    }

    /** fn({k, tx, ty}, size) => {k, tx, ty}; called after zoom limits are applied. */
    setConstraint(fn) {
      this.constraint = fn
      this.commit(this.state)
    }

    constrain(next) {
      const k = clamp(next.k, 2 ** this.options.minZoom, 2 ** this.options.maxZoom)
      const out = { k, tx: next.tx, ty: next.ty }
      return this.constraint ? { ...out, ...this.constraint(out, this.size) } : out
    }

    commit(next) {
      const s = this.constrain(next)
      const changed = s.k !== this.state.k || s.tx !== this.state.tx || s.ty !== this.state.ty
      this.state = s
      if (changed) this.dispatchEvent(new CustomEvent('change', { detail: this.transform }))
      return s
    }

    /** Zoom by `factor` keeping the surface point (ax, ay) fixed. */
    zoomedAround(from, factor, ax, ay) {
      return { k: from.k * factor, tx: ax - (ax - from.tx) * factor, ty: ay - (ay - from.ty) * factor }
    }

    center() {
      return [this.size.w / 2, this.size.h / 2]
    }

    /* --------------------------------------------------------- public API -- */
    /**
     * Zoom by `levels` around `anchor`. Animated zooms share the wheel's glide:
     * steps accumulate into one target the camera eases towards, so buttons,
     * keys and wheel all feel the same and rapid presses stay fluid.
     */
    zoomBy(levels, anchor = this.center(), { animate = true } = {}) {
      this.engaged = true
      const target = clamp(this.targetZoom + levels, this.options.minZoom, this.options.maxZoom)
      if (!animate || this.options.reducedMotion()) {
        this.zoomTo(target, anchor, { animate: false })
        return
      }
      this.motion = { type: 'wheel', targetZoom: target, anchor }
      this.schedule()
    }

    /** Zoom one `zoomStep` in / out around the centre (the +/− controls). */
    zoomIn(anchor) {
      this.zoomBy(this.options.zoomStep, anchor)
    }

    zoomOut(anchor) {
      this.zoomBy(-this.options.zoomStep, anchor)
    }

    zoomTo(zoom, anchor = this.center(), { animate = true } = {}) {
      const from = { ...this.state }
      const to = this.constrain(this.zoomedAround(from, 2 ** zoom / from.k, anchor[0], anchor[1]))
      this.tweenTo(to, { animate, anchor, targetZoom: Math.log2(to.k) })
    }

    panBy(dx, dy, { animate = true } = {}) {
      this.engaged = true
      const base = this.motion?.type === 'tween' ? this.motion.to : this.state
      this.tweenTo(this.constrain({ ...base, tx: base.tx + dx, ty: base.ty + dy }), { animate })
    }

    reset({ animate = true } = {}) {
      this.engaged = true
      this.tweenTo(this.constrain({ k: 1, tx: 0, ty: 0 }), { animate, targetZoom: 0 })
    }

    stop() {
      this.motion = null
      if (this.raf) cancelAnimationFrame(this.raf)
      this.raf = 0
    }

    destroy() {
      this.stop()
      for (const off of this.cleanup) off()
      this.cleanup = []
    }

    /* ---------------------------------------------------------- animation -- */
    tweenTo(to, { animate = true, anchor = null, targetZoom = Math.log2(to.k) } = {}) {
      if (!animate || this.options.reducedMotion()) {
        this.stop()
        this.commit(to)
        return
      }
      this.motion = { type: 'tween', from: { ...this.state }, to, anchor, start: performance.now(), duration: TWEEN_MS, targetZoom }
      this.schedule()
    }

    schedule() {
      if (!this.raf) this.raf = requestAnimationFrame(this.tick)
    }

    tick(now) {
      this.raf = 0
      const m = this.motion
      if (!m) return
      const dt = Math.min(64, now - (m.last ?? now))
      m.last = now

      if (m.type === 'tween') {
        const p = clamp((now - m.start) / m.duration, 0, 1)
        const e = easeOutCubic(p)
        const k = m.from.k * (m.to.k / m.from.k) ** e
        let next
        if (m.anchor && m.from.k !== m.to.k) {
          // Keep the anchor fixed while zooming, then blend in any correction
          // the constraint applied to the end state.
          const [ax, ay] = m.anchor
          const ideal = this.zoomedAround(m.from, m.to.k / m.from.k, ax, ay)
          const at = this.zoomedAround(m.from, k / m.from.k, ax, ay)
          next = { k, tx: at.tx + (m.to.tx - ideal.tx) * e, ty: at.ty + (m.to.ty - ideal.ty) * e }
        } else {
          next = { k, tx: m.from.tx + (m.to.tx - m.from.tx) * e, ty: m.from.ty + (m.to.ty - m.from.ty) * e }
        }
        this.commit(next)
        if (p >= 1) {
          this.motion = null
          this.commit(m.to)
          return
        }
      } else if (m.type === 'wheel') {
        // Exponential approach to the accumulated wheel target: smooth, and
        // responsive to fast successive notches.
        const zoom = this.zoom
        const step = (m.targetZoom - zoom) * (1 - Math.exp(-dt / this.options.wheelSmoothing))
        const done = Math.abs(m.targetZoom - zoom) < 0.002
        const nextZoom = done ? m.targetZoom : zoom + step
        this.commit(this.zoomedAround(this.state, 2 ** nextZoom / this.state.k, m.anchor[0], m.anchor[1]))
        if (done) {
          this.motion = null
          return
        }
      } else if (m.type === 'inertia') {
        const before = this.state
        const after = this.commit({ ...before, tx: before.tx + m.vx * dt, ty: before.ty + m.vy * dt })
        const decay = Math.exp(-dt / INERTIA_DECAY_MS)
        m.vx = after.tx === before.tx ? 0 : m.vx * decay
        m.vy = after.ty === before.ty ? 0 : m.vy * decay
        if (Math.hypot(m.vx, m.vy) < 0.01) {
          this.motion = null
          return
        }
      }
      this.schedule()
    }

    /* -------------------------------------------------------------- input -- */
    on(target, type, handler, options) {
      target.addEventListener(type, handler, options)
      this.cleanup.push(() => target.removeEventListener(type, handler, options))
    }

    local(event) {
      const r = this.surfaceRect || this.surface.getBoundingClientRect()
      return [event.clientX - r.left, event.clientY - r.top]
    }

    bind() {
      const s = this.surface
      this.on(s, 'wheel', e => this.onWheel(e), { passive: false })
      this.on(s, 'pointerdown', e => this.onPointerDown(e))
      this.on(s, 'pointermove', e => this.onPointerMove(e))
      this.on(s, 'pointerup', e => this.onPointerUp(e))
      this.on(s, 'pointercancel', e => this.onPointerUp(e, true))
      this.on(s, 'dblclick', e => this.onDoubleClick(e))
      // Wheel intent tracking: when the pointer entered the wheel zone, and
      // when the page last scrolled.
      this.zoneEnteredAt = null
      this.lastPageScroll = -Infinity
      // `hoverClass` marks the surface while a mouse is over draggable map
      // area (e.g. to show a grab cursor only where dragging pans the map).
      this.on(s, 'pointermove', e => {
        if (e.pointerType !== 'mouse') return
        const inZone = this.options.wheelZone(e.clientX, e.clientY)
        if (!inZone) this.zoneEnteredAt = null
        else if (this.zoneEnteredAt == null) this.zoneEnteredAt = performance.now()
        this.setHover(inZone && this.options.canStartPan(e.target))
      })
      this.on(s, 'pointerleave', () => {
        this.zoneEnteredAt = null
        this.setHover(false)
      })
      this.on(window, 'scroll', () => {
        this.lastPageScroll = performance.now()
      }, { passive: true })
      this.on(this.options.keyboardTarget, 'keydown', e => this.onKey(e))

      const resize = new ResizeObserver(entries => {
        const box = entries[0].contentRect
        this.size = { w: box.width || 1, h: box.height || 1 }
        this.commit(this.state)
      })
      resize.observe(s)
      this.cleanup.push(() => resize.disconnect())
    }

    setHover(on) {
      if (!this.options.hoverClass || on === this.hovering) return
      this.hovering = on
      this.surface.classList.toggle(this.options.hoverClass, on)
    }

    onWheel(e) {
      if (!this.enabled) return
      const modifier = e.ctrlKey || e.metaKey
      if (this.options.wheelNeedsModifier && !modifier) {
        if (this.engaged) this.dispatchEvent(new CustomEvent('hint', { detail: { type: 'wheel' } }))
        return // let the page scroll
      }
      // Plain wheel zooms only with clear intent; otherwise the page scrolls:
      // not over links/text, inside the map zone, after the pointer has rested
      // there briefly, and not while a page scroll is still in progress.
      if (!modifier) {
        if (!this.options.canStartPan(e.target)) return
        if (!this.options.wheelZone(e.clientX, e.clientY)) return
        const now = performance.now()
        if (this.zoneEnteredAt == null || now - this.zoneEnteredAt < this.options.wheelHoverDelay) return
        if (now - this.lastPageScroll < this.options.wheelScrollGuard) return
      }
      const dy = e.deltaY * (e.deltaMode === 1 ? LINE_HEIGHT : e.deltaMode === 2 ? this.size.h : 1)
      if (!dy) return
      const zoomingIn = dy < 0
      if (zoomingIn ? !this.canZoomIn : !this.canZoomOut) {
        // At the zoom limit: hand the wheel back to the page (but never let
        // Ctrl/⌘ + wheel fall through to browser zoom).
        if (modifier) e.preventDefault()
        return
      }
      e.preventDefault()
      this.engaged = true
      this.surfaceRect = null
      const anchor = this.local(e)

      // How far this event zooms, in levels:
      // - with `wheelStep`: one mouse notch = `wheelStep` (fast flicks that pack
      //   several notches into one event count each one), and trackpad scrolling
      //   is proportional, 100 px = one notch;
      // - trackpad pinch (ctrl + small deltas) is proportional and more direct;
      // - without `wheelStep`: a notch is half a level.
      const step = this.options.wheelStep
      const notch = Math.abs(dy) >= WHEEL_NOTCH
      const pinch = e.ctrlKey && !notch
      let levels
      if (step && !pinch) levels = notch ? -Math.sign(dy) * step * Math.max(1, Math.round(Math.abs(dy) / 100)) : -dy * (step / 100)
      else levels = -dy * (notch ? 1 / 200 : 1 / 90)
      levels = clamp(levels, -1, 1)

      // Notches accumulate into one target that the camera glides towards (see
      // tick), so fast scrolling stays fluid instead of restarting animations.
      const base = this.targetZoom
      const targetZoom = clamp(base + levels, this.options.minZoom, this.options.maxZoom)
      if (this.options.reducedMotion()) {
        this.stop()
        this.commit(this.zoomedAround(this.state, 2 ** targetZoom / this.state.k, anchor[0], anchor[1]))
        return
      }
      this.motion = { type: 'wheel', targetZoom, anchor }
      this.schedule()
    }

    onPointerDown(e) {
      if (!this.enabled) return
      this.lastPointerType = e.pointerType
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const first = this.pointers.size === 0
      if (first && !this.options.canStartPan(e.target)) return
      if (this.pointers.size >= 2) return

      if (e.pointerType === 'mouse') {
        e.preventDefault() // no text selection while dragging the map
        // Click-focus enables the keyboard shortcuts without a keyboard focus ring.
        this.options.keyboardTarget.focus?.({ preventScroll: true, focusVisible: false })
      }
      this.surfaceRect = this.surface.getBoundingClientRect()
      try {
        this.surface.setPointerCapture(e.pointerId)
      } catch {
        // Capture can fail for synthetic pointers; dragging still works.
      }
      this.stop()

      const [x, y] = this.local(e)
      this.pointers.set(e.pointerId, { x, y, type: e.pointerType })
      if (first) {
        this.gesture = { mode: 'pan', startX: x, startY: y, moved: false, samples: [[performance.now(), x, y]] }
      } else {
        this.startPinch()
      }
    }

    startPinch() {
      const [a, b] = [...this.pointers.values()]
      this.gesture = { mode: 'pinch', moved: true, dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 }
      this.engaged = true
      this.surface.classList.add(this.options.draggingClass)
    }

    onPointerMove(e) {
      const p = this.pointers.get(e.pointerId)
      if (!p || !this.gesture) return
      const [x, y] = this.local(e)
      const dx = x - p.x
      const dy = y - p.y
      p.x = x
      p.y = y
      const g = this.gesture

      if (g.mode === 'pan') {
        if (!g.moved) {
          const mx = x - g.startX
          const my = y - g.startY
          if (p.type === 'mouse') {
            if (Math.hypot(mx, my) < DRAG_THRESHOLD) return
          } else {
            // Touch: vertical swipes belong to the page (touch-action: pan-y).
            if (Math.hypot(mx, my) < TOUCH_SLOP) return
            if (Math.abs(my) > Math.abs(mx)) {
              g.mode = 'page'
              return
            }
          }
        }
        if (!g.moved) {
          g.moved = true
          this.engaged = true
          this.surface.classList.add(this.options.draggingClass)
        }
        this.commit({ ...this.state, tx: this.state.tx + dx, ty: this.state.ty + dy })
        g.samples.push([performance.now(), x, y])
        if (g.samples.length > 6) g.samples.shift()
      } else if (g.mode === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()]
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        // Pan with the midpoint, then zoom around it.
        const panned = { ...this.state, tx: this.state.tx + (midX - g.midX), ty: this.state.ty + (midY - g.midY) }
        this.commit(this.zoomedAround(panned, dist / g.dist, midX, midY))
        Object.assign(g, { dist, midX, midY })
      }
    }

    onPointerUp(e, cancelled = false) {
      const p = this.pointers.get(e.pointerId)
      if (!p) return
      this.pointers.delete(e.pointerId)
      try {
        this.surface.releasePointerCapture(e.pointerId)
      } catch {
        // Already released.
      }
      const g = this.gesture

      if (this.pointers.size === 1) {
        // Pinch → pan with the remaining finger, without a jump.
        const [rest] = [...this.pointers.values()]
        this.gesture = { mode: 'pan', startX: rest.x, startY: rest.y, moved: true, samples: [[performance.now(), rest.x, rest.y]] }
        return
      }
      if (this.pointers.size > 0) return
      this.gesture = null
      this.surfaceRect = null
      this.surface.classList.remove(this.options.draggingClass)
      if (!g || cancelled) return

      if (g.mode === 'pan' && g.moved) {
        this.startInertia(g.samples)
      } else if (g.mode === 'pan' && p.type !== 'mouse') {
        // Double-tap to zoom in (mouse uses the native dblclick event).
        const now = performance.now()
        const tap = this.lastTap
        if (tap && now - tap.t < DOUBLE_TAP_MS && Math.hypot(p.x - tap.x, p.y - tap.y) < 30) {
          this.lastTap = null
          this.zoomBy(this.options.gestureZoomStep, [p.x, p.y])
        } else {
          this.lastTap = { t: now, x: p.x, y: p.y }
        }
      }
    }

    startInertia(samples) {
      if (this.options.reducedMotion() || samples.length < 2) return
      const now = performance.now()
      const recent = samples.filter(([t]) => now - t < 100)
      if (recent.length < 2) return
      const [t0, x0, y0] = recent[0]
      const [t1, x1, y1] = recent[recent.length - 1]
      const dt = Math.max(1, t1 - t0)
      const vx = (x1 - x0) / dt
      const vy = (y1 - y0) / dt
      if (Math.hypot(vx, vy) < 0.15) return
      this.motion = { type: 'inertia', vx: clamp(vx, -3, 3), vy: clamp(vy, -3, 3) }
      this.schedule()
    }

    onDoubleClick(e) {
      if (!this.enabled) return
      // Touch double-taps are handled in onPointerUp; browsers also fire dblclick.
      if (this.lastPointerType && this.lastPointerType !== 'mouse') return
      if (!this.options.canStartPan(e.target)) return
      e.preventDefault()
      this.surfaceRect = null
      this.zoomBy(e.shiftKey ? -this.options.gestureZoomStep : this.options.gestureZoomStep, this.local(e))
    }

    onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const step = this.options.panStep * (e.shiftKey ? 3 : 1)
      const actions = {
        '+': () => this.zoomBy(this.options.zoomStep),
        '=': () => this.zoomBy(this.options.zoomStep),
        '-': () => this.zoomBy(-this.options.zoomStep),
        _: () => this.zoomBy(-this.options.zoomStep),
        ArrowLeft: () => this.panBy(step, 0),
        ArrowRight: () => this.panBy(-step, 0),
        ArrowUp: () => this.panBy(0, step),
        ArrowDown: () => this.panBy(0, -step),
        0: () => this.reset(),
        Home: () => this.reset(),
      }
      const action = actions[e.key]
      if (!action) return
      e.preventDefault()
      action()
    }
  }

  MapViewport.isPannableTarget = isPannableTarget
  window.KMMapViewport = MapViewport
})()
