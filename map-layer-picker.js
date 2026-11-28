/*
 * MapLayerPicker: Google Maps-style map style picker (bottom-left).
 *
 *   [ tile ]  ← quick toggle: shows the style you'd switch to (primary ⇄ last alternate)
 *   hover / focus / tap reveals a panel: one option per style (rendered preview +
 *   label, selected = accent border + label), an optional view toggle (3D) styled
 *   like the styles (pressed = accent border + label; while on, no style is pressed
 *   and choosing a style or the tile turns it off), then
 *     "Adjust" → "Display" popover: continuous sliders (live, smooth) + Reset
 *     "More"   → "Map details" popover: overlay toggles.
 *
 * KMMapLayerPicker.mount(host, {
 *   styles: [{ id, label, description }], value, primary: 'radar', alternate: 'terrain',
 *   onChange(id),
 *   details: [{ id, label, icon, pressed }], onDetailChange(id, on),
 *   adjustments: [{ id, label, hint, min, max, step, value, unit }], onAdjust(id, value),
 *   onResetAdjustments() → adjustments,
 *   toggle: { label, offLabel, description, pressed, onChange(on) },  // optional (the 3D view)
 * }) → { setPreviews({ id: url }), setValue(id), setToggle(on), destroy() }
 */
(() => {
  'use strict'

  let uid = 0
  const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`
  const ICONS = {
    layers: svg('<path d="M12 3 2.5 8.5 12 14l9.5-5.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m2.5 12.5 9.5 5.5 9.5-5.5M2.5 16.5 12 22l9.5-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
    adjust: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  }
  // View toggle artwork (theme-independent, like the map detail icons): a
  // perspective ground grid with an aircraft, its drop line and shadow.
  const VIEW_3D_ART = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect width="48" height="48" fill="#0b2a3d"/>'
    + '<g fill="none" stroke="#47c9d5" stroke-width=".9" opacity=".6"><path d="M1 47 17 27h14l16 20"/><path d="M24 27v20M12 47l7-20M36 47l-7-20M13 32h22M8 38h32M4 43h40"/></g>'
    + '<path d="M28 16v16" stroke="#8de8d2" stroke-width="1" stroke-dasharray="1.6 1.6"/><ellipse cx="28" cy="33" rx="3" ry="1.1" fill="#43efbd" opacity=".55"/>'
    + '<path d="M28 7l6.5 8-6.5-2.4-6.5 2.4Z" fill="#43efbd"/></svg>'

  function el(tag, className, attrs = {}) {
    const node = document.createElement(tag)
    if (className) node.className = className
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    return node
  }

  const formatValue = (a, v) => (a.unit === '%' ? `${Math.round(v)}%` : `${Number(v).toFixed(2).replace(/0$/, '')}${a.unit || ''}`)

  function mount(host, options) {
    const {
      styles, onChange = () => {}, primary = styles[0].id,
      details = [], onDetailChange = () => {},
      adjustments = [], onAdjust = () => {}, onResetAdjustments = null,
      toggle = null,
    } = options
    let value = options.value ?? primary
    let toggled = Boolean(toggle?.pressed)
    let toggleButton = null
    let alternate = options.alternate ?? styles.find(s => s.id !== primary)?.id
    let previews = {}
    const id = `asd-layers-${++uid}`
    const coarse = window.matchMedia('(pointer: coarse)')
    const cleanup = []
    const on = (target, type, handler, opts) => {
      target.addEventListener(type, handler, opts)
      cleanup.push(() => target.removeEventListener(type, handler, opts))
    }
    const labelOf = styleId => styles.find(s => s.id === styleId)?.label ?? styleId

    const root = el('div', 'asd-layers', { 'data-map-ignore': '' })

    // Quick-toggle tile
    const tile = el('button', 'asd-layers-tile', { type: 'button', 'aria-expanded': 'false', 'aria-controls': `${id}-panel` })
    const tileImg = el('img', 'asd-layers-img', { alt: '', draggable: 'false' })
    const tileLabel = el('span', 'asd-layers-tile-label')
    tile.append(tileImg, tileLabel)

    // Style panel
    const panel = el('div', 'asd-layers-panel', { id: `${id}-panel`, role: 'group', 'aria-label': 'Map style' })
    panel.inert = true
    const optionButtons = new Map()
    for (const s of styles) {
      const b = el('button', 'asd-layers-option', { type: 'button', 'aria-pressed': 'false', title: s.description || s.label })
      const thumb = el('span', 'asd-layers-thumb')
      thumb.append(el('img', 'asd-layers-img', { alt: '', draggable: 'false' }))
      const name = el('span', 'asd-layers-name')
      name.textContent = s.label
      b.append(thumb, name)
      b.setAttribute('aria-label', `${s.label} map style${s.description ? `: ${s.description}` : ''}`)
      on(b, 'click', () => select(s.id))
      optionButtons.set(s.id, b)
      panel.append(b)
    }

    // Popovers ("Adjust" → Display sliders, "More" → Map details).
    const popovers = new Map() // name → { trigger, sheet, first() }
    const iconOption = (cls, label, aria, icon, sheetId) => {
      const b = el('button', `asd-layers-option ${cls}`, { type: 'button', 'aria-expanded': 'false', 'aria-controls': sheetId, 'aria-label': aria })
      const thumb = el('span', 'asd-layers-thumb asd-layers-thumb--icon')
      thumb.innerHTML = icon
      const name = el('span', 'asd-layers-name')
      name.textContent = label
      b.append(thumb, name)
      return b
    }
    const sheetShell = (name, cls, title, closeLabel) => {
      const sheet = el('div', `asd-layers-popover ${cls}`, { id: `${id}-${name}`, role: 'dialog', 'aria-label': title })
      sheet.hidden = true
      const head = el('div', 'asd-layers-details-head')
      const h = el('h2', 'asd-layers-details-title')
      h.textContent = title
      const close = el('button', 'asd-layers-close', { type: 'button', 'aria-label': closeLabel })
      close.innerHTML = ICONS.close
      head.append(h, close)
      sheet.append(head)
      on(close, 'click', () => {
        setPopover(null)
        popovers.get(name)?.trigger.focus()
      })
      return sheet
    }

    // View toggle (3D), right after the styles and styled like them.
    if (toggle) {
      toggleButton = el('button', 'asd-layers-option asd-layers-toggle', {
        type: 'button', 'aria-pressed': 'false', title: toggle.description || toggle.label,
        'aria-label': `${toggle.label} view${toggle.description ? `: ${toggle.description}` : ''}`,
      })
      const thumb = el('span', 'asd-layers-thumb asd-layers-thumb--art')
      thumb.innerHTML = VIEW_3D_ART
      const name = el('span', 'asd-layers-name')
      name.textContent = toggle.label
      toggleButton.append(thumb, name)
      on(toggleButton, 'click', () => setToggled(!toggled, true))
      panel.append(toggleButton)
    }

    if (adjustments.length || details.length) panel.append(el('span', 'asd-layers-divider', { 'aria-hidden': 'true' }))

    if (adjustments.length) {
      const trigger = iconOption('asd-layers-adjust', 'Adjust', 'Adjust display', ICONS.adjust, `${id}-adjust`)
      const sheet = sheetShell('adjust', 'asd-layers-display', 'Display', 'Close display adjustments')
      const list = el('div', 'asd-adjust-list')
      const inputs = new Map()
      const paint = (a, input, out) => {
        const v = Number(input.value)
        out.textContent = formatValue(a, v)
        input.setAttribute('aria-valuetext', formatValue(a, v))
        input.style.setProperty('--fill', `${((v - a.min) / (a.max - a.min)) * 100}%`)
      }
      for (const a of adjustments) {
        const row = el('div', 'asd-adjust-row')
        const head = el('div', 'asd-adjust-head')
        const label = el('label', 'asd-adjust-label', { for: `${id}-adj-${a.id}` })
        label.textContent = a.label
        const out = el('span', 'asd-adjust-value', { 'aria-hidden': 'true' })
        head.append(label, out)
        const input = el('input', 'asd-adjust-range', {
          type: 'range', id: `${id}-adj-${a.id}`, min: String(a.min), max: String(a.max), step: String(a.step), 'aria-describedby': `${id}-adj-${a.id}-hint`,
        })
        input.value = String(a.value)
        const hint = el('p', 'asd-adjust-hint', { id: `${id}-adj-${a.id}-hint` })
        hint.textContent = a.hint || ''
        on(input, 'input', () => {
          paint(a, input, out)
          onAdjust(a.id, Number(input.value))
        })
        paint(a, input, out)
        inputs.set(a.id, { a, input, out })
        row.append(head, input, hint)
        list.append(row)
      }
      const foot = el('div', 'asd-adjust-foot')
      const reset = el('button', 'asd-adjust-reset', { type: 'button' })
      reset.textContent = 'Reset'
      on(reset, 'click', () => {
        const next = onResetAdjustments ? onResetAdjustments() : adjustments
        for (const n of next) {
          const entry = inputs.get(n.id)
          if (!entry) continue
          entry.input.value = String(n.value)
          paint(entry.a, entry.input, entry.out)
        }
      })
      foot.append(reset)
      sheet.append(list, foot)
      panel.append(trigger)
      popovers.set('adjust', { trigger, sheet, first: () => sheet.querySelector('.asd-adjust-range') })
      on(trigger, 'click', () => setPopover(sheet.hidden ? 'adjust' : null))
    }

    if (details.length) {
      const trigger = iconOption('asd-layers-more', 'More', 'More map details', ICONS.layers, `${id}-details`)
      const sheet = sheetShell('details', 'asd-layers-details', 'Map details', 'Close map details')
      const grid = el('div', 'asd-layers-details-grid')
      for (const d of details) {
        const b = el('button', 'asd-layers-detail', { type: 'button', 'aria-pressed': String(d.pressed !== false) })
        const icon = el('span', 'asd-layers-thumb asd-layers-thumb--detail')
        icon.innerHTML = d.icon
        const name = el('span', 'asd-layers-name')
        name.textContent = d.label
        b.append(icon, name)
        on(b, 'click', () => {
          const pressed = b.getAttribute('aria-pressed') !== 'true'
          b.setAttribute('aria-pressed', String(pressed))
          onDetailChange(d.id, pressed)
        })
        grid.append(b)
      }
      sheet.append(grid)
      panel.append(trigger)
      popovers.set('details', { trigger, sheet, first: () => sheet.querySelector('.asd-layers-detail') })
      on(trigger, 'click', () => setPopover(sheet.hidden ? 'details' : null))
    }

    root.append(tile, panel)
    for (const { sheet } of popovers.values()) root.append(sheet)
    host.append(root)

    /* --------------------------------------------------------- state ------ */
    function render() {
      // While the toggle (3D) is on, the tile offers the way back: the 2D style in use.
      const target = toggled ? value : value === primary ? alternate : primary
      tileLabel.textContent = toggled && toggle.offLabel ? toggle.offLabel : labelOf(target)
      const current = toggled ? toggle.label : labelOf(value)
      tile.setAttribute('aria-label', coarse.matches ? `Map styles (current: ${current})` : toggled ? `Back to the 2D map (${labelOf(target)})` : `Switch map style to ${labelOf(target)}`)
      tile.dataset.target = target
      setImg(tileImg, previews[target])
      for (const [styleId, b] of optionButtons) {
        b.setAttribute('aria-pressed', String(!toggled && styleId === value))
        setImg(b.querySelector('img'), previews[styleId])
      }
      toggleButton?.setAttribute('aria-pressed', String(toggled))
    }

    /** Turns the view toggle on or off; `notify` reports it (user actions). */
    function setToggled(next, notify) {
      if (!toggle || toggled === Boolean(next)) return
      toggled = Boolean(next)
      render()
      if (notify) toggle.onChange?.(toggled)
    }

    function setImg(img, src) {
      if (src && img.getAttribute('src') !== src) img.src = src
      img.classList.toggle('is-empty', !src)
    }

    function select(styleId) {
      // A style (or the tile) also leaves the toggled view (3D): the style first,
      // so the 2D map comes back already showing it.
      if (styleId !== value) {
        value = styleId
        if (styleId !== primary) alternate = styleId
        onChange(styleId)
      }
      if (toggled) setToggled(false, true)
      render()
    }

    let open = false
    let closeTimer = 0
    let activePopover = null
    function setOpen(next) {
      window.clearTimeout(closeTimer)
      if (open === next) return
      open = next
      root.classList.toggle('is-open', open)
      panel.inert = !open
      tile.setAttribute('aria-expanded', String(open))
      if (!open) setPopover(null)
    }

    function setPopover(name) {
      if (activePopover === name) return
      activePopover = name
      for (const [key, p] of popovers) {
        const show = key === name
        p.sheet.hidden = !show
        p.trigger.setAttribute('aria-expanded', String(show))
      }
      root.classList.toggle('has-popover', Boolean(name))
      if (name) {
        setOpen(true)
        popovers.get(name)?.first()?.focus()
      }
    }

    /* ---------------------------------------------------- interaction ----- */
    on(tile, 'click', () => {
      // Touch has no hover: the tile opens the panel. With a mouse it is the
      // Google-style quick toggle and the panel opens on hover.
      if (coarse.matches) setOpen(!open)
      else select(tile.dataset.target)
    })
    on(root, 'pointerenter', e => {
      if (e.pointerType === 'mouse') setOpen(true)
    })
    on(root, 'pointerleave', e => {
      if (e.pointerType !== 'mouse' || activePopover) return
      closeTimer = window.setTimeout(() => {
        if (!root.contains(document.activeElement)) setOpen(false)
      }, 320)
    })
    let escaping = false // focus returned by Escape must not reopen the panel
    on(root, 'focusin', () => {
      if (escaping) escaping = false
      else setOpen(true)
    })
    on(root, 'focusout', e => {
      if (!root.contains(e.relatedTarget)) closeTimer = window.setTimeout(() => setOpen(false), 120)
    })
    on(root, 'keydown', e => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (activePopover) {
        const trigger = popovers.get(activePopover).trigger
        setPopover(null)
        trigger.focus()
      } else {
        setOpen(false)
        if (document.activeElement !== tile) {
          escaping = true
          tile.focus()
        }
      }
    })
    on(document, 'pointerdown', e => {
      if (open && !root.contains(e.target)) setOpen(false)
    })

    render()
    return {
      element: root,
      setPreviews(next) {
        previews = { ...next }
        render()
      },
      setValue(styleId) {
        value = styleId
        if (styleId !== primary) alternate = styleId
        render()
      },
      /** Shows the view toggle (3D) on or off without reporting it. */
      setToggle(on) {
        setToggled(on, false)
      },
      destroy() {
        for (const off of cleanup) off()
        root.remove()
      },
    }
  }

  window.KMMapLayerPicker = { mount }
})()
