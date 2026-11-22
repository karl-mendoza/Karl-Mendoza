/*
 * Air Situation Display (ASD) background for the portfolio hero.
 *
 * A decorative, canvas-rendered radar picture: map layer (range rings, airways,
 * fixes, sectors, TMA, restricted area, coastline, airport + ILS centreline)
 * plus a live traffic simulation (overflights, arrivals with holding and ILS
 * approach, departures, VFR primary contacts) with history trails, speed
 * vectors, data blocks, sector hand-in / hand-off, STCA conflict alerts and a
 * radar sweep synced to the hero radar.
 *
 * All data is illustrative (fictional fixes, airport and callsigns).
 *
 * Display styles (ATM/ATC backgrounds), cross-faded when switched:
 *   radar (standard scope) · sectors (airspace volumes, frequencies, limits) ·
 *   terrain (relief, contours, spot heights, MSA) · technology (the terrain
 *   picture, background colours and effects; blue / violet line work) · geo (land/sea, rivers,
 *   towns, roads) · declutter (map faded so traffic stands out).
 * Overlays ("map details"): airways & fixes, airspace, range rings, weather,
 * track labels. Geography comes from public/asd-world.js (generated in time
 * slices; world-dependent layers fade in when ready).
 *
 * Exposes window.KMAsdScope.mount(heroElement) → { layer, canvas, styles,
 * style, setStyle(id), details, setLayer(id, on), onPreviews(fn), stats(),
 * setTechnologies(list), attachViewport(KMMapViewport) }. Technology strips
 * set to ACTIVE (Technology Bays) fly as traffic on the Technology style. With a viewport attached the picture
 * pans/zooms with its camera; screen-space aids (legibility mask, data
 * blocks, symbols) keep a constant size like a real ASD.
 */
(() => {
  'use strict'

  const TAU = Math.PI * 2
  const DEG = Math.PI / 180
  const TIME_SCALE = 6 // simulated seconds per real second
  const TURN_RATE = 3 * DEG // standard-rate turn, rad per simulated second
  const HISTORY_INTERVAL = 10 // simulated seconds between history dots
  const HISTORY_DOTS = 6
  const VECTOR_SECONDS = 60 // speed vector length (1 minute)
  const FONT = '"Roboto Mono", ui-monospace, Menlo, Consolas, monospace'

  /* ---------------------------------------------------------------- world -- */
  // Nautical miles; +x east, +y north; origin = radar head (hero radar centre).
  const FIXES = {
    ORVIK: [-128, 30], TALSO: [-92, 38], BEXAR: [-66, 14], NEMOS: [-100, -26],
    KILNA: [-48, -40], DAVOR: [-24, 30], SOLIN: [-14, -12], HALEX: [6, 40],
    RADEX: [18, 6], PIRAN: [48, 30], ZOLTA: [76, 10], MEROS: [66, -36],
    VENKA: [16, -52], LOKAR: [58, -26],
  }
  const POINTS = {
    ...FIXES,
    // Off-display anchors where airways leave the picture.
    W1: [-240, 30], W2: [-240, -30], W3: [-240, 52], N1: [-60, 150], N2: [24, 150],
    E1: [200, 16], E2: [190, -80], S1: [-60, -150], S2: [50, -150],
    // Airport KMND, runway 09/27. Arrivals land 27 (westbound) from the east.
    FI27: [47, -20], THR27: [35.2, -20], DER27: [32.8, -20], D1: [24, -20],
  }
  const VOR = { id: 'KMN', freq: '113.25', at: [2, -3] }
  const AIRPORT = { id: 'KMND', west: [32.8, -20], east: [35.2, -20] }

  const AIRWAYS = [
    { id: 'UL612', via: ['W1', 'ORVIK', 'BEXAR', 'SOLIN', 'VENKA', 'S2'] },
    { id: 'UN864', via: ['N1', 'DAVOR', 'SOLIN', 'KILNA', 'S1'] },
    { id: 'UQ41', via: ['W3', 'TALSO', 'HALEX', 'PIRAN', 'E1'] },
    { id: 'UZ7', via: ['N2', 'HALEX', 'RADEX', 'MEROS', 'E2'] },
    { id: 'T420', via: ['W2', 'NEMOS', 'BEXAR', 'DAVOR', 'N1'] },
    { id: 'UM60', via: ['S1', 'KILNA', 'RADEX', 'ZOLTA', 'E1'] },
  ]
  const ARRIVALS = [
    ['N2', 'HALEX', 'PIRAN', 'LOKAR', 'FI27', 'THR27'],
    ['S2', 'VENKA', 'MEROS', 'LOKAR', 'FI27', 'THR27'],
    ['E1', 'ZOLTA', 'LOKAR', 'FI27', 'THR27'],
    ['W3', 'TALSO', { hold: 'DAVOR', laps: 2 }, 'RADEX', 'LOKAR', 'FI27', 'THR27'],
  ]
  const DEPARTURES = [
    ['DER27', 'D1', 'SOLIN', 'BEXAR', 'ORVIK', 'W1'],
    ['DER27', 'D1', 'VENKA', 'S2'],
    ['DER27', 'D1', 'RADEX', 'HALEX', 'N2'],
  ]
  const OVERFLIGHTS = AIRWAYS.flatMap(a => [a.via, [...a.via].reverse()])

  const SECTOR_LINES = [
    [[-34, 160], [-10, -6], [-62, -160]],
  ]
  const SECTOR_LABELS = [
    { text: 'S12 · FL245–660', at: [-118, -40] },
    { text: 'S14 · FL245–660', at: [64, 44] },
  ]
  const TMA = { label: 'KMND TMA · SFC–FL105', at: [14, -58], poly: [[14, -4], [66, -4], [84, -26], [68, -56], [20, -56], [6, -30]] }
  const RESTRICTED = { label: 'R-104 · SFC–FL195 · ACT', poly: [[-78, -16], [-58, -10], [-48, -26], [-58, -38], [-80, -32]] }
  // Coastline (sea to the south); the generated world adds bays and headlands.
  const COAST = [
    [-260, -12], [-214, -6], [-188, -14], [-160, -2], [-138, -10], [-118, -4], [-102, -16],
    [-86, -12], [-70, -24], [-52, -20], [-36, -32], [-18, -28], [-2, -40], [22, -36], [40, -46],
    [62, -42], [86, -56], [120, -50], [160, -62], [240, -58],
  ]
  const HANDOFF_UNITS = ['S09', 'S11', 'S16', 'S18', 'APP', 'TWR']
  const AIRLINES = ['BAW', 'DLH', 'AFR', 'KLM', 'EZY', 'RYR', 'UAE', 'SAS', 'IBE', 'AZA', 'THY', 'SWR', 'VLG', 'TAP', 'QTR', 'FIN', 'AUA', 'BEL']
  const TYPES = ['A320', 'A321', 'B738', 'A319', 'B77W', 'A359', 'B789', 'E190', 'A333', 'B38M', 'A20N', 'CRJ9']

  // Sector volumes for the Sectors style (NM polygons covering the world).
  const SECTORS = [
    { id: 'S11', freq: '134.125', limits: 'FL245–660', at: [-100, 30], poly: [[-300, 200], [-39.8, 200], [-12.6, 12], [-300, 12]] },
    { id: 'S12', freq: '132.455', limits: 'FL245–660', at: [-118, -40], poly: [[-300, 12], [-12.6, 12], [-10, -6], [-75.5, -200], [-300, -200]] },
    { id: 'S14', freq: '128.700', limits: 'FL245–660', at: [64, 44], poly: [[-39.8, 200], [260, 200], [260, 4], [-11.4, 4]] },
    { id: 'S18', freq: '127.355', limits: 'FL245–660', at: [2, -40], poly: [[-11.4, 4], [110, 4], [110, -200], [-75.5, -200], [-10, -6]] },
    { id: 'S16', freq: '135.050', limits: 'FL245–660', at: [128, -30], poly: [[110, 4], [260, 4], [260, -200], [110, -200]] },
  ]
  const CTR = { center: [34, -20], radius: 8, label: 'KMND CTR · TWR 118.300 · SFC–2500' }

  // Display styles (single choice) and overlays (independent toggles).
  const STYLES = [
    { id: 'radar', label: 'Radar', description: 'Standard radar scope' },
    { id: 'sectors', label: 'Sectors', description: 'Sector volumes, frequencies and limits' },
    { id: 'terrain', label: 'Terrain', description: 'Relief, contours, spot heights and MSA' },
    { id: 'technology', label: 'Technology', description: 'Terrain relief, contours and MSA in a technology palette' },
    { id: 'geo', label: 'Geographic', description: 'Coastline, rivers, towns and roads' },
    { id: 'declutter', label: 'Declutter', description: 'Map faded so traffic stands out' },
  ]
  const STYLE_IDS = new Set(STYLES.map(s => s.id))

  // Overlay icons (28×20 miniatures, theme-independent artwork).
  const icon = body => `<svg viewBox="0 0 28 20" aria-hidden="true" focusable="false"><rect width="28" height="20" fill="#0b2a3d"/>${body}</svg>`
  const DETAILS = [
    { id: 'airways', label: 'Airways & fixes', icon: icon('<path d="M-1 16 12 9l17-6" fill="none" stroke="#47c9d5" stroke-width="1.2"/><path d="M12 5.5 15 10.5h-6Z" fill="none" stroke="#8de8d2" stroke-width="1.1"/>') },
    { id: 'airspace', label: 'Airspace', icon: icon('<path d="M-2 15 9 8l8 3 13-8" fill="none" stroke="#e8b23a" stroke-width="1.2" stroke-dasharray="2.5 2"/><path d="M5 13l6-5 6 6-4 4H6Z" fill="rgba(255,102,117,.25)" stroke="#ff6675" stroke-width="1"/>') },
    { id: 'rings', label: 'Range rings', icon: icon('<g fill="none" stroke="#57bdd0" stroke-width="1"><circle cx="14" cy="10" r="3.5"/><circle cx="14" cy="10" r="7" stroke-dasharray="1.5 2"/><circle cx="14" cy="10" r="10.5" opacity=".6"/></g>') },
    { id: 'weather', label: 'Weather', icon: icon('<circle cx="10" cy="11" r="7" fill="#4b8fc8" opacity=".55"/><circle cx="17" cy="8" r="6" fill="#4b8fc8" opacity=".45"/><circle cx="13" cy="10" r="3.2" fill="#e8b23a" opacity=".85"/>') },
    { id: 'labels', label: 'Track labels', icon: icon('<rect x="5" y="11" width="4" height="4" fill="none" stroke="#43efbd" stroke-width="1.2"/><path d="M9 11l4-4" stroke="#43efbd" stroke-width="1"/><path d="M14 5h9M14 8h6M14 11h7" stroke="#dceaf3" stroke-width="1.6"/>') },
  ]
  const HERO_BG = { dark: '#061b2c', light: '#eaf1f4' }

  // Display adjustments (continuous sliders). Maxima are the audited defaults,
  // so adjusting can only make the background calmer, never less legible.
  const ADJUSTMENTS = [
    { id: 'background', label: 'Background', hint: 'Terrain, land & sea, sector fills and weather', min: 0, max: 100, step: 1, value: 100, unit: '%' },
    { id: 'map', label: 'Map detail', hint: 'Rings, airways, coastline, labels and sweep', min: 0, max: 100, step: 1, value: 100, unit: '%' },
    { id: 'grid', label: 'Grid', hint: 'Backdrop grid and scan lines', min: 0, max: 100, step: 1, value: 100, unit: '%' },
    { id: 'traffic', label: 'Traffic', hint: 'Track symbols and data blocks', min: 25, max: 100, step: 1, value: 100, unit: '%' },
    { id: 'speed', label: 'Traffic speed', hint: 'Simulation rate', min: 0.25, max: 3, step: 0.05, value: 1, unit: '×' },
  ]
  const ADJUST_KEY = 'karl.asd.display'
  const ADJUST_SMOOTHING = 0.12 // s, time constant of the eased transition to new values

  /* -------------------------------------------------------------- helpers -- */
  const rand = (a, b) => a + Math.random() * (b - a)
  const pick = list => list[Math.floor(Math.random() * list.length)]
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a))
  const bearing = (ax, ay, bx, by) => Math.atan2(bx - ax, by - ay) // 0 = north, clockwise
  const fl = ft => String(Math.max(0, Math.round(ft / 100))).padStart(3, '0')

  function resolveRoute(spec) {
    const pts = []
    const names = []
    for (const item of spec) {
      if (typeof item === 'string') {
        pts.push(POINTS[item])
        names.push(item)
        continue
      }
      // Racetrack holding: right-hand pattern, 1-minute-ish legs.
      const fix = POINTS[item.hold]
      const prev = pts[pts.length - 1]
      const len = Math.hypot(fix[0] - prev[0], fix[1] - prev[1]) || 1
      const ux = (fix[0] - prev[0]) / len
      const uy = (fix[1] - prev[1]) / len
      const rx = uy
      const ry = -ux
      pts.push(fix)
      names.push(item.hold)
      for (let lap = 0; lap < item.laps; lap++) {
        pts.push([fix[0] + rx * 3.2, fix[1] + ry * 3.2])
        pts.push([fix[0] + rx * 3.2 - ux * 7, fix[1] + ry * 3.2 - uy * 7])
        pts.push([fix[0] - ux * 7, fix[1] - uy * 7])
        pts.push(fix)
        names.push('HOLD', 'HOLD', 'HOLD', item.hold)
      }
    }
    return { pts, names }
  }

  function palette(light) {
    return light
      ? {
          ring: 'rgba(0, 93, 117, .14)', ringLabel: 'rgba(23, 42, 53, .5)',
          airway: 'rgba(0, 98, 123, .22)', airwayLabel: 'rgba(0, 82, 104, .62)',
          fix: 'rgba(23, 107, 85, .8)', fixLabel: 'rgba(23, 42, 53, .68)',
          sector: 'rgba(118, 80, 0, .34)', sectorLabel: 'rgba(118, 80, 0, .78)',
          tma: 'rgba(0, 98, 123, .3)', coast: 'rgba(53, 85, 106, .26)',
          restrict: [156, 22, 36], runway: 'rgba(23, 42, 53, .85)', centerline: 'rgba(23, 42, 53, .34)',
          assumed: '#096b4a', other: 'rgba(43, 70, 88, .92)', pending: '#835000', conflict: '#9c1624',
          vfr: 'rgba(53, 85, 106, .62)', text: 'rgba(23, 42, 53, .92)', textDim: 'rgba(43, 70, 88, .94)',
          select: '#005d75', sweep: [0, 107, 74], sweepPeak: .14, wxLight: [0, 98, 123], wxHeavy: [0, 98, 123], wxAlpha: .055,
          coastline: 'rgba(0, 82, 120, .62)', contour: 'rgba(110, 86, 50, .2)', contourIndex: 'rgba(110, 86, 50, .42)', depth: 'rgba(0, 98, 140, .18)',
          river: 'rgba(24, 112, 182, .62)', road: 'rgba(150, 108, 40, .45)', motorway: 'rgba(196, 120, 24, .7)', motorwayCasing: 'rgba(255, 255, 255, .8)',
          urban: 'rgba(120, 108, 96, .16)', town: 'rgba(23, 42, 53, .92)', townLabel: 'rgba(32, 48, 60, .9)', peak: 'rgba(78, 58, 28, .92)',
          msa: 'rgba(131, 80, 0, .72)', msaLabel: '#6b4300', sectorFill: [[40, 90, 200], [0, 140, 130], [120, 70, 190], [40, 140, 70], [190, 120, 0]],
          sectorFillAlpha: .075, sectorEdge: 'rgba(118, 80, 0, .62)', sectorName: 'rgba(104, 70, 0, .95)', freq: 'rgba(32, 48, 60, .82)', tmaFill: [0, 98, 123],
          // Technology style: the terrain line work and labels, recoloured.
          tech: {
            coastline: 'rgba(10, 70, 150, .62)', contour: 'rgba(20, 70, 150, .18)', contourIndex: 'rgba(20, 70, 150, .4)', depth: 'rgba(60, 50, 160, .18)',
            peak: 'rgba(14, 50, 110, .92)', msa: 'rgba(90, 50, 170, .72)', msaLabel: '#4b2a8f',
          },
        }
      : {
          ring: 'rgba(87, 189, 208, .11)', ringLabel: 'rgba(141, 232, 210, .4)',
          airway: 'rgba(71, 201, 213, .17)', airwayLabel: 'rgba(71, 201, 213, .45)',
          fix: 'rgba(141, 232, 210, .6)', fixLabel: 'rgba(141, 232, 210, .55)',
          sector: 'rgba(223, 169, 54, .3)', sectorLabel: 'rgba(223, 169, 54, .62)',
          tma: 'rgba(71, 201, 213, .22)', coast: 'rgba(120, 160, 180, .2)',
          restrict: [255, 102, 117], runway: 'rgba(220, 234, 243, .75)', centerline: 'rgba(220, 234, 243, .26)',
          assumed: '#43efbd', other: 'rgba(159, 183, 204, .82)', pending: '#e8b23a', conflict: '#ff5a69',
          vfr: 'rgba(159, 183, 204, .55)', text: 'rgba(220, 234, 243, .9)', textDim: 'rgba(159, 183, 204, .78)',
          select: '#e9f6ff', sweep: [70, 240, 168], sweepPeak: .11, wxLight: [64, 140, 200], wxHeavy: [232, 178, 58], wxAlpha: .11,
          coastline: 'rgba(132, 192, 220, .58)', contour: 'rgba(170, 190, 150, .14)', contourIndex: 'rgba(196, 206, 160, .3)', depth: 'rgba(90, 150, 210, .14)',
          river: 'rgba(86, 160, 222, .58)', road: 'rgba(206, 182, 136, .32)', motorway: 'rgba(232, 190, 110, .5)', motorwayCasing: 'rgba(4, 16, 28, .9)',
          urban: 'rgba(170, 180, 192, .07)', town: 'rgba(220, 234, 243, .9)', townLabel: 'rgba(196, 212, 226, .82)', peak: 'rgba(226, 214, 184, .88)',
          msa: 'rgba(232, 178, 58, .62)', msaLabel: 'rgba(240, 196, 98, .95)', sectorFill: [[70, 140, 230], [60, 200, 190], [170, 120, 230], [90, 200, 120], [230, 170, 70]],
          sectorFillAlpha: .07, sectorEdge: 'rgba(223, 169, 54, .55)', sectorName: 'rgba(240, 200, 110, .9)', freq: 'rgba(196, 212, 226, .75)', tmaFill: [71, 201, 213],
          // Technology style: the terrain line work and labels, recoloured.
          tech: {
            coastline: 'rgba(120, 210, 255, .6)', contour: 'rgba(90, 200, 255, .16)', contourIndex: 'rgba(120, 220, 255, .34)', depth: 'rgba(110, 120, 255, .16)',
            peak: 'rgba(170, 230, 255, .9)', msa: 'rgba(160, 140, 255, .62)', msaLabel: 'rgba(190, 176, 255, .95)',
          },
        }
  }

  /* ---------------------------------------------------------------- scope -- */
  function createScope(hero, canvas) {
    const ctx = canvas.getContext('2d')
    const mapCanvas = document.createElement('canvas')
    const mapCtx = mapCanvas.getContext('2d')
    const maskCanvas = document.createElement('canvas')
    const maskCtx = maskCanvas.getContext('2d')
    // Previous style's map layer, kept for the cross-fade.
    const prevMapCanvas = document.createElement('canvas')
    const prevMapCtx = prevMapCanvas.getContext('2d')
    // Background fills (terrain/geo rasters, sector tints): composited under
    // everything, with a lighter legibility mask than the detail layer.
    const baseCanvas = document.createElement('canvas')
    const baseCtx = baseCanvas.getContext('2d')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const FADE_MS = 450
    const WORLD_FADE_MS = 700

    let W = 1
    let H = 1
    let dpr = 1
    let ox = 0
    let oy = 0
    let scale = 8 // px per NM
    let radarR = 0
    let view = { x0: -100, x1: 100, y0: -50, y1: 50 } // "our sector": the picture at zoom 0
    let sim = { x0: -200, x1: 200, y0: -100, y1: 100 } // traffic region: 2× the view, covers zoom-out
    let viewport = null
    let OX = 0 // displayed radar head + px per NM after the viewport camera
    let OY = 0
    let S = 8
    let mapKey = ''
    let staticDrawQueued = false
    // Map details on load: all overlays on (incl. airways & fixes and weather).
    const layers = { airways: true, airspace: true, rings: true, weather: true, labels: true }
    let style = 'technology' // default hero background style (on page load)
    let fade = null // { from, start, key } while cross-fading between styles
    let scaleBottom = 0 // y of the scale bar (inside the first screen)
    let copyRect = null // hero copy column (hero px), kept clear of map labels
    const adjustTarget = Object.fromEntries(ADJUSTMENTS.map(a => [a.id, a.value]))
    try {
      const saved = JSON.parse(window.localStorage.getItem(ADJUST_KEY) || '{}')
      for (const a of ADJUSTMENTS) if (Number.isFinite(saved[a.id])) adjustTarget[a.id] = clamp(saved[a.id], a.min, a.max)
    } catch {
      // Storage unavailable or corrupt: defaults.
    }
    const adjust = { ...adjustTarget } // eased values actually rendered
    let saveTimer = 0
    let TA = 1 // traffic alpha for the current frame
    let pal = palette(false)
    let theme = 'dark'

    // Generated geography (shared by all styles), refined detail raster and previews.
    // Two passes of the same seeded world: a quick low-resolution one so the
    // default Technology view is complete from the first visible frame, then the
    // full-resolution one, cross-faded in when ready.
    const worldOptions = {
      coast: COAST,
      airport: [34, -20],
      themeOrder: document.documentElement.dataset.theme === 'light' ? ['light', 'dark'] : ['dark', 'light'],
    }
    const firstWorld = window.KMAsdWorld?.create({
      ...worldOptions,
      res: 1,
      skipRivers: true,
      styles: ['technology'], // both themes: an early theme toggle never shows a gap
    })
    let world = firstWorld
    let worldReadyAt = 0
    let refined = null // { canvas, x0, y0, x1, y1, style, theme, readyAt }
    let refineToken = 0
    let refineTimer = 0
    const previewListeners = new Set()
    const styleListeners = new Set()
    let previews = null
    let tracks = []
    let weather = []
    let realTime = 0
    let last = 0
    let raf = 0
    let inView = true
    let selected = null
    let nextSelect = 3
    let spawnTimer = 0
    const callsigns = new Set()

    const toX = x => OX + x * S
    const toY = y => OY - y * S
    const edgeDistance = (x, y) => Math.min(x - view.x0, view.x1 - x, y - view.y0, view.y1 - y)
    const simEdge = (x, y) => Math.min(x - sim.x0, sim.x1 - x, y - sim.y0, sim.y1 - y)
    const onScreen = (px, py, pad = 0) => px > -pad && px < W + pad && py > -pad && py < H + pad

    /** Apply the viewport camera (displayed = base * k + t) to the radar geometry. */
    function syncCamera() {
      const cam = viewport ? viewport.state : { k: 1, tx: 0, ty: 0 }
      OX = ox * cam.k + cam.tx
      OY = oy * cam.k + cam.ty
      S = scale * cam.k
      return cam
    }

    /* ---------------------------------------------------------- geometry -- */
    function measure() {
      const rect = hero.getBoundingClientRect()
      W = Math.max(1, Math.round(rect.width))
      H = Math.max(1, Math.round(rect.height))
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      for (const c of [canvas, mapCanvas, maskCanvas, prevMapCanvas, baseCanvas]) {
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
      }

      radarR = 0
      const radar = hero.querySelector('[aria-label="Animated radar display"]')
      const r = radar?.getBoundingClientRect()
      if (r && r.width > 60 && r.bottom > rect.top && r.top < rect.bottom) {
        ox = r.left - rect.left + r.width / 2
        oy = r.top - rect.top + r.height / 2
        radarR = r.width * 0.42
      } else {
        ox = W * 0.64
        oy = H * 0.5
      }
      scale = radarR ? clamp(radarR / 20, 4.5, 14) : clamp(W / 200, 4.5, 12)
      view = { x0: -ox / scale, x1: (W - ox) / scale, y0: -(H - oy) / scale, y1: oy / scale }
      const halfW = (view.x1 - view.x0) / 2
      const halfH = (view.y1 - view.y0) / 2
      sim = { x0: view.x0 - halfW, x1: view.x1 + halfW, y0: view.y0 - halfH, y1: view.y1 + halfH }
      // The scale bar sits beside the map controls, which stay within the first
      // screen on two-column layouts (hero starts at the top of the page).
      const heroPageTop = rect.top + window.scrollY
      scaleBottom = W >= 768 ? Math.min(H, window.innerHeight - heroPageTop) : H

      mapKey = ''
      buildMask(rect)
    }

    function targetCount() {
      const area = (sim.x1 - sim.x0) * (sim.y1 - sim.y0)
      // ~30% lighter than the original 1 per 1150 NM² (24–64) for a calmer picture.
      return clamp(Math.round(area / 1650), 17, 45)
    }

    /** Keep the displayed window inside the traffic region (viewport constraint). */
    function constrainCamera({ k, tx, ty }) {
      const bx0 = ox + sim.x0 * scale
      const bx1 = ox + sim.x1 * scale
      const by0 = oy - sim.y1 * scale
      const by1 = oy - sim.y0 * scale
      const fit = (t, lo, hi) => (lo > hi ? (lo + hi) / 2 : clamp(t, lo, hi))
      return { tx: fit(tx, W - bx1 * k, -bx0 * k), ty: fit(ty, H - by1 * k, -by0 * k) }
    }

    /* --------------------------------------------------------- map layer -- */
    // Time ramps (instant when motion is reduced or the loop is paused).
    const ramp = (t0, ms) => (!t0 ? 0 : reduceMotion.matches || !shouldRun() ? 1 : clamp((performance.now() - t0) / ms, 0, 1))
    const worldAlpha = (preview = false) => (world?.ready ? (preview ? 1 : ramp(worldReadyAt, WORLD_FADE_MS)) : 0)

    /** World rectangle (NM) currently on screen, padded by `pad` px. */
    function visibleWorld(pad = 0) {
      return { x0: (-pad - OX) / S, x1: (W + pad - OX) / S, y0: (OY - H - pad) / S, y1: (OY + pad) / S }
    }

    function tracePoly(c, points, close) {
      c.beginPath()
      points.forEach(([x, y], i) => (i ? c.lineTo(toX(x), toY(y)) : c.moveTo(toX(x), toY(y))))
      if (close) c.closePath()
    }

    function buildMap() {
      mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      mapCtx.clearRect(0, 0, W, H)
      renderMap(mapCtx, style)
    }

    /** Detail layer of a style (lines, symbols, labels) into context `c`. */
    function renderMap(c, styleId, { preview = false } = {}) {
      c.save()
      c.lineCap = 'round'
      c.lineJoin = 'round'
      if ('letterSpacing' in c) c.letterSpacing = '1px'
      if (styleId === 'declutter') c.globalAlpha = 0.34
      const poly = (points, close) => tracePoly(c, points, close)

      const wa = worldAlpha(preview)
      if (wa > 0) {
        c.save()
        c.globalAlpha *= wa
        drawGeography(c, styleId, preview)
        c.restore()
      } else {
        // Until the world is generated, the outline coastline stands in.
        c.strokeStyle = pal.coast
        c.lineWidth = 1.1
        poly(COAST)
        c.stroke()
      }
      if (layers.rings) drawRings(c, preview)
      if (styleId === 'sectors') drawSectors(c, poly, preview)
      if (layers.airspace) drawAirspace(c, poly, styleId, preview)
      if (layers.airways) drawRoutes(c, poly, preview)
      drawAirport(c, preview)
      if (!preview) drawScaleBar(c)
      c.restore()
    }

    function drawGeography(c, styleId, preview) {
      const v = visibleWorld(24)
      const segments = (set, color, width) => {
        c.strokeStyle = color
        c.lineWidth = width
        c.beginPath()
        for (const t of world.contourTiles(set, v.x0, v.y0, v.x1, v.y1)) {
          for (let i = 0; i < t.length; i += 4) {
            c.moveTo(toX(t[i]), toY(t[i + 1]))
            c.lineTo(toX(t[i + 2]), toY(t[i + 3]))
          }
        }
        c.stroke()
      }
      for (const set of world.contours) {
        if (styleId === 'terrain') {
          if (set.kind === 'land') segments(set, pal.contour, 0.8)
          else if (set.kind === 'index') segments(set, pal.contourIndex, 1.15)
          else if (set.kind === 'depth') segments(set, pal.depth, 0.8)
        } else if (styleId === 'technology') {
          // Same line work as terrain, in the technology colours.
          if (set.kind === 'land') segments(set, pal.tech.contour, 0.8)
          else if (set.kind === 'index') segments(set, pal.tech.contourIndex, 1.15)
          else if (set.kind === 'depth') segments(set, pal.tech.depth, 0.8)
        } else if (styleId === 'geo' && set.kind === 'depth' && set.level === -600) {
          segments(set, pal.depth, 0.8)
        }
      }
      const strong = styleId === 'terrain' || styleId === 'geo'
      const coastSet = world.contours.find(s => s.kind === 'coast')
      if (styleId === 'technology') {
        if (coastSet) segments(coastSet, pal.tech.coastline, 1.25)
      } else if (coastSet) segments(coastSet, strong ? pal.coastline : pal.coast, strong ? 1.25 : 1.1)
      if (styleId === 'geo') drawRiversRoadsTowns(c, preview)
      if (styleId === 'terrain') drawTerrainAnnotations(c, preview)
      if (styleId === 'technology') drawTerrainAnnotations(c, preview, pal.tech)
    }

    function drawRiversRoadsTowns(c, preview) {
      // Rivers widen downstream.
      c.strokeStyle = pal.river
      for (const river of world.rivers) {
        const n = river.length
        for (let k = 0; k < 3; k++) {
          const a = Math.floor((n * k) / 3)
          const b = Math.min(n - 1, Math.floor((n * (k + 1)) / 3) + 1)
          c.lineWidth = 0.7 + k * 0.6
          c.beginPath()
          for (let i = a; i <= b; i++) {
            const [x, y] = river[i]
            if (i === a) c.moveTo(toX(x), toY(y))
            else c.lineTo(toX(x), toY(y))
          }
          c.stroke()
        }
      }
      // Roads: cased motorways over ordinary roads.
      const trace = road => {
        c.beginPath()
        road.pts.forEach(([x, y], i) => (i ? c.lineTo(toX(x), toY(y)) : c.moveTo(toX(x), toY(y))))
      }
      for (const road of world.roads) {
        if (road.kind !== 'road') continue
        trace(road)
        c.strokeStyle = pal.road
        c.lineWidth = 1.1
        c.stroke()
      }
      for (const road of world.roads) {
        if (road.kind !== 'motorway') continue
        trace(road)
        c.strokeStyle = pal.motorwayCasing
        c.lineWidth = 3.4
        c.stroke()
        trace(road)
        c.strokeStyle = pal.motorway
        c.lineWidth = 1.8
        c.stroke()
      }
      // Towns
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      for (const t of world.towns) {
        const px = toX(t.x)
        const py = toY(t.y)
        if (!onScreen(px, py, 80)) continue
        c.fillStyle = pal.town
        c.beginPath()
        c.arc(px, py, 1.8 + t.size * 1.6, 0, TAU)
        c.fill()
        if (!preview) {
          c.font = `600 ${t.size >= 0.7 ? 10 : 9}px ${FONT}`
          c.fillStyle = pal.townLabel
          c.fillText(t.name, px + 7, py - 7)
        }
      }
    }

    // `colors`: line and label colours (terrain: the palette itself; technology: pal.tech).
    function drawTerrainAnnotations(c, preview, colors = pal) {
      // Spot heights
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      for (const p of world.peaks) {
        const px = toX(p.x)
        const py = toY(p.y)
        if (!onScreen(px, py, 40)) continue
        c.fillStyle = colors.peak
        c.beginPath()
        c.moveTo(px, py - 4.2)
        c.lineTo(px + 3.8, py + 2.6)
        c.lineTo(px - 3.8, py + 2.6)
        c.closePath()
        c.fill()
        if (!preview) {
          c.font = `600 9px ${FONT}`
          c.fillText(Math.round(p.e).toLocaleString('en-US'), px + 7, py)
        }
      }
      // Minimum sector altitude around KMND (25 NM, four sectors).
      const m = world.msa
      if (!m) return
      const cx = toX(m.center[0])
      const cy = toY(m.center[1])
      const r = m.radius * S
      c.strokeStyle = colors.msa
      c.lineWidth = 1.2
      c.setLineDash([6, 4])
      c.beginPath()
      c.arc(cx, cy, r, 0, TAU)
      c.stroke()
      c.setLineDash([])
      c.lineWidth = 0.9
      for (const s of m.sectors) {
        const a = (s.from - 90) * DEG
        c.beginPath()
        c.moveTo(cx + Math.cos(a) * r * 0.12, cy + Math.sin(a) * r * 0.12)
        c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        c.stroke()
      }
      if (preview) return
      c.textAlign = 'center'
      c.fillStyle = colors.msaLabel
      c.font = `700 10px ${FONT}`
      for (const s of m.sectors) {
        const mid = (s.from + ((s.to - s.from + 360) % 360) / 2 - 90) * DEG
        c.fillText(s.alt.toLocaleString('en-US'), cx + Math.cos(mid) * r * 0.62, cy + Math.sin(mid) * r * 0.62)
      }
      c.font = `600 9px ${FONT}`
      c.fillText('MSA 25 NM · KMND', cx, cy + r + 13)
    }

    function drawRings(c, preview) {
      // Range rings, every 10 NM (20 NM when zoomed far out), labelled every other ring.
      const farX = Math.max(Math.abs(OX), Math.abs(W - OX))
      const farY = Math.max(Math.abs(OY), Math.abs(H - OY))
      const maxR = Math.hypot(farX, farY) / S
      const ringStep = 10 * S < 36 ? 20 : 10
      c.font = `500 9px ${FONT}`
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      for (let nm = ringStep; nm <= Math.min(maxR, 400); nm += ringStep) {
        c.strokeStyle = pal.ring
        c.lineWidth = nm % 50 === 0 ? 1 : 0.8
        c.setLineDash(nm % 50 === 0 ? [] : [2, 7])
        c.beginPath()
        c.arc(OX, OY, nm * S, 0, TAU)
        c.stroke()
        if (!preview && nm % (ringStep * 2) === 0) {
          c.fillStyle = pal.ringLabel
          c.fillText(`${nm}`, OX + Math.cos(40 * DEG) * nm * S + 3, OY + Math.sin(40 * DEG) * nm * S)
        }
      }
      c.setLineDash([])
      if (preview) return
      // Compass rose around the radar head, just outside the hero radar at zoom 0.
      const roseR = Math.max(radarR + 26, 30 * scale) * (S / scale)
      c.strokeStyle = pal.ring
      c.fillStyle = pal.ringLabel
      c.textAlign = 'center'
      for (let deg = 0; deg < 360; deg += 5) {
        const a = (deg - 90) * DEG
        const len = deg % 30 === 0 ? 10 : deg % 10 === 0 ? 6 : 3
        c.lineWidth = deg % 30 === 0 ? 1.1 : 0.8
        c.beginPath()
        c.moveTo(OX + Math.cos(a) * roseR, OY + Math.sin(a) * roseR)
        c.lineTo(OX + Math.cos(a) * (roseR + len), OY + Math.sin(a) * (roseR + len))
        c.stroke()
        if (deg % 30 === 0) c.fillText(String(deg).padStart(3, '0'), OX + Math.cos(a) * (roseR + 20), OY + Math.sin(a) * (roseR + 20))
      }
    }

    function drawSectors(c, poly, preview) {
      c.strokeStyle = pal.sectorEdge
      c.lineWidth = 1.4
      c.setLineDash([])
      for (const s of SECTORS) {
        poly(s.poly, true)
        c.stroke()
      }
      c.setLineDash([3, 4])
      c.lineWidth = 1.1
      c.beginPath()
      c.arc(toX(CTR.center[0]), toY(CTR.center[1]), CTR.radius * S, 0, TAU)
      c.stroke()
      c.setLineDash([])
      if (preview) return
      c.textAlign = 'left'
      c.textBaseline = 'alphabetic'
      for (const s of SECTORS) {
        const spot = sectorLabelSpot(s)
        if (!spot) continue
        const [px, py] = spot
        c.font = `700 13px ${FONT}`
        c.fillStyle = pal.sectorName
        c.fillText(s.id, px, py)
        c.font = `500 9px ${FONT}`
        c.fillStyle = pal.freq
        c.fillText(`${s.freq} · ${s.limits}`, px, py + 14)
      }
      c.font = `500 9px ${FONT}`
      c.fillStyle = pal.freq
      c.fillText(CTR.label, toX(CTR.center[0] - CTR.radius), toY(CTR.center[1] - CTR.radius) + 15)
    }

    const insidePoly = (x, y, poly) => {
      let inside = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]
        const [xj, yj] = poly[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
      return inside
    }

    /**
     * Label position for a sector: the centre of its visible part, avoiding
     * the hero copy, the nav and the bottom control clusters.
     */
    function sectorLabelSpot(sector) {
      const pts = []
      for (let px = 24; px < W - 150; px += 32) {
        for (let py = 90; py < H - 150; py += 28) {
          if (copyRect && px > copyRect.x0 - 120 && px < copyRect.x1 && py > copyRect.y0 && py < copyRect.y1) continue
          if (insidePoly((px - OX) / S, (OY - py) / S, sector.poly)) pts.push([px, py])
        }
      }
      if (pts.length < 3) return null
      const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length
      const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length
      return pts.reduce((best, p) => (Math.hypot(p[0] - cx, p[1] - cy) < Math.hypot(best[0] - cx, best[1] - cy) ? p : best))
    }

    function drawAirspace(c, poly, styleId, preview) {
      // Sector boundaries (the Sectors style draws them solid instead).
      if (styleId !== 'sectors') {
        c.strokeStyle = pal.sector
        c.lineWidth = 1.2
        c.setLineDash([9, 7])
        for (const line of SECTOR_LINES) {
          poly(line)
          c.stroke()
        }
      }
      // TMA
      c.strokeStyle = pal.tma
      c.setLineDash([4, 5])
      c.lineWidth = 1.2
      poly(TMA.poly, true)
      c.stroke()
      c.setLineDash([])
      c.font = `600 9px ${FONT}`
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      if (!preview) {
        c.fillStyle = pal.sectorLabel
        if (styleId !== 'sectors') for (const label of SECTOR_LABELS) c.fillText(label.text, toX(label.at[0]), toY(label.at[1]))
        c.fillStyle = pal.airwayLabel
        c.fillText(styleId === 'sectors' ? `${TMA.label} · APP 119.725` : TMA.label, toX(TMA.at[0]), toY(TMA.at[1]))
      }

      // Restricted area: hatched fill, label. Border pulses in the live layer.
      const [rr, rg, rb] = pal.restrict
      c.save()
      poly(RESTRICTED.poly, true)
      c.clip()
      c.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, .13)`
      c.lineWidth = 1
      const xs = RESTRICTED.poly.map(p => toX(p[0]))
      const ys = RESTRICTED.poly.map(p => toY(p[1]))
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      for (let x = minX - (maxY - minY); x < maxX; x += 7) {
        c.beginPath()
        c.moveTo(x, maxY)
        c.lineTo(x + (maxY - minY), minY)
        c.stroke()
      }
      c.restore()
      if (!preview) {
        c.fillStyle = `rgba(${rr}, ${rg}, ${rb}, .8)`
        c.font = `600 9px ${FONT}`
        c.fillText(RESTRICTED.label, minX, maxY + 12)
      }
    }

    function drawRoutes(c, poly, preview) {
      // Airways
      c.font = `500 9px ${FONT}`
      c.textBaseline = 'middle'
      for (const airway of AIRWAYS) {
        const pts = airway.via.map(id => POINTS[id])
        c.strokeStyle = pal.airway
        c.lineWidth = 1
        poly(pts)
        c.stroke()
        if (preview) continue
        // Label on the longest on-screen segment.
        let best = null
        for (let i = 0; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2
          const my = (pts[i][1] + pts[i + 1][1]) / 2
          const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
          if (onScreen(toX(mx), toY(my), -30) && (!best || len > best.len)) best = { mx, my, len }
        }
        if (best) {
          c.fillStyle = pal.airwayLabel
          c.textAlign = 'center'
          c.fillText(airway.id, toX(best.mx), toY(best.my) - 7)
        }
      }

      // Fixes
      c.textAlign = 'left'
      for (const [name, [x, y]] of Object.entries(FIXES)) {
        const px = toX(x)
        const py = toY(y)
        c.strokeStyle = pal.fix
        c.lineWidth = 1.1
        c.beginPath()
        c.moveTo(px, py - 4.5)
        c.lineTo(px + 4, py + 3)
        c.lineTo(px - 4, py + 3)
        c.closePath()
        c.stroke()
        if (!preview) {
          c.fillStyle = pal.fixLabel
          c.fillText(name, px + 7, py + 1)
        }
      }

      // VOR
      const px = toX(VOR.at[0])
      const py = toY(VOR.at[1])
      c.strokeStyle = pal.fix
      c.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = i * 60 * DEG
        if (i) c.lineTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6)
        else c.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6)
      }
      c.closePath()
      c.stroke()
      c.fillStyle = pal.fix
      c.beginPath()
      c.arc(px, py, 1.4, 0, TAU)
      c.fill()
      if (!preview) {
        c.fillStyle = pal.fixLabel
        c.fillText(`${VOR.id} ${VOR.freq}`, px + 9, py + 10)
      }
    }

    function drawAirport(c, preview) {
      // Runway 09/27 and the RWY 27 ILS centreline (ticks every NM).
      const [wx, wy] = AIRPORT.west
      const [ex] = AIRPORT.east
      c.strokeStyle = pal.centerline
      c.lineWidth = 1
      c.setLineDash([5, 5])
      c.beginPath()
      c.moveTo(toX(ex), toY(wy))
      c.lineTo(toX(ex + 15), toY(wy))
      c.stroke()
      c.setLineDash([])
      for (let nm = 1; nm <= 15; nm++) {
        const len = nm % 5 === 0 ? 5 : 2.5
        c.beginPath()
        c.moveTo(toX(ex + nm), toY(wy) - len)
        c.lineTo(toX(ex + nm), toY(wy) + len)
        c.stroke()
      }
      c.strokeStyle = pal.runway
      c.lineWidth = 3
      c.beginPath()
      c.moveTo(toX(wx), toY(wy))
      c.lineTo(toX(ex), toY(wy))
      c.stroke()
      if (preview) return
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      c.fillStyle = pal.fixLabel
      c.font = `700 9px ${FONT}`
      c.fillText(AIRPORT.id, toX(wx) - 4, toY(wy) - 10)
      c.font = `500 8px ${FONT}`
      c.fillText('ILS 27', toX(ex + 9), toY(wy) - 9)
    }

    // Scale bar (bottom-right, beside the map controls; the style picker owns
    // the bottom-left): a round distance between ~50 and ~130 px at this zoom.
    function drawScaleBar(c) {
      const nm = [1, 2, 5, 10, 20, 50, 100].find(d => d * S >= 50) || 100
      const len = nm * S
      const x = W - 64 - len
      const y = scaleBottom - 30
      c.strokeStyle = pal.ringLabel
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(x, y - 4)
      c.lineTo(x, y)
      c.lineTo(x + len, y)
      c.lineTo(x + len, y - 4)
      c.stroke()
      c.fillStyle = pal.ringLabel
      c.font = `500 9px ${FONT}`
      c.textAlign = 'center'
      c.textBaseline = 'alphabetic'
      c.fillText(`${nm} NM`, x + len / 2, y - 7)
    }

    /* ---------------------------------------------------- background fills -- */
    function drawRaster(c, raster) {
      const b = world.bounds
      const res = world.res
      const v = visibleWorld(4)
      const x0 = Math.max(b.x0, v.x0)
      const x1 = Math.min(b.x1, v.x1)
      const y0 = Math.max(b.y0, v.y0)
      const y1 = Math.min(b.y1, v.y1)
      if (x1 <= x0 || y1 <= y0) return
      c.imageSmoothingEnabled = true
      c.imageSmoothingQuality = 'high'
      c.drawImage(raster, (x0 - b.x0) * res, (b.y1 - y1) * res, (x1 - x0) * res, (y1 - y0) * res, toX(x0), toY(y1), (x1 - x0) * S, (y1 - y0) * S)
    }

    // A style raster the current world has not built yet (the quick first-pass
    // world builds Terrain only): build it once, then redraw and refresh previews.
    let rasterJob = {}
    function ensureRaster(styleId) {
      const w = world
      const key = `${styleId}:${theme}`
      if (!w?.ensureRaster || (rasterJob.world === w && rasterJob.key === key)) return
      rasterJob = { world: w, key }
      w.ensureRaster(styleId, theme).then(() => {
        if (world !== w) return
        buildPreviews()
        requestStaticDraw()
      })
    }

    /** Background fills of a style (terrain/technology/geo rasters, sector tints) into `c`. */
    function renderBase(c, styleId, alpha, { preview = false } = {}) {
      if (alpha <= 0) return
      c.save()
      c.globalAlpha = alpha
      if (styleId === 'sectors') {
        SECTORS.forEach((s, i) => {
          const [r, g, b] = pal.sectorFill[i % pal.sectorFill.length]
          c.fillStyle = `rgba(${r}, ${g}, ${b}, ${pal.sectorFillAlpha})`
          tracePoly(c, s.poly, true)
          c.fill()
        })
        const [r, g, b] = pal.tmaFill
        c.fillStyle = `rgba(${r}, ${g}, ${b}, .08)`
        tracePoly(c, TMA.poly, true)
        c.fill()
        c.fillStyle = `rgba(${r}, ${g}, ${b}, .1)`
        c.beginPath()
        c.arc(toX(CTR.center[0]), toY(CTR.center[1]), CTR.radius * S, 0, TAU)
        c.fill()
      } else if ((styleId === 'terrain' || styleId === 'technology' || styleId === 'geo') && world?.ready) {
        c.globalAlpha = alpha * worldAlpha(preview)
        const raster = world.raster(styleId, theme)
        if (raster) drawRaster(c, raster)
        else ensureRaster(styleId) // e.g. Technology picked before the full world is ready
        // Zoomed-in detail: a full-resolution render of the visible area.
        if (!preview && refined && refined.style === styleId && refined.theme === theme) {
          c.globalAlpha = alpha * worldAlpha() * ramp(refined.readyAt, 320)
          c.imageSmoothingQuality = 'high'
          c.drawImage(refined.canvas, toX(refined.x0), toY(refined.y1), (refined.x1 - refined.x0) * S, (refined.y1 - refined.y0) * S)
        }
        if (styleId === 'geo') {
          c.globalAlpha = alpha * worldAlpha(preview)
          c.fillStyle = pal.urban
          for (const t of world.towns) {
            tracePoly(c, t.area.map(([dx, dy]) => [t.x + dx, t.y + dy]), true)
            c.fill()
          }
        }
      }
      c.restore()
    }

    /* ----------------------------------------------------------- refining -- */
    function scheduleRefine() {
      window.clearTimeout(refineTimer)
      refineTimer = window.setTimeout(runRefine, 280)
    }

    function runRefine() {
      if (!world?.ready || (style !== 'terrain' && style !== 'technology' && style !== 'geo')) return
      syncCamera()
      // Only when the shared raster would be visibly magnified.
      if ((S / world.res) * dpr < 2.2) {
        if (refined) {
          refined = null
          requestStaticDraw()
        }
        return
      }
      const v = visibleWorld(0)
      if (refined && refined.style === style && refined.theme === theme && refined.x0 <= v.x0 && refined.x1 >= v.x1 && refined.y0 <= v.y0 && refined.y1 >= v.y1 && refined.pxPerNm >= S * dpr * 0.7) return
      const mx = (v.x1 - v.x0) * 0.15
      const my = (v.y1 - v.y0) * 0.15
      const r = { x0: v.x0 - mx, x1: v.x1 + mx, y0: v.y0 - my, y1: v.y1 + my }
      const pxPerNm = Math.min(S * dpr, Math.sqrt(1.8e6 / ((r.x1 - r.x0) * (r.y1 - r.y0))))
      const token = ++refineToken
      const job = { style, theme }
      world.runSliced(world.refine(job.style, job.theme, r.x0, r.y0, r.x1, r.y1, pxPerNm), 6).then(result => {
        if (token !== refineToken || job.style !== style || job.theme !== theme) return
        refined = { ...result, ...job, pxPerNm, readyAt: performance.now() }
        requestStaticDraw()
      })
    }

    /* ----------------------------------------------------------- previews -- */
    // Each preview frames what makes its style distinctive, with only the layers
    // that read at thumbnail size.
    const PREVIEW_VIEWS = {
      radar: { center: [2, -6], span: 90, layers: { rings: true, airways: true, airspace: false } },
      sectors: { center: [-12, -4], span: 230, layers: { rings: false, airways: false, airspace: true } },
      terrain: { center: [42, 22], span: 110, layers: { rings: false, airways: false, airspace: false } },
      technology: { center: [-60, 34], span: 110, layers: { rings: false, airways: false, airspace: false } },
      geo: { center: [22, -32], span: 110, layers: { rings: false, airways: false, airspace: false } },
      declutter: { center: [2, -6], span: 90, layers: { rings: true, airways: true, airspace: false } },
    }

    /** The Technology style's own mark in its preview: a small microchip, bottom right. */
    function drawChipMark(c, size) {
      const s = Math.round(size * 0.3)
      const x = size - s - 4
      const y = size - s - 4
      const ink = theme === 'light' ? '#1f4fa8' : '#7fd8ff'
      c.save()
      c.fillStyle = theme === 'light' ? 'rgba(255, 255, 255, .9)' : 'rgba(4, 14, 36, .85)'
      c.strokeStyle = ink
      c.lineWidth = 1.2
      c.beginPath()
      c.roundRect(x + 3, y + 3, s - 6, s - 6, 2)
      c.fill()
      c.stroke()
      // Pins: three per side.
      c.beginPath()
      for (let i = 1; i <= 3; i++) {
        const p = x + 3 + ((s - 6) * i) / 4
        const q = y + 3 + ((s - 6) * i) / 4
        c.moveTo(p, y); c.lineTo(p, y + 3)
        c.moveTo(p, y + s - 3); c.lineTo(p, y + s)
        c.moveTo(x, q); c.lineTo(x + 3, q)
        c.moveTo(x + s - 3, q); c.lineTo(x + s, q)
      }
      c.stroke()
      c.fillStyle = ink
      c.fillRect(x + s / 2 - 2.5, y + s / 2 - 2.5, 5, 5)
      c.restore()
    }

    /** Small rendered preview of a style (for the style picker), as a data URL. */
    function renderPreview(styleId, size) {
      const saved = { W, H, OX, OY, S }
      const savedLayers = { ...layers }
      const view = PREVIEW_VIEWS[styleId] || PREVIEW_VIEWS.radar
      Object.assign(layers, view.layers)
      const out = document.createElement('canvas')
      out.width = size * 2
      out.height = size * 2
      const c = out.getContext('2d')
      c.setTransform(2, 0, 0, 2, 0, 0)
      W = size
      H = size
      S = size / view.span
      OX = size / 2 - view.center[0] * S
      OY = size / 2 + view.center[1] * S
      try {
        c.fillStyle = HERO_BG[theme]
        c.fillRect(0, 0, size, size)
        renderBase(c, styleId, 1, { preview: true })
        renderMap(c, styleId, { preview: true })
        // A few sample targets (placed relative to the frame) with leader lines and label bars.
        const sample = [[0.3, 0.38, pal.assumed], [0.62, 0.66, pal.assumed], [0.2, 0.74, pal.other]]
        for (const [fx, fy, color] of sample) {
          const px = size * fx
          const py = size * fy
          c.strokeStyle = color
          c.fillStyle = color
          c.lineWidth = 1.2
          c.strokeRect(px - 2.5, py - 2.5, 5, 5)
          c.beginPath()
          c.moveTo(px + 3, py - 3)
          c.lineTo(px + 8, py - 8)
          c.stroke()
          c.fillRect(px + 9, py - 13, 12, 2)
          c.globalAlpha = 0.7
          c.fillRect(px + 9, py - 9, 8, 2)
          c.globalAlpha = 1
        }
        if (styleId === 'technology') drawChipMark(c, size)
      } finally {
        W = saved.W
        H = saved.H
        OX = saved.OX
        OY = saved.OY
        S = saved.S
        Object.assign(layers, savedLayers)
      }
      return out.toDataURL('image/png')
    }

    function buildPreviews() {
      previews = Object.fromEntries(STYLES.map(s => [s.id, renderPreview(s.id, 64)]))
      for (const fn of previewListeners) fn(previews)
    }

    /* -------------------------------------------------------- legibility -- */
    // Areas behind the hero copy and under the nav are faded out so the
    // foreground stays readable (applied with destination-out each frame).
    function buildMask(heroRect) {
      const c = maskCtx
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, W, H)
      // The hero copy column is the direct child of the hero that holds the headline.
      let copy = hero.querySelector('h1')
      while (copy && copy.parentElement !== hero) copy = copy.parentElement
      const r = copy?.getBoundingClientRect()
      if (r && r.width > 0) {
        const pad = 56
        const x0 = r.left - heroRect.left - pad
        const x1 = r.right - heroRect.left + pad
        const y0 = r.top - heroRect.top - pad
        const y1 = r.bottom - heroRect.top + pad
        copyRect = { x0, x1, y0, y1 }
        const g = c.createLinearGradient(x0, 0, x1, 0)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(0.14, 'rgba(0,0,0,.76)')
        g.addColorStop(0.86, 'rgba(0,0,0,.76)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = g
        c.fillRect(x0, y0, x1 - x0, y1 - y0)
        c.globalCompositeOperation = 'destination-in'
        const v = c.createLinearGradient(0, y0, 0, y1)
        v.addColorStop(0, 'rgba(0,0,0,0)')
        v.addColorStop(0.12, '#000')
        v.addColorStop(0.88, '#000')
        v.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = v
        c.fillRect(x0, y0, x1 - x0, y1 - y0)
        c.globalCompositeOperation = 'source-over'
      }
      // Keep the transparent primary nav that overlays the hero clear of traffic.
      const nav = document.querySelector('nav[aria-label="Primary"]')?.getBoundingClientRect()
      const navBottom = nav ? clamp(nav.bottom - heroRect.top, 0, H) : 0
      if (navBottom > 0) {
        const g = c.createLinearGradient(0, 0, 0, navBottom + 36)
        g.addColorStop(0, 'rgba(0,0,0,.88)')
        g.addColorStop(navBottom / (navBottom + 36), 'rgba(0,0,0,.88)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = g
        c.fillRect(0, 0, W, navBottom + 36)
      }
      // (The hero radar widget is hidden, so the picture is not faded behind it.)
    }

    /* ------------------------------------------------------------ traffic -- */
    function newCallsign() {
      for (let i = 0; i < 20; i++) {
        const digits = Math.random() < 0.5 ? String(Math.floor(rand(1, 999))) : `${Math.floor(rand(1, 99))}${String.fromCharCode(65 + Math.floor(rand(0, 26)))}`
        const cs = pick(AIRLINES) + digits
        if (!callsigns.has(cs)) {
          callsigns.add(cs)
          return cs
        }
      }
      return pick(AIRLINES) + Math.floor(rand(1000, 9999))
    }

    function routeRemaining(t) {
      let d = Math.hypot(t.pts[t.wi][0] - t.x, t.pts[t.wi][1] - t.y)
      for (let i = t.wi; i < t.pts.length - 1; i++) d += Math.hypot(t.pts[i + 1][0] - t.pts[i][0], t.pts[i + 1][1] - t.pts[i][1])
      return d
    }

    function spawn(kind = null) {
      const roll = Math.random()
      kind = kind || (roll < 0.24 ? 'arr' : roll < 0.42 ? 'dep' : 'over')
      const spec = pick(kind === 'arr' ? ARRIVALS : kind === 'dep' ? DEPARTURES : OVERFLIGHTS)
      const { pts, names } = resolveRoute(spec)
      const t = {
        kind, pts, names, wi: 1, x: pts[0][0], y: pts[0][1], hdg: 0, prevDist: Infinity,
        cs: newCallsign(), type: pick(TYPES), hist: [], histT: rand(0, HISTORY_INTERVAL),
        state: 'pending', willAssume: kind !== 'over' || Math.random() < 0.68,
        handoff: null, conflict: false, boost: 0, done: false,
      }

      if (kind === 'dep') {
        t.hdg = bearing(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
        t.alt = 400
        t.cruise = pick([23000, 25000, 27000, 31000, 35000])
        t.cfl = 7000
        t.gs = 165
        t.cruiseGs = rand(420, 470)
      } else {
        // Enter at the first point of the route just outside the display.
        let placed = false
        for (let i = 0; i < pts.length - 1 && !placed; i++) {
          const [ax, ay] = pts[i]
          const [bx, by] = pts[i + 1]
          const len = Math.hypot(bx - ax, by - ay)
          for (let d = 0; d <= len; d += 1) {
            const x = ax + (bx - ax) * (d / len)
            const y = ay + (by - ay) * (d / len)
            if (simEdge(x, y) > -3) {
              Object.assign(t, { x, y, wi: i + 1, hdg: bearing(ax, ay, bx, by) })
              placed = true
              break
            }
          }
        }
        if (!placed) return null
        if (kind === 'arr') {
          t.cruise = 24000
          t.cruiseGs = rand(400, 440)
          t.alt = Math.min(t.cruise, 1500 + routeRemaining(t) * 318)
          t.gs = clamp(150 + routeRemaining(t) * 7, 150, t.cruiseGs)
          t.cfl = Math.max(3000, Math.floor(t.alt / 5000) * 5000)
        } else {
          // RVSM semicircular rule: eastbound (000–179°) odd levels, westbound even.
          const eastbound = ((t.hdg % TAU) + TAU) % TAU < Math.PI
          const levels = eastbound ? [29000, 31000, 33000, 35000, 37000, 39000] : [28000, 30000, 32000, 34000, 36000, 38000]
          t.alt = pick(levels)
          t.cfl = Math.random() < 0.2 ? pick(levels.filter(level => level !== t.alt)) : t.alt
          t.cruiseGs = rand(410, 490)
          t.gs = t.cruiseGs
        }
      }
      tracks.push(t)
      return t
    }

    /* ------------------------------------------------- technology traffic -- */
    // Technology strips set to ACTIVE on the homepage's Technology Bays
    // (src/techbays) fly as overflights on the Technology style: same symbols,
    // trails, vectors, hand-in, STCA, selection and data-block layout as the
    // other traffic, with a data block of CALLSIGN · NAME · ADOPTED · LEVEL ·
    // SQUAWK. They arrive with the "km:active-technologies" event (and
    // window.KMActiveTechnologies for whichever side loads first).
    let techList = [] // [{ id, callsign, name, from, lvl, squawk, gs }]
    const techVisible = () => style === 'technology'
    const shown = t => !t.tech || techVisible()
    // On the Technology style only ACTIVE technology tracks carry a data block
    // (and can be the selected track); the usual traffic keeps its symbol,
    // trail and vector without a block. Other styles: every track has one.
    const hasBlock = t => !techVisible() || Boolean(t.tech)
    let drawnBlocks = [] // callsigns whose data block the last frame drew (diagnostics)

    // Callsign colour of a technology data block = its strip's callsign colour on
    // the Technology Bays: the bay's era tone, read live from the shared palette
    // variable (--bay-<tone> in techbays.css), so the two always match (themes,
    // palette changes, a strip moved to another bay). Cached per theme.
    const toneCache = new Map()
    function toneColor(t) {
      if (!t.tone) return ''
      const key = `${theme}:${t.tone}`
      if (!toneCache.has(key)) toneCache.set(key, getComputedStyle(document.documentElement).getPropertyValue(`--bay-${t.tone}`).trim())
      return toneCache.get(key)
    }

    /** Copies a technology's record onto its track; on later updates the level is a new cleared level. */
    function applyTech(t, tech, initial) {
      t.tech = tech.id
      t.cs = String(tech.callsign)
      t.name = String(tech.name ?? '')
      t.from = String(tech.from ?? '')
      t.squawk = String(tech.squawk ?? '')
      t.tone = /^[a-z]+$/.test(tech.tone ?? '') ? tech.tone : ''
      t.cfl = Math.max(10, Number(tech.lvl) || 300) * 100
      t.cruiseGs = clamp(Number(tech.gs) || 420, 250, 520)
      if (initial) {
        t.alt = t.cfl
        t.gs = t.cruiseGs
      }
    }

    /**
     * A track for one technology on an overflight route, flown forward until it
     * is on screen (`depth` NM inside the view, or its deepest point).
     */
    function spawnTech(tech, depth) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const t = spawn('over')
        if (!t) continue
        callsigns.delete(t.cs)
        applyTech(t, tech, true)
        t.willAssume = true
        let deepest = -Infinity
        for (let s = 0; s < 8000 && !t.done; s += 2) {
          const e = edgeDistance(t.x, t.y)
          if (e >= depth || (e > 2 && e < deepest - 0.5)) break
          deepest = Math.max(deepest, e)
          updateTrack(t, 2)
        }
        if (!t.done && edgeDistance(t.x, t.y) > 2) return t
        tracks = tracks.filter(other => other !== t)
      }
      return null
    }

    /** Every active technology has a track (new ones, and ones whose route ended). */
    function ensureTechTracks(depth) {
      if (!techList.length) return
      const present = new Set(tracks.filter(t => t.tech && !t.done).map(t => t.tech))
      for (const tech of techList) if (!present.has(tech.id)) spawnTech(tech, depth())
    }

    /** The active technologies (from the Technology Bays); tracks follow at once. */
    function setTechnologies(list) {
      techList = (Array.isArray(list) ? list : []).filter(tech => tech && tech.id && tech.callsign)
      const byId = new Map(techList.map(tech => [tech.id, tech]))
      for (const t of tracks) {
        if (!t.tech) continue
        const tech = byId.get(t.tech)
        if (tech) applyTech(t, tech, false)
        else t.done = true
      }
      tracks = tracks.filter(t => !t.done)
      if (selected?.done || (selected?.tech && !byId.has(selected.tech))) selected = null
      ensureTechTracks(() => rand(14, 40))
      detectConflicts()
      if (!shouldRun()) draw(performance.now())
    }

    function spawnVfr() {
      const x = rand(view.x0 + 8, view.x1 - 8)
      const y = rand(view.y0 + 8, view.y1 - 8)
      tracks.push({
        kind: 'vfr', x, y, hdg: rand(0, TAU), wanderHdg: rand(0, TAU), wanderT: rand(20, 60),
        gs: rand(90, 120), alt: Math.round(rand(15, 35)) * 100, hist: [], histT: 0,
        squawk: '7000', state: 'vfr', conflict: false, boost: 0, done: false,
      })
    }

    function steer(t, desired, dt) {
      const diff = wrapPi(desired - t.hdg)
      const max = TURN_RATE * dt
      t.hdg = wrapPi(t.hdg + clamp(diff, -max, max))
    }

    function updateTrack(t, dt) {
      if (!(dt > 0)) return
      if (t.kind === 'vfr') {
        t.wanderT -= dt
        if (t.wanderT <= 0) {
          t.wanderHdg = t.hdg + rand(-70, 70) * DEG
          t.wanderT = rand(30, 90)
        }
        if (edgeDistance(t.x, t.y) < 10) t.wanderHdg = bearing(t.x, t.y, (view.x0 + view.x1) / 2, (view.y0 + view.y1) / 2)
        steer(t, t.wanderHdg, dt * 0.5)
      } else {
        const [tx, ty] = t.pts[t.wi]
        const dist = Math.hypot(tx - t.x, ty - t.y)
        steer(t, bearing(t.x, t.y, tx, ty), dt)

        // Turn anticipation so aircraft fly by waypoints like an FMS.
        const v = t.gs / 3600
        const radius = v / TURN_RATE
        let lead = 0.5
        if (t.wi < t.pts.length - 1) {
          const [nx, ny] = t.pts[t.wi + 1]
          const turn = Math.abs(wrapPi(bearing(tx, ty, nx, ny) - bearing(t.x, t.y, tx, ty)))
          lead = clamp(radius * Math.tan(Math.min(turn, 120 * DEG) / 2), 0.4, 3)
        }
        if (dist < lead || (dist < radius * 3 && dist > t.prevDist + 1e-4)) {
          t.wi += 1
          t.prevDist = Infinity
          if (t.wi >= t.pts.length) {
            t.done = true
            return
          }
        } else {
          t.prevDist = dist
        }

        // Vertical and speed profiles.
        let altTarget = t.cfl
        let gsTarget = t.cruiseGs
        let rate = 1500
        if (t.kind === 'arr') {
          const dtg = routeRemaining(t)
          altTarget = Math.min(t.cruise, 1500 + dtg * 318)
          gsTarget = clamp(145 + dtg * 7, 145, t.cruiseGs)
          rate = 2200
          t.cfl = altTarget > 6000 ? Math.max(5000, Math.floor(altTarget / 5000) * 5000) : 3000
        } else if (t.kind === 'dep') {
          if (t.alt > t.cfl - 500 && t.cfl < t.cruise) t.cfl = Math.min(t.cruise, t.cfl + 8000)
          altTarget = t.cfl
          gsTarget = Math.min(t.cruiseGs, 170 + t.alt / 90)
          rate = 2600
        }
        const step = (rate / 60) * dt
        t.vs = clamp(altTarget - t.alt, -step, step) / dt
        t.alt += t.vs * dt
        t.gs += clamp(gsTarget - t.gs, -2 * dt, 2 * dt)
      }

      const v = t.gs / 3600
      t.x += Math.sin(t.hdg) * v * dt
      t.y += Math.cos(t.hdg) * v * dt

      t.histT += dt
      if (t.histT >= HISTORY_INTERVAL) {
        t.histT = 0
        t.hist.push([t.x, t.y])
        if (t.hist.length > HISTORY_DOTS) t.hist.shift()
      }

      if (t.kind === 'vfr') return
      const edge = edgeDistance(t.x, t.y)
      if (simEdge(t.x, t.y) < -14) t.done = true

      // Sector hand-in, hand-off.
      if (t.state === 'pending') {
        const ready = t.kind === 'dep' ? t.alt > 2500 : edge > 10
        if (ready) t.state = t.willAssume ? 'assumed' : 'other'
      } else if (t.state === 'assumed' && !t.handoff && edge < 9 && t.kind !== 'arr') {
        const ahead = edgeDistance(t.x + Math.sin(t.hdg) * 3, t.y + Math.cos(t.hdg) * 3)
        if (ahead < edge) t.handoff = pick(HANDOFF_UNITS.slice(0, 4))
      }
    }

    function detectConflicts() {
      for (const t of tracks) t.conflict = false
      const list = tracks.filter(t => t.kind !== 'vfr' && !t.done && shown(t) && edgeDistance(t.x, t.y) > -4)
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]
          const b = list[j]
          if (Math.abs(a.alt - b.alt) >= 1000) continue
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          const minSep = a.kind === 'arr' && b.kind === 'arr' && a.alt < 8000 ? 2.5 : 5
          const T = 90
          const ax = a.x + Math.sin(a.hdg) * (a.gs / 3600) * T
          const ay = a.y + Math.cos(a.hdg) * (a.gs / 3600) * T
          const bx = b.x + Math.sin(b.hdg) * (b.gs / 3600) * T
          const by = b.y + Math.cos(b.hdg) * (b.gs / 3600) * T
          const predicted = Math.hypot(ax - bx, ay - by)
          if (d < minSep || (predicted < minSep * 0.7 && d < 16)) {
            a.conflict = b
            b.conflict = a
          }
        }
      }
    }

    function update(simDt) {
      if (!(simDt > 0)) return
      const steps = Math.max(1, Math.ceil(simDt / 0.5))
      const dt = simDt / steps
      for (let s = 0; s < steps; s++) for (const t of tracks) if (!t.done) updateTrack(t, dt)
      for (const t of tracks) if (t.done && t.cs) callsigns.delete(t.cs)
      if (selected?.done) selected = null
      tracks = tracks.filter(t => !t.done)
      // An active technology whose route ended comes back on a new one, entering the view.
      ensureTechTracks(() => 3)

      // Technology tracks are extra: the usual traffic count is unchanged.
      const ifr = tracks.filter(t => t.kind !== 'vfr' && !t.tech).length
      spawnTimer -= simDt / TIME_SCALE
      if (ifr < targetCount() && spawnTimer <= 0) {
        spawn()
        spawnTimer = rand(1.5, 5)
      }
      detectConflicts()

      for (const cell of weather) {
        cell.x += cell.vx * simDt
        cell.y += cell.vy * simDt
        if (cell.x - cell.r > sim.x1 + 10) cell.x = sim.x0 - cell.r - 5
      }
    }

    function populate() {
      tracks = []
      callsigns.clear()
      const n = targetCount()
      for (let i = 0; i < n; i++) {
        const t = spawn(i === 0 ? 'arr' : i === 1 ? 'dep' : null)
        if (!t) continue
        // Fast-forward each track a random way along its route so the picture
        // starts populated, with history trails and settled hand-in states.
        const crossing = ((sim.x1 - sim.x0) / (t.gs / 3600)) * 0.75
        const target = rand(0, crossing)
        for (let s = 0; s < target && !t.done; s += 2) updateTrack(t, 2)
      }
      tracks = tracks.filter(t => !t.done)
      ensureTechTracks(() => rand(14, 40))
      for (let i = 0; i < (W < 720 ? 1 : 2); i++) spawnVfr()

      weather = Array.from({ length: W < 720 ? 6 : 12 }, () => {
        const r = rand(5, 11)
        return {
          x: rand(sim.x0, sim.x1), y: rand(sim.y0 + 6, sim.y1 - 6), r,
          vx: Math.sin(70 * DEG) * (24 / 3600), vy: Math.cos(70 * DEG) * (24 / 3600),
          blobs: Array.from({ length: 7 }, () => ({ dx: rand(-r, r) * 0.7, dy: rand(-r, r) * 0.5, r: rand(0.35, 0.75) * r, heavy: Math.random() < 0.3 })),
        }
      })
      detectConflicts()
    }

    /* ------------------------------------------------------------- sweep -- */
    let sweepEl = null
    function sweepAngle(now) {
      if (!sweepEl || !sweepEl.isConnected) sweepEl = hero.querySelector('[aria-label="Animated radar display"] .animate-sweep')
      if (sweepEl) {
        const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(sweepEl).transform)
        if (m) {
          const [a, b] = m[1].split(',').map(parseFloat)
          return Math.atan2(b, a) - Math.PI / 2
        }
      }
      return (now / 1000) * (TAU / 120) - Math.PI / 2
    }

    /* -------------------------------------------------------------- draw -- */
    function drawWeather() {
      for (const cell of weather) {
        for (const blob of cell.blobs) {
          const px = toX(cell.x + blob.dx)
          const py = toY(cell.y + blob.dy)
          const r = blob.r * S
          const [cr, cg, cb] = blob.heavy ? pal.wxHeavy : pal.wxLight
          const g = ctx.createRadialGradient(px, py, 0, px, py, r)
          g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${pal.wxAlpha})`)
          g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`)
          ctx.fillStyle = g
          ctx.fillRect(px - r, py - r, r * 2, r * 2)
        }
      }
    }

    function drawRestrictedBorder() {
      const [r, g, b] = pal.restrict
      const alpha = 0.32 + 0.22 * Math.sin(realTime * 1.4)
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
      ctx.lineWidth = 1.2
      ctx.setLineDash([])
      ctx.beginPath()
      RESTRICTED.poly.forEach(([x, y], i) => (i ? ctx.lineTo(toX(x), toY(y)) : ctx.moveTo(toX(x), toY(y))))
      ctx.closePath()
      ctx.stroke()
    }

    function drawSweep(lead) {
      const reach = Math.hypot(Math.max(Math.abs(OX), Math.abs(W - OX)), Math.max(Math.abs(OY), Math.abs(H - OY)))
      // Sweep is a single line (no filled afterglow fan) to keep the picture clean;
      // targets still paint as it passes (see drawTracks).
      const [r, g, b] = pal.sweep
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${pal.sweepPeak * 2.6})`
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(OX, OY)
      ctx.lineTo(OX + Math.cos(lead) * reach, OY + Math.sin(lead) * reach)
      ctx.stroke()
    }

    function trackColor(t) {
      if (t.conflict) return pal.conflict
      if (t.kind === 'vfr') return pal.vfr
      if (t.state === 'pending') return pal.pending
      if (t.state === 'other') return pal.other
      return pal.assumed
    }

    function drawSelectedRoute(t) {
      ctx.strokeStyle = pal.select
      ctx.globalAlpha = TA * (0.5)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 5])
      ctx.beginPath()
      ctx.moveTo(toX(t.x), toY(t.y))
      const end = Math.min(t.pts.length, t.wi + 4)
      for (let i = t.wi; i < end; i++) ctx.lineTo(toX(t.pts[i][0]), toY(t.pts[i][1]))
      ctx.stroke()
      ctx.setLineDash([])
      for (let i = t.wi; i < end; i++) {
        ctx.beginPath()
        ctx.arc(toX(t.pts[i][0]), toY(t.pts[i][1]), 3, 0, TAU)
        ctx.stroke()
      }
      ctx.globalAlpha = TA * (1)
    }

    function drawTracks(lead, blinkOn) {
      const fs = W < 720 ? 9 : 10
      const lh = fs + 2.5
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.5px'
      ctx.globalAlpha = TA

      // STCA pair lines first so symbols draw over them.
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      for (const t of tracks) {
        if (!t.conflict || t.conflict.cs < t.cs || !shown(t) || !shown(t.conflict)) continue
        ctx.strokeStyle = pal.conflict
        ctx.globalAlpha = TA * (blinkOn ? 0.85 : 0.4)
        ctx.beginPath()
        ctx.moveTo(toX(t.x), toY(t.y))
        ctx.lineTo(toX(t.conflict.x), toY(t.conflict.y))
        ctx.stroke()
      }
      ctx.globalAlpha = TA * (1)
      ctx.setLineDash([])

      if (selected && !selected.done && shown(selected) && hasBlock(selected)) drawSelectedRoute(selected)

      // Label de-confliction: each block takes the first free quadrant.
      const placed = []
      drawnBlocks = []
      const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

      for (const t of tracks) {
        if (!shown(t)) continue // technology tracks: Technology style only
        const px = toX(t.x)
        const py = toY(t.y)
        if (px < -80 || px > W + 80 || py < -80 || py > H + 80) continue
        const color = trackColor(t)

        // Sweep paint: targets glow briefly as the sweep passes.
        const bearingFromHead = Math.atan2(py - OY, px - OX)
        const behind = ((lead - bearingFromHead) % TAU + TAU) % TAU
        t.boost = behind < 0.45 ? 1 - behind / 0.45 : 0

        // History trail
        ctx.fillStyle = color
        t.hist.forEach(([hx, hy], i) => {
          ctx.globalAlpha = TA * (((i + 1) / (t.hist.length + 1)) * 0.55)
          const size = t.kind === 'vfr' ? 1.6 : 2.2
          ctx.fillRect(toX(hx) - size / 2, toY(hy) - size / 2, size, size)
        })
        ctx.globalAlpha = TA * (1)

        // Speed vector (1 minute)
        const vlen = (t.gs / 3600) * VECTOR_SECONDS
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(toX(t.x + Math.sin(t.hdg) * vlen), toY(t.y + Math.cos(t.hdg) * vlen))
        ctx.stroke()

        if (t.boost > 0) {
          ctx.globalAlpha = TA * (t.boost * 0.45)
          ctx.beginPath()
          ctx.arc(px, py, 6 + t.boost * 4, 0, TAU)
          ctx.fill()
          ctx.globalAlpha = TA * (1)
        }

        // Position symbol: square = assumed/controlled, circle = other, + = primary only.
        ctx.lineWidth = 1.4
        if (t.kind === 'vfr') {
          ctx.beginPath()
          ctx.moveTo(px - 4, py)
          ctx.lineTo(px + 4, py)
          ctx.moveTo(px, py - 4)
          ctx.lineTo(px, py + 4)
          ctx.stroke()
        } else if (t.state === 'assumed' || t.conflict) {
          ctx.strokeRect(px - 3.5, py - 3.5, 7, 7)
        } else {
          ctx.beginPath()
          ctx.arc(px, py, 3.6, 0, TAU)
          ctx.stroke()
        }
        if (t === selected && hasBlock(t)) {
          ctx.strokeStyle = pal.select
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(px, py, 11, 0, TAU)
          ctx.stroke()
        }

        // Data block
        if (!layers.labels || !hasBlock(t)) continue
        let lines
        if (t.kind === 'vfr') {
          lines = [[t.squawk, pal.textDim], [`A${String(Math.round(t.alt / 100)).padStart(3, '0')}`, pal.textDim]]
        } else {
          const trend = t.vs > 300 ? '↑' : t.vs < -300 ? '↓' : ' '
          const levels = `${fl(t.alt)}${trend}${Math.abs(t.cfl - t.alt) > 250 ? fl(t.cfl) : ''}`
          let head = t.cs
          if (t.conflict) head += blinkOn ? ' STCA' : ''
          else if (t.handoff) head += blinkOn ? ` ▸${t.handoff}` : ''
          else if (t.state === 'pending') head += ` ◂${t.kind === 'dep' ? 'TWR' : 'IN'}`
          if (t.tech) {
            // Technology data block: CALLSIGN · NAME · ADOPTED · LEVEL · SQUAWK (Mode A).
            const name = t.name.length > 18 ? `${t.name.slice(0, 17)}…` : t.name
            lines = [[head, toneColor(t) || color], [name, pal.text], [`ADPT ${t.from}`, pal.textDim], [`${levels.trimEnd()} A${t.squawk}`, pal.text]]
          } else {
            lines = [[head, color], [levels, pal.text]]
          }
          if (!t.tech && (t.state !== 'other' || t === selected)) lines.push([`${String(Math.round(t.gs / 10)).padStart(2, '0')} ${t.type}`, pal.textDim])
          if (t === selected) {
            const next = t.names.slice(t.wi).find(n => n !== 'HOLD' && POINTS[n] && FIXES[n]) || t.names[t.names.length - 1]
            lines.push([`→ ${next}`, pal.select])
          }
        }
        ctx.font = `600 ${fs}px ${FONT}`
        const blockW = Math.max(...lines.map(([s]) => ctx.measureText(s).width))
        const blockH = lines.length * lh
        const preferSide = px > W - blockW - 40 ? -1 : 1
        const preferDown = py < blockH + 70
        const options = [
          [preferSide, preferDown], [-preferSide, preferDown], [preferSide, !preferDown], [-preferSide, !preferDown],
        ]
        const boxFor = ([sd, dn]) => {
          const bx = px + sd * 16
          const by = py + (dn ? 16 : -16)
          return { sd, dn, bx, by, x: sd > 0 ? bx + 3 : bx - 3 - blockW, y: dn ? by - 2 : by - blockH + 2, w: blockW, h: blockH }
        }
        const choice = options.map(boxFor).find(box => !placed.some(other => overlaps(box, other))) || boxFor(options[0])
        placed.push(choice)
        drawnBlocks.push(t.cs || t.squawk)
        const side = choice.sd
        const down = choice.dn
        const lx = choice.bx
        const ly = choice.by
        ctx.strokeStyle = color
        ctx.globalAlpha = TA * (0.7)
        ctx.lineWidth = 0.9
        ctx.beginPath()
        ctx.moveTo(px + side * 5, py + (down ? 5 : -5))
        ctx.lineTo(lx, ly)
        ctx.stroke()
        ctx.globalAlpha = TA * (1)
        const tx = side > 0 ? lx + 3 : lx - 3 - blockW
        const ty = down ? ly - 2 : ly - blockH + 2
        // Label plate in the hero background colour: keeps the block AA-legible
        // (WCAG 2.2: ≥ 4.5:1) wherever it lands on the map, relief and weather.
        ctx.fillStyle = theme === 'light' ? 'rgba(234, 241, 244, .86)' : 'rgba(6, 27, 44, .86)'
        ctx.fillRect(tx - 3, ty - 2, blockW + 6, blockH + 1)
        lines.forEach(([text, fill], i) => {
          ctx.font = `${i === 0 ? 700 : 500} ${fs}px ${FONT}`
          ctx.fillStyle = fill
          ctx.fillText(text, tx, ty + i * lh)
        })
      }
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
    }

    function draw(now) {
      const cam = syncCamera()
      const camKey = `${cam.k}|${cam.tx}|${cam.ty}`
      // The detail layer is cached and only re-rendered when the camera, style,
      // theme, layers, size or world fade-in change (every frame during a
      // pan/zoom, never at rest).
      const key = `${camKey}|${style}|${Math.round(worldAlpha() * 20)}`
      if (key !== mapKey) {
        // The previous style's snapshot only lines up with an unmoved camera.
        if (fade && fade.cam !== camKey) fade = null
        mapKey = key
        buildMap()
      }
      let p = 1
      if (fade) {
        const t = clamp((now - fade.start) / FADE_MS, 0, 1)
        p = t * t * (3 - 2 * t)
        if (t >= 1) fade = null
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const MA = adjust.map / 100
      const BA = adjust.background / 100
      TA = adjust.traffic / 100
      if (fade) {
        ctx.globalAlpha = (1 - p) * MA
        ctx.drawImage(prevMapCanvas, 0, 0)
      }
      ctx.globalAlpha = p * MA
      ctx.drawImage(mapCanvas, 0, 0)
      ctx.globalAlpha = 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      const lead = sweepAngle(now)
      ctx.globalAlpha = BA
      if (layers.weather) drawWeather()
      ctx.globalAlpha = MA
      if (layers.airspace) drawRestrictedBorder()
      drawSweep(lead)
      ctx.globalAlpha = 1
      drawTracks(lead, reduceMotion.matches || Math.floor(realTime * 2.2) % 2 === 0)

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1 // the legibility mask is never weakened by the sliders
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(maskCanvas, 0, 0)
      ctx.globalCompositeOperation = 'source-over'

      // Background fills go underneath everything. They get a lighter
      // legibility mask (≈55%) so behind the hero copy they blend towards the
      // hero background rather than vanishing.
      const hasBase = style === 'sectors' || style === 'terrain' || style === 'technology' || style === 'geo' || (fade && fade.from !== 'radar' && fade.from !== 'declutter')
      if (!hasBase) return
      baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      baseCtx.globalCompositeOperation = 'source-over'
      baseCtx.globalAlpha = 1
      baseCtx.clearRect(0, 0, W, H)
      // Cross-fade without a see-through dip: a same-style fade (world upgrade)
      // draws the fills once; into an opaque style (terrain/geo rasters) the
      // outgoing fills stay at full strength underneath the incoming ones.
      const styleFade = fade && fade.from !== style
      if (styleFade) {
        const opaqueIncoming = style === 'terrain' || style === 'technology' || style === 'geo'
        renderBase(baseCtx, fade.from, (opaqueIncoming ? 1 : 1 - p) * BA)
      }
      renderBase(baseCtx, style, (styleFade ? p : 1) * BA)
      baseCtx.setTransform(1, 0, 0, 1, 0, 0)
      baseCtx.globalCompositeOperation = 'destination-out'
      baseCtx.globalAlpha = 0.55
      baseCtx.drawImage(maskCanvas, 0, 0)
      baseCtx.globalAlpha = 1
      baseCtx.globalCompositeOperation = 'source-over'
      ctx.globalCompositeOperation = 'destination-over'
      ctx.drawImage(baseCanvas, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    }

    /* ------------------------------------------------------ adjustments -- */
    /** Ease rendered values towards their targets (smooth even when values jump). */
    function easeAdjustments(dt) {
      const k = 1 - Math.exp(-dt / ADJUST_SMOOTHING)
      let gridChanged = false
      for (const a of ADJUSTMENTS) {
        const diff = adjustTarget[a.id] - adjust[a.id]
        if (diff === 0) continue
        adjust[a.id] = Math.abs(diff) < (a.max - a.min) * 0.001 ? adjustTarget[a.id] : adjust[a.id] + diff * k
        if (a.id === 'grid') gridChanged = true
      }
      if (gridChanged) applyGrid()
    }

    /** The backdrop grid is CSS (hero ::before), driven by a custom property. */
    function applyGrid() {
      hero.style.setProperty('--asd-grid', String(Math.round(adjust.grid) / 100))
    }

    function setAdjustment(id, value) {
      const def = ADJUSTMENTS.find(a => a.id === id)
      if (!def || !Number.isFinite(value)) return
      adjustTarget[id] = clamp(value, def.min, def.max)
      if (!shouldRun()) {
        adjust[id] = adjustTarget[id]
        if (id === 'grid') applyGrid()
        requestStaticDraw()
      }
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        try {
          window.localStorage.setItem(ADJUST_KEY, JSON.stringify(adjustTarget))
        } catch {
          // Settings stay for this visit only.
        }
      }, 250)
    }

    /** Switch display style with a cross-fade (instant when motion is reduced). */
    function setStyle(id) {
      if (!STYLE_IDS.has(id) || id === style) return
      if (shouldRun()) {
        prevMapCtx.setTransform(1, 0, 0, 1, 0, 0)
        prevMapCtx.clearRect(0, 0, prevMapCanvas.width, prevMapCanvas.height)
        prevMapCtx.drawImage(mapCanvas, 0, 0)
        const cam = syncCamera()
        fade = { from: style, start: performance.now(), cam: `${cam.k}|${cam.tx}|${cam.ty}` }
      } else {
        fade = null
      }
      style = id
      mapKey = ''
      refined = null
      refineToken++
      scheduleRefine()
      requestStaticDraw()
      for (const fn of styleListeners) fn(style)
    }

    /* -------------------------------------------------------------- loop -- */
    function frame(now) {
      raf = 0
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 0)
      last = now
      realTime += dt
      easeAdjustments(dt)
      update(dt * TIME_SCALE * adjust.speed)

      nextSelect -= dt
      if (nextSelect <= 0) {
        const candidates = tracks.filter(t => t.state === 'assumed' && !t.conflict && shown(t) && hasBlock(t) && edgeDistance(t.x, t.y) > 15)
        selected = candidates.length ? pick(candidates) : null
        nextSelect = rand(10, 16)
      }

      draw(now)
      schedule()
    }

    function shouldRun() {
      return inView && !document.hidden && !reduceMotion.matches
    }

    function schedule() {
      if (!raf && shouldRun()) {
        raf = requestAnimationFrame(frame)
      }
    }

    function refresh() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      last = 0
      if (shouldRun()) schedule()
      else draw(performance.now())
    }

    function applyTheme() {
      theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
      pal = palette(theme === 'light')
      toneCache.clear() // bay palette values differ per theme
      mapKey = ''
      fade = null
      refined = null
      refineToken++
      scheduleRefine()
      buildPreviews()
      requestStaticDraw()
    }

    /** Redraw once when the animation loop is not running (reduced motion, paused). */
    function requestStaticDraw() {
      if (shouldRun() || staticDrawQueued) return
      staticDrawQueued = true
      requestAnimationFrame(now => {
        staticDrawQueued = false
        if (!shouldRun()) draw(now)
      })
    }

    function relayout() {
      const before = { ...view }
      measure()
      // Re-seed traffic only when the visible area changed a lot.
      const changed = Math.abs(before.x1 - before.x0 - (view.x1 - view.x0)) > 20 || Math.abs(before.y1 - before.y0 - (view.y1 - view.y0)) > 20
      if (!tracks.length || changed) populate()
      if (!shouldRun()) draw(performance.now())
    }

    theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    pal = palette(theme === 'light')
    measure()
    populate()
    // Active technology strips (Technology Bays): now, and whenever they change.
    setTechnologies(window.KMActiveTechnologies)
    window.addEventListener('km:active-technologies', event => setTechnologies(event.detail))
    applyGrid()
    refresh()
    buildPreviews()

    // Initial load: the canvas stays hidden (the hero's own backdrop shows) until
    // the first-pass world is ready, then the complete picture fades in once,
    // so a world-dependent default style never flashes as plain radar first.
    const revealed = { done: false }
    function reveal() {
      if (revealed.done) return
      revealed.done = true
      layerEl()?.classList.add('is-ready')
    }
    const layerEl = () => canvas.parentElement

    function adoptWorld(next, { crossfade }) {
      // Swap in a higher-resolution world: detail lines cross-fade (same
      // style), fills simply sharpen.
      if (crossfade && shouldRun() && revealed.done) {
        prevMapCtx.setTransform(1, 0, 0, 1, 0, 0)
        prevMapCtx.clearRect(0, 0, prevMapCanvas.width, prevMapCanvas.height)
        prevMapCtx.drawImage(mapCanvas, 0, 0)
        const cam = syncCamera()
        fade = { from: style, start: performance.now(), cam: `${cam.k}|${cam.tx}|${cam.ty}` }
      }
      world = next
      mapKey = ''
      refined = null
      refineToken++
      scheduleRefine()
      buildPreviews()
      requestStaticDraw()
    }

    if (firstWorld) {
      firstWorld
        .build()
        .then(() => {
          // Present at full strength from the first visible frame (the canvas
          // itself fades in), so there is no second ramp.
          worldReadyAt = performance.now() - WORLD_FADE_MS
          adoptWorld(firstWorld, { crossfade: false })
          requestAnimationFrame(() => requestAnimationFrame(reveal))
          // Full resolution next, in the background.
          const fullWorld = window.KMAsdWorld.create({ ...worldOptions, res: window.innerWidth < 720 ? 2 : 3 })
          return fullWorld.build().then(() => adoptWorld(fullWorld, { crossfade: true }))
        })
        .catch(error => {
          console.error('ASD world generation failed', error)
          reveal()
        })
      // Never keep the background hidden for long, whatever happens.
      window.setTimeout(reveal, 2500)
    } else {
      reveal()
    }

    let resizeQueued = false
    new ResizeObserver(() => {
      if (resizeQueued) return
      resizeQueued = true
      requestAnimationFrame(() => {
        resizeQueued = false
        relayout()
      })
    }).observe(hero)
    // The hero radar and copy animate in; re-measure once they settle.
    window.setTimeout(relayout, 1300)
    document.fonts?.ready?.then(() => {
      mapKey = ''
      requestStaticDraw()
    })
    new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting)
      refresh()
    }).observe(hero)
    document.addEventListener('visibilitychange', refresh)
    reduceMotion.addEventListener?.('change', refresh)

    return {
      /** Display styles (single choice). */
      styles: STYLES.map(s => ({ ...s })),
      get style() {
        return style
      },
      setStyle,
      /** Called with the new style id whenever it changes (from any source). */
      onStyleChange(fn) {
        styleListeners.add(fn)
        return () => styleListeners.delete(fn)
      },
      /** Display adjustments (continuous sliders) with their current values. */
      get adjustments() {
        return ADJUSTMENTS.map(a => ({ ...a, value: adjustTarget[a.id] }))
      },
      setAdjustment,
      /** Back to defaults; returns the adjustment list. */
      resetAdjustments() {
        for (const a of ADJUSTMENTS) setAdjustment(a.id, a.value)
        return ADJUSTMENTS.map(a => ({ ...a }))
      },
      /** Active technologies as traffic (normally fed by the "km:active-technologies" event). */
      setTechnologies,
      /** Callsigns whose data block the last frame drew (diagnostics and tests). */
      get dataBlocks() {
        return [...drawnBlocks]
      },
      /** Read-only snapshot of the technology tracks (diagnostics and tests). */
      technologyTracks() {
        syncCamera()
        return tracks
          .filter(t => t.tech)
          .map(t => ({ id: t.tech, callsign: t.cs, callsignColor: toneColor(t), name: t.name, from: t.from, squawk: t.squawk, alt: Math.round(t.alt), cfl: t.cfl, state: t.state, visible: shown(t), x: Math.round(toX(t.x)), y: Math.round(toY(t.y)) }))
      },
      /** Overlays ("map details"), independent toggles. */
      get details() {
        return DETAILS.map(d => ({ ...d, pressed: layers[d.id] }))
      },
      setLayer(id, on) {
        if (!(id in layers)) return
        layers[id] = Boolean(on)
        mapKey = ''
        requestStaticDraw()
      },
      /** Rendered style previews ({ id: dataURL }); called now and whenever they change. */
      onPreviews(fn) {
        previewListeners.add(fn)
        if (previews) fn(previews)
        return () => previewListeners.delete(fn)
      },
      /** Read-only traffic counts: whole simulation and what is on screen now. */
      stats() {
        syncCamera()
        const visible = tracks.filter(t => onScreen(toX(t.x), toY(t.y)))
        const byKind = list => list.reduce((acc, t) => ({ ...acc, [t.kind]: (acc[t.kind] || 0) + 1 }), {})
        return {
          simulated: tracks.length,
          onScreen: visible.length,
          onScreenByKind: byKind(visible),
          conflicts: visible.filter(t => t.conflict).length,
          style,
          worldReady: Boolean(world?.ready),
          rivers: world?.rivers.length ?? 0,
          refined: Boolean(refined),
        }
      },
      /** Drive the radar from a KMMapViewport camera. */
      attachViewport(next) {
        viewport = next
        viewport.setConstraint(constrainCamera)
        viewport.addEventListener('change', () => {
          requestStaticDraw()
          scheduleRefine()
        })
        requestStaticDraw()
      },
    }
  }

  /** Mounts once per hero; returns the scope API (or the existing one). */
  function mount(hero) {
    if (!hero) return null
    if (hero.kmAsdScope) return hero.kmAsdScope
    let layer = hero.querySelector(':scope > .asd-map-layer')
    if (!layer) {
      layer = document.createElement('div')
      layer.className = 'asd-map-layer'
      hero.prepend(layer)
    }
    layer.removeAttribute('role')
    layer.removeAttribute('aria-label')
    layer.setAttribute('aria-hidden', 'true')
    const canvas = document.createElement('canvas')
    canvas.className = 'asd-scope'
    canvas.setAttribute('aria-hidden', 'true')
    layer.replaceChildren(canvas)
    try {
      // Extend the API object itself: spreading it would freeze its getters.
      const api = createScope(hero, canvas)
      api.layer = layer
      api.canvas = canvas
      hero.kmAsdScope = api
      return api
    } catch (error) {
      console.error('ASD background failed to start', error)
      return null
    }
  }

  window.KMAsdScope = { mount }
})()
