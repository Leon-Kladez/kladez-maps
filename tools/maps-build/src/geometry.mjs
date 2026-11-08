// Контуры пакетов карт: объединение стран (NE admin-0) и субъектов (NE admin-1) с запасом по краю.

/** Запас по краю, градусы (~11 км) — как REGION_BUFFER_DEGREES в admin/app/services/countries_service.ts. */
export const REGION_BUFFER_DEGREES = 0.1

/**
 * @param {import('./regions.mjs').Region} region
 * @param {object} ne0 FeatureCollection Natural Earth admin-0 (поле ISO_A2_EH)
 * @param {object|null} ne1 FeatureCollection Natural Earth admin-1 (поле iso_3166_2); нужен, если в source есть admin1
 * @returns {object} FeatureCollection для `pmtiles extract --region`
 */
export function regionGeometry(region, ne0, ne1, buffer = REGION_BUFFER_DEGREES) {
  const countries = region.source.countries ?? []
  const admin1 = region.source.admin1 ?? []
  const picked = []
  for (const code of countries) {
    // Любой TYPE (в том числе Disputed, Indeterminate): границ не проводим.
    const found = ne0.features.filter((f) => f.properties.ISO_A2_EH === code)
    if (found.length === 0) throw new Error(`${region.id}: страна ${code} не найдена в Natural Earth admin-0`)
    picked.push(...found)
  }
  if (admin1.length > 0) {
    if (!ne1) throw new Error(`${region.id}: нужен файл Natural Earth admin-1`)
    for (const code of admin1) {
      const found = ne1.features.filter((f) => f.properties.iso_3166_2 === code)
      if (found.length === 0) throw new Error(`${region.id}: субъект ${code} не найден в Natural Earth admin-1`)
      picked.push(...found)
    }
  }
  return {
    type: 'FeatureCollection',
    features: picked.map((f) => ({
      type: 'Feature',
      properties: {},
      geometry: clampGeometry(bufferGeometry(f.geometry, buffer)),
    })),
  }
}

// ---- Запас по краю: перенос на JS алгоритма из admin/app/services/countries_service.ts ----

export function bufferGeometry(geometry, buffer = REGION_BUFFER_DEGREES) {
  if (geometry?.type === 'Polygon') return { type: 'Polygon', coordinates: geometry.coordinates.map((r) => bufferRing(r, buffer)) }
  if (geometry?.type === 'MultiPolygon')
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((p) => p.map((r) => bufferRing(r, buffer))) }
  return geometry
}

function bufferRing(ring, buffer) {
  if (ring.length < 4) return ring
  const sign = signedArea(ring) > 0 ? 1 : -1
  const n = ring.length - 1
  const out = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]
    const curr = ring[i]
    const next = ring[(i + 1) % n]
    const l1 = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) || 1
    const l2 = Math.hypot(next[0] - curr[0], next[1] - curr[1]) || 1
    const sumX = ((curr[1] - prev[1]) / l1 + (next[1] - curr[1]) / l2) * sign
    const sumY = (-(curr[0] - prev[0]) / l1 - (next[0] - curr[0]) / l2) * sign
    const sl = Math.hypot(sumX, sumY) || 1
    out.push([curr[0] + (sumX / sl) * buffer, curr[1] + (sumY / sl) * buffer])
  }
  out.push(out[0])
  return out
}

function signedArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return a / 2
}

/** Запас не должен выводить точки за край карты (у Чукотки — за 180°). */
function clampGeometry(geometry) {
  const c = ([x, y]) => [Math.max(-180, Math.min(180, x)), Math.max(-85.0511, Math.min(85.0511, y))]
  if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: geometry.coordinates.map((r) => r.map(c)) }
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((p) => p.map((r) => r.map(c))) }
}

// ---- Точка внутри контура (для тестов и схемы округов) ----

function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygon(pt, rings) {
  return inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h))
}

export function pointInGeometry(pt, fc) {
  return fc.features.some(({ geometry: g }) =>
    g.type === 'Polygon' ? inPolygon(pt, g.coordinates) : g.coordinates.some((p) => inPolygon(pt, p))
  )
}

// ---- Упрощение контуров и схема округов России (для маленькой карты в окне выбора) ----

function perpDist([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(x - x1, y - y1)
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len
}

/** Дуглас — Пекер для незамкнутой линии. */
function dp(points, tol) {
  if (points.length < 3) return points
  let idx = 0
  let max = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points.at(-1))
    if (d > max) [max, idx] = [d, i]
  }
  if (max <= tol) return [points[0], points.at(-1)]
  return [...dp(points.slice(0, idx + 1), tol).slice(0, -1), ...dp(points.slice(idx), tol)]
}

function simplifyRing(ring, tol) {
  // Кольцо режем в самой дальней от начала точке, чтобы не потерять форму целиком.
  let far = 0
  let max = -1
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1])
    if (d > max) [max, far] = [d, i]
  }
  const out = [...dp(ring.slice(0, far + 1), tol).slice(0, -1), ...dp(ring.slice(far), tol)]
  return out.length >= 4 ? out : null
}

const round = (ring) => ring.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])

/** Упрощает контур; кольца, выродившиеся в точку или отрезок, отбрасываются. */
export function simplifyGeometry(geometry, tol) {
  const poly = (rings) => {
    const outer = simplifyRing(rings[0], tol)
    if (!outer) return null
    return [round(outer), ...rings.slice(1).map((r) => simplifyRing(r, tol)).filter(Boolean).map(round)]
  }
  if (geometry.type === 'Polygon') {
    const p = poly(geometry.coordinates)
    return p ? { type: 'Polygon', coordinates: p } : null
  }
  const ps = geometry.coordinates.map(poly).filter(Boolean)
  return ps.length ? { type: 'MultiPolygon', coordinates: ps } : null
}

/** Схема федеральных округов: субъекты без запаса по краю, упрощённые, с properties.id округа. */
export function districtSchema(regions, ne0, ne1, tol = 0.05) {
  const features = []
  for (const region of regions.filter((r) => r.group === 'russia')) {
    const fc = regionGeometry(region, ne0, ne1, 0)
    for (const f of fc.features) {
      const geometry = simplifyGeometry(f.geometry, tol)
      if (geometry) features.push({ type: 'Feature', properties: { id: region.id }, geometry })
    }
  }
  return { type: 'FeatureCollection', features }
}
