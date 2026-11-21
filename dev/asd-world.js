/*
 * KMAsdWorld: deterministic, procedurally generated geography for the ASD.
 *
 * One seeded world (NM coordinates, +x east, +y north) shared by every map
 * style so the coastline never jumps when switching styles:
 *   - elevation field (ft): coastal plain, hills, two mountain ranges, lakes,
 *     sea bathymetry, a flattened area around the airport;
 *   - vector features: coastline + lake shores, land contours (1000 ft, index
 *     every 5000 ft), depth contours, rivers (steepest-descent flow), towns,
 *     urban areas, roads, spot heights and the airport MSA (25 NM, 4 sectors,
 *     highest terrain + 1000 ft rounded up to 100 ft);
 *   - hypsometric + hill-shaded rasters per style/theme, plus on-demand
 *     high-resolution "refine" rasters for the visible area when zoomed in.
 *
 * Generation is time-sliced (cooperative generators) so it never blocks the
 * animation. Exposes window.KMAsdWorld.create(options) → world.
 */
(() => {
  'use strict'

  const FT_PER_NM = 6076

  /* --------------------------------------------------------- noise -------- */
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function makeNoise(seed) {
    const rand = mulberry32(seed)
    const p = Array.from({ length: 256 }, (_, i) => i)
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[p[i], p[j]] = [p[j], p[i]]
    }
    const perm = new Uint8Array(512)
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
    const gx = new Float32Array(256)
    const gy = new Float32Array(256)
    for (let i = 0; i < 256; i++) {
      const a = rand() * Math.PI * 2
      gx[i] = Math.cos(a)
      gy[i] = Math.sin(a)
    }
    // 2D gradient (Perlin) noise, roughly in [-1, 1].
    return (x, y) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const xf = x - xi
      const yf = y - yi
      const X = xi & 255
      const Y = yi & 255
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
      const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
      const aa = perm[perm[X] + Y]
      const ab = perm[perm[X] + Y + 1]
      const ba = perm[perm[X + 1] + Y]
      const bb = perm[perm[X + 1] + Y + 1]
      const n00 = gx[aa] * xf + gy[aa] * yf
      const n10 = gx[ba] * (xf - 1) + gy[ba] * yf
      const n01 = gx[ab] * xf + gy[ab] * (yf - 1)
      const n11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1)
      const x1 = n00 + u * (n10 - n00)
      const x2 = n01 + u * (n11 - n01)
      return (x1 + v * (x2 - x1)) * 1.41
    }
  }

  const fbm = (n, x, y, octaves) => {
    let sum = 0
    let amp = 0.5
    let f = 1
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += n(x * f, y * f) * amp
      norm += amp
      amp *= 0.5
      f *= 2.03
    }
    return sum / norm
  }

  const ridged = (n, x, y, octaves) => {
    let sum = 0
    let amp = 0.5
    let f = 1
    let weight = 1
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      let r = 1 - Math.abs(n(x * f, y * f))
      r *= r * weight
      weight = Math.min(1, r * 1.6)
      sum += r * amp
      norm += amp
      amp *= 0.5
      f *= 2.1
    }
    return sum / norm
  }

  const smoothstep = (a, b, t) => {
    const x = Math.max(0, Math.min(1, (t - a) / (b - a)))
    return x * x * (3 - 2 * x)
  }

  /* ---------------------------------------------------- slicing driver ---- */
  /** Runs a generator in ~budget ms slices between frames; resolves its return value. */
  function runSliced(gen, budget = 7) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel()
      const step = () => {
        const end = performance.now() + budget
        try {
          while (performance.now() < end) {
            const r = gen.next()
            if (r.done) {
              resolve(r.value)
              return
            }
          }
        } catch (error) {
          reject(error)
          return
        }
        // Yield to rendering, then continue.
        requestAnimationFrame(() => channel.port2.postMessage(0))
      }
      channel.port1.onmessage = step
      step()
    })
  }

  /* ---------------------------------------------------------- colour ------ */
  const RAMPS = {
    terrain: {
      dark: {
        water: [[0, 9, 32, 52], [600, 6, 24, 42], [3000, 3, 14, 28]],
        land: [[0, 15, 40, 40], [800, 18, 46, 40], [2500, 33, 50, 38], [5000, 52, 52, 40], [8000, 66, 60, 50], [11000, 82, 80, 74]],
      },
      light: {
        water: [[0, 206, 228, 240], [600, 188, 214, 232], [3000, 164, 196, 222]],
        land: [[0, 214, 234, 212], [800, 224, 236, 204], [2500, 234, 228, 192], [5000, 222, 204, 170], [8000, 206, 188, 166], [11000, 238, 234, 228]],
      },
    },
    geo: {
      dark: {
        water: [[0, 6, 26, 48], [800, 4, 18, 37], [3000, 3, 12, 26]],
        land: [[0, 22, 40, 47], [3000, 25, 43, 49], [11000, 30, 47, 53]],
      },
      light: {
        water: [[0, 196, 222, 240], [800, 182, 210, 232], [3000, 166, 198, 224]],
        land: [[0, 242, 240, 232], [6000, 236, 233, 222], [11000, 230, 228, 220]],
      },
    },
  }

  function ramp(stops, v) {
    if (v <= stops[0][0]) return stops[0]
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const a = stops[i - 1]
        const b = stops[i]
        const t = (v - a[0]) / (b[0] - a[0])
        return [0, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
      }
    }
    return stops[stops.length - 1]
  }

  /* ----------------------------------------------------------- world ------ */
  function create(options = {}) {
    const seed = options.seed ?? 20251120
    const res = options.res ?? 3 // raster samples per NM
    const bounds = options.bounds ?? { x0: -260, x1: 220, y0: -170, y1: 170 }
    const coast = (options.coast ?? []).slice().sort((a, b) => a[0] - b[0])
    const airport = options.airport ?? [34, -20]

    const nWarp = makeNoise(seed + 1)
    const nHill = makeNoise(seed + 2)
    const nRidge = makeNoise(seed + 3)
    const nSea = makeNoise(seed + 4)
    const nDetail = makeNoise(seed + 5)
    const rand = mulberry32(seed + 9)

    // Mountain ranges: one in the default view right of the hero copy, one
    // behind it (faded by the legibility mask), more beyond for zoom-out.
    const RANGES = [
      { x: 28, y: 32, rx: 34, ry: 14, h: 8200 },
      { x: -78, y: 40, rx: 40, ry: 14, h: 6200 },
      { x: -170, y: 44, rx: 50, ry: 24, h: 7400 },
      { x: 150, y: 0, rx: 40, ry: 30, h: 5600 },
      { x: 4, y: 70, rx: 36, ry: 14, h: 5000 },
    ]
    const LAKES = [
      { x: -40, y: 18, r: 4.2, depth: 2400 },
      { x: 8, y: 16, r: 3.4, depth: 2200 },
      { x: -14, y: 50, r: 5.5, depth: 3200 },
      { x: 74, y: 14, r: 3, depth: 2400 },
      { x: -150, y: 20, r: 4.5, depth: 2400 },
      { x: 30, y: 4, r: 2.6, depth: 1800 },
    ]

    function coastY(x) {
      if (!coast.length) return bounds.y0
      if (x <= coast[0][0]) return coast[0][1]
      for (let i = 1; i < coast.length; i++) {
        if (x <= coast[i][0]) {
          const [ax, ay] = coast[i - 1]
          const [bx, by] = coast[i]
          return ay + ((by - ay) * (x - ax)) / (bx - ax)
        }
      }
      return coast[coast.length - 1][1]
    }

    /** Elevation in ft (negative = water depth). `cy` = coastY(x) when known. */
    function heightAt(x, y, cy = coastY(x)) {
      const d = y - cy + fbm(nWarp, x * 0.018, y * 0.018, 4) * 9
      if (d < 0) {
        return -(Math.pow(-d, 0.85) * 28 + 30 + (fbm(nSea, x * 0.05, y * 0.05, 3) * 0.5 + 0.5) * 40)
      }
      const inland = Math.min(1, d / 18)
      const flat = smoothstep(5, 24, Math.hypot(x - airport[0], y - airport[1]))
      let e = Math.pow(d, 0.75) * 22 + 15
      const h = fbm(nHill, x * 0.04, y * 0.04, 5) * 0.5 + 0.5
      e += h * h * 2600 * inland * flat
      for (const r of RANGES) {
        const qx = (x - r.x) / r.rx
        const qy = (y - r.y) / r.ry
        const w = Math.exp(-(qx * qx + qy * qy) * 1.4)
        if (w > 0.01) e += ridged(nRidge, x * 0.032, y * 0.032, 5) * r.h * w * inland * flat
      }
      e += fbm(nDetail, x * 0.22, y * 0.22, 2) * 70 * inland
      for (const l of LAKES) {
        // Irregular shorelines: the basin radius wobbles with direction and noise.
        const dx = x - l.x
        const dy = y - l.y
        const d2 = dx * dx + dy * dy
        if (d2 > l.r * l.r * 6) continue
        const a = Math.atan2(dy, dx)
        const wobble = 1 + 0.32 * Math.sin(a * 3 + l.x) + 0.22 * fbm(nWarp, x * 0.35 + l.y, y * 0.35, 3)
        const r = l.r * Math.max(0.45, wobble)
        e -= l.depth * Math.exp(-(d2 / (r * r)) * 1.5)
      }
      return e
    }

    const world = {
      bounds,
      res,
      heightAt,
      ready: false,
      cols: Math.round((bounds.x1 - bounds.x0) * res) + 1,
      rows: Math.round((bounds.y1 - bounds.y0) * res) + 1,
      heights: null,
      contours: [],
      rivers: [],
      towns: [],
      roads: [],
      peaks: [],
      msa: null,
      rasters: new Map(),
      airport,
    }

    /* ---------------------------------------------------- heightfield ----- */
    function* buildHeights() {
      const { cols, rows } = world
      const h = new Float32Array(cols * rows)
      const coastCol = new Float32Array(cols)
      for (let c = 0; c < cols; c++) coastCol[c] = coastY(bounds.x0 + c / res)
      for (let r = 0; r < rows; r++) {
        const y = bounds.y1 - r / res
        const row = r * cols
        for (let c = 0; c < cols; c++) h[row + c] = heightAt(bounds.x0 + c / res, y, coastCol[c])
        if ((r & 3) === 0) yield
      }
      world.heights = h
    }

    const sample = (c, r) => world.heights[Math.max(0, Math.min(world.rows - 1, r)) * world.cols + Math.max(0, Math.min(world.cols - 1, c))]

    /* ------------------------------------------------------- contours ----- */
    const TILE = 32 // NM

    function* buildContours() {
      const sets = [
        { level: 0, kind: 'coast', stride: 1 },
        { level: -600, kind: 'depth', stride: 2 },
        { level: -1500, kind: 'depth', stride: 3 },
      ]
      let max = 0
      for (let i = 0; i < world.heights.length; i += 7) max = Math.max(max, world.heights[i])
      for (let level = 1000; level < max; level += 1000) sets.push({ level, kind: level % 5000 === 0 ? 'index' : 'land', stride: 2 })

      for (const set of sets) {
        const tiles = new Map()
        const push = (x1, y1, x2, y2) => {
          const key = `${Math.floor((x1 + x2) / 2 / TILE)},${Math.floor((y1 + y2) / 2 / TILE)}`
          let arr = tiles.get(key)
          if (!arr) tiles.set(key, (arr = []))
          arr.push(x1, y1, x2, y2)
        }
        const s = set.stride
        const L = set.level
        const step = s / res
        for (let r = 0; r + s < world.rows; r += s) {
          const y0 = bounds.y1 - r / res
          for (let c = 0; c + s < world.cols; c += s) {
            const a = sample(c, r) // top-left
            const b = sample(c + s, r) // top-right
            const cc = sample(c + s, r + s) // bottom-right
            const d = sample(c, r + s) // bottom-left
            const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (d > L ? 1 : 0)
            if (idx === 0 || idx === 15) continue
            const x0 = bounds.x0 + c / res
            const lerp = (p, q) => (L - p) / (q - p)
            const top = [x0 + step * lerp(a, b), y0]
            const right = [x0 + step, y0 - step * lerp(b, cc)]
            const bottom = [x0 + step * lerp(d, cc), y0 - step]
            const left = [x0, y0 - step * lerp(a, d)]
            const seg = (p, q) => push(p[0], p[1], q[0], q[1])
            switch (idx) {
              case 1: case 14: seg(left, bottom); break
              case 2: case 13: seg(bottom, right); break
              case 3: case 12: seg(left, right); break
              case 4: case 11: seg(top, right); break
              case 6: case 9: seg(top, bottom); break
              case 7: case 8: seg(left, top); break
              case 5: seg(left, top); seg(bottom, right); break
              case 10: seg(top, right); seg(left, bottom); break
            }
          }
          if ((r & 7) === 0) yield
        }
        const packed = new Map()
        for (const [key, arr] of tiles) packed.set(key, new Float32Array(arr))
        world.contours.push({ level: set.level, kind: set.kind, tiles: packed })
        yield
      }
    }

    /** Visible-tile iterator for contour sets (world rect in NM). */
    world.contourTiles = (set, x0, y0, x1, y1) => {
      const out = []
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
        for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
          const t = set.tiles.get(`${tx},${ty}`)
          if (t) out.push(t)
        }
      }
      return out
    }

    /* --------------------------------------------- peaks, rivers, towns --- */
    function findPeaks() {
      const stride = Math.max(1, Math.round(res * 2))
      const radius = 4
      const found = []
      for (let r = radius * stride; r < world.rows - radius * stride; r += stride) {
        for (let c = radius * stride; c < world.cols - radius * stride; c += stride) {
          const e = sample(c, r)
          if (e < 2600) continue
          let top = true
          for (let dr = -radius; dr <= radius && top; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
              if ((dr || dc) && sample(c + dc * stride, r + dr * stride) > e) {
                top = false
                break
              }
            }
          }
          if (top) found.push({ x: bounds.x0 + c / res, y: bounds.y1 - r / res, e })
        }
      }
      found.sort((a, b) => b.e - a.e)
      const peaks = []
      for (const p of found) {
        if (peaks.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 20)) peaks.push(p)
        if (peaks.length >= 14) break
      }
      world.peaks = peaks
    }

    function* buildRivers() {
      const sources = []
      // Hill sources on a coarse grid (deterministic), then mountain flanks.
      const grid = []
      for (let x = bounds.x0 + 20; x < bounds.x1 - 20; x += 9) {
        for (let y = bounds.y0 + 20; y < bounds.y1 - 20; y += 9) {
          const e = heightAt(x, y)
          if (e > 1100 && e < 5200) grid.push([x, y, rand()])
        }
      }
      grid.sort((a, b) => a[2] - b[2])
      for (const [x, y] of grid) {
        if (sources.length >= 22) break
        if (sources.every(s => Math.hypot(s[0] - x, s[1] - y) > 22)) sources.push([x, y])
      }
      for (const p of world.peaks) {
        // Start a little off each summit, on its flank.
        for (const a of [0.7, 3.4]) {
          const x = p.x + Math.cos(a + rand()) * 6
          const y = p.y + Math.sin(a + rand()) * 6
          const e = heightAt(x, y)
          if (e > 1800 && sources.every(s => Math.hypot(s[0] - x, s[1] - y) > 16)) sources.push([x, y])
        }
      }
      const rivers = []
      for (const [sx, sy] of sources) {
        let x = sx
        let y = sy
        let e = heightAt(x, y)
        const pts = [[x, y]]
        // Flow follows the broad slope (wide gradient stencil ignores micro
        // relief), keeps momentum so it carves through small dips, meanders,
        // and drifts gently seaward (the sea lies to the south).
        let vx = 0
        let vy = -1
        for (let i = 0; i < 1400; i++) {
          const g = 1.4
          const gx = heightAt(x + g, y) - heightAt(x - g, y)
          const gy = heightAt(x, y + g) - heightAt(x, y - g)
          const glen = Math.hypot(gx, gy) || 1
          const meander = nWarp(x * 0.25, y * 0.25) * 0.5
          let dx = -gx / glen
          let dy = -gy / glen
          ;[dx, dy] = [dx * Math.cos(meander) - dy * Math.sin(meander), dx * Math.sin(meander) + dy * Math.cos(meander)]
          vx = vx * 0.72 + dx * 0.24
          vy = vy * 0.72 + dy * 0.24 - 0.1
          const vlen = Math.hypot(vx, vy) || 1
          vx /= vlen
          vy /= vlen
          x += vx * 0.45
          y += vy * 0.45
          e = heightAt(x, y)
          if (i % 3 === 0) pts.push([x, y])
          if (e < 0 || x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) break
        }
        pts.push([x, y])
        const length = pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)
        if (e < 0 && length > 12) rivers.push(chaikin(chaikin(pts)))
        yield
      }
      world.rivers = rivers
    }

    function chaikin(pts) {
      const out = [pts[0]]
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[i + 1]
        out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75])
      }
      out.push(pts[pts.length - 1])
      return out
    }

    function buildTowns() {
      const TOWNS = [
        { name: 'KESTREL', x: 27, y: -27, size: 1 },
        { name: 'PORT ARDELL', x: -42, y: -30, size: 0.85 },
        { name: 'HALDEN', x: -70, y: 8, size: 0.6 },
        { name: 'LINTON', x: -6, y: 2, size: 0.55 },
        { name: 'VEY', x: 62, y: 20, size: 0.45 },
        { name: 'CARRICK', x: -108, y: 0, size: 0.7 },
        { name: 'MARROW BAY', x: 84, y: -54, size: 0.75 },
        { name: 'OSTRAN', x: -150, y: 6, size: 0.6 },
        { name: 'BRAYE', x: 120, y: 22, size: 0.5 },
      ]
      for (const t of TOWNS) {
        for (let i = 0; i < 40 && heightAt(t.x, t.y) < 40; i++) t.y += 1 // keep towns on land
        const r = mulberry32(Math.round(t.x * 31 + t.y * 17))
        // Built-up area: an irregular outline around the centre (NM offsets).
        const radius = 2.2 + t.size * 3.4
        const phase = r() * 10
        t.area = Array.from({ length: 22 }, (_, i) => {
          const a = (i / 22) * Math.PI * 2
          const k = 0.62 + 0.28 * Math.sin(a * 2 + phase) + 0.22 * nWarp(t.x * 0.2 + Math.cos(a) * 1.4, t.y * 0.2 + Math.sin(a) * 1.4) + (r() - 0.5) * 0.18
          return [Math.cos(a) * radius * k * 1.25, Math.sin(a) * radius * k * 0.9]
        })
      }
      world.towns = TOWNS
      const byName = Object.fromEntries(TOWNS.map(t => [t.name, t]))
      const LINKS = [
        ['KESTREL', 'LINTON', 'motorway'], ['LINTON', 'HALDEN', 'motorway'], ['HALDEN', 'CARRICK', 'motorway'], ['CARRICK', 'OSTRAN', 'road'],
        ['KESTREL', 'PORT ARDELL', 'road'], ['KESTREL', 'VEY', 'road'], ['VEY', 'BRAYE', 'road'], ['KESTREL', 'MARROW BAY', 'road'], ['PORT ARDELL', 'CARRICK', 'road'],
      ]
      world.roads = LINKS.map(([a, b, kind]) => {
        const A = byName[a]
        const B = byName[b]
        const pts = []
        const n = 6
        const len = Math.hypot(B.x - A.x, B.y - A.y)
        const px = -(B.y - A.y) / len
        const py = (B.x - A.x) / len
        for (let i = 0; i <= n; i++) {
          const t = i / n
          const bend = i === 0 || i === n ? 0 : nWarp(A.x * 0.1 + t * 3, A.y * 0.1) * len * 0.08
          pts.push([A.x + (B.x - A.x) * t + px * bend, A.y + (B.y - A.y) * t + py * bend])
        }
        return { kind, pts: chaikin(chaikin(pts)) }
      })
    }

    function buildMsa() {
      // Minimum sector altitude: 25 NM + 5 NM buffer, 1000 ft above the highest terrain, rounded up to 100 ft.
      const SECTORS = [[315, 45], [45, 135], [135, 225], [225, 315]]
      const [ax, ay] = airport
      const highest = SECTORS.map(() => 0)
      // Angular distance (deg) from a bearing to a sector's arc; 0 when inside.
      const outside = (deg, from, to) => {
        const span = (to - from + 360) % 360
        const rel = (deg - from + 360) % 360
        return rel <= span ? 0 : Math.min(rel - span, 360 - rel)
      }
      for (let rr = 0; rr <= 30; rr += 0.5) {
        for (let deg = 0; deg < 360; deg += 2) {
          const x = ax + Math.sin(deg * Math.PI / 180) * rr
          const y = ay + Math.cos(deg * Math.PI / 180) * rr
          const e = heightAt(x, y)
          SECTORS.forEach(([from, to], i) => {
            // Sector out to 30 NM (25 + 5 NM buffer), widened ~10° for the lateral buffer.
            if (outside(deg, from, to) <= 10) highest[i] = Math.max(highest[i], e)
          })
        }
      }
      world.msa = { center: airport, radius: 25, sectors: SECTORS.map(([from, to], i) => ({ from, to, alt: Math.max(1500, Math.ceil((highest[i] + 1000) / 100) * 100) })) }
    }

    /* --------------------------------------------------------- rasters ---- */
    function shadeAt(hl, hr, hu, hd, cellFt) {
      // Hillshade, light from the north-west at 45°, 3× vertical exaggeration.
      const dzdx = ((hr - hl) * 3) / (2 * cellFt)
      const dzdy = ((hu - hd) * 3) / (2 * cellFt)
      const nx = -dzdx
      const ny = -dzdy
      const nz = 1
      const len = Math.hypot(nx, ny, nz)
      const lx = -0.5
      const ly = 0.5
      const lz = 0.7071
      return (nx * lx + ny * ly + nz * lz) / len / 0.7071
    }

    function colorize(e, shade, style, theme) {
      const rampSet = RAMPS[style][theme]
      if (e < 0) {
        const c = ramp(rampSet.water, -e)
        return [c[1], c[2], c[3]]
      }
      const c = ramp(rampSet.land, e)
      const strength = style === 'terrain' ? (theme === 'dark' ? 0.55 : 0.32) : theme === 'dark' ? 0.22 : 0.12
      const s = 1 + (shade - 1) * strength
      return [c[1] * s, c[2] * s, c[3] * s]
    }

    /** Full-world raster for a style/theme (generator; cached). */
    function* buildRaster(style, theme) {
      const { cols, rows } = world
      const canvas = document.createElement('canvas')
      canvas.width = cols
      canvas.height = rows
      const ctx = canvas.getContext('2d')
      const img = ctx.createImageData(cols, rows)
      const data = img.data
      const cellFt = FT_PER_NM / res
      const fadeCells = 15 * res // soft edge so the world never ends in a hard line
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const e = sample(c, r)
          const shade = e < 0 ? 1 : shadeAt(sample(c - 1, r), sample(c + 1, r), sample(c, r - 1), sample(c, r + 1), cellFt)
          const [R, G, B] = colorize(e, shade, style, theme)
          const i = (r * cols + c) * 4
          const edge = Math.min(c, r, cols - 1 - c, rows - 1 - r)
          data[i] = R
          data[i + 1] = G
          data[i + 2] = B
          data[i + 3] = edge >= fadeCells ? 255 : Math.round(255 * smoothstep(0, fadeCells, edge))
        }
        if ((r & 15) === 0) yield
      }
      ctx.putImageData(img, 0, 0)
      world.rasters.set(`${style}:${theme}`, canvas)
    }

    world.raster = (style, theme) => world.rasters.get(`${style}:${theme}`) || null

    /**
     * High-resolution raster of a world rectangle (for zoomed-in detail).
     * Generator; returns { canvas, x0, y0, x1, y1 }.
     */
    world.refine = function* (style, theme, x0, y0, x1, y1, pxPerNm) {
      const cols = Math.max(2, Math.round((x1 - x0) * pxPerNm))
      const rows = Math.max(2, Math.round((y1 - y0) * pxPerNm))
      const h = new Float32Array((cols + 2) * (rows + 2))
      const coastCol = new Float32Array(cols + 2)
      for (let c = 0; c < cols + 2; c++) coastCol[c] = coastY(x0 + (c - 1) / pxPerNm)
      for (let r = 0; r < rows + 2; r++) {
        const y = y1 - (r - 1) / pxPerNm
        for (let c = 0; c < cols + 2; c++) h[r * (cols + 2) + c] = heightAt(x0 + (c - 1) / pxPerNm, y, coastCol[c])
        if ((r & 3) === 0) yield
      }
      const canvas = document.createElement('canvas')
      canvas.width = cols
      canvas.height = rows
      const ctx = canvas.getContext('2d')
      const img = ctx.createImageData(cols, rows)
      const data = img.data
      const cellFt = FT_PER_NM / pxPerNm
      const at = (c, r) => h[r * (cols + 2) + c]
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const e = at(c + 1, r + 1)
          const shade = e < 0 ? 1 : shadeAt(at(c, r + 1), at(c + 2, r + 1), at(c + 1, r), at(c + 1, r + 2), cellFt)
          const [R, G, B] = colorize(e, shade, style, theme)
          const i = (r * cols + c) * 4
          data[i] = R
          data[i + 1] = G
          data[i + 2] = B
          data[i + 3] = 255
        }
        if ((r & 15) === 0) yield
      }
      ctx.putImageData(img, 0, 0)
      return { canvas, x0, y0, x1, y1 }
    }

    /* ----------------------------------------------------------- build ---- */
    world.progress = 0
    world.build = () =>
      runSliced(
        (function* () {
          yield* buildHeights()
          world.progress = 0.4
          findPeaks()
          yield* buildContours()
          world.progress = 0.65
          // A quick low-resolution "first pass" world can skip rivers and limit
          // which style/theme rasters it builds (options.skipRivers / .styles).
          if (!options.skipRivers) yield* buildRivers()
          buildTowns()
          buildMsa()
          world.progress = 0.75
          for (const style of options.styles ?? ['terrain', 'geo']) {
            for (const theme of options.themeOrder ?? ['dark', 'light']) yield* buildRaster(style, theme)
          }
          world.progress = 1
          world.ready = true
          return world
        })(),
      )

    world.runSliced = runSliced
    return world
  }

  window.KMAsdWorld = { create }
})()
