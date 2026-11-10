// Список пакетов карт Кладезя (tools/maps-build/regions.json) и его проверка.
import { readFileSync } from 'node:fs'

export const GROUPS = ['russia', 'cis', 'europe', 'middle-east', 'north-america']
export const VARIANTS = ['full', 'overview']
/** Подробность варианта → наибольший масштаб вырезки. */
export const VARIANT_MAXZOOM = { full: 15, overview: 13 }

const ID_RE = /^[a-z0-9-]+$/
const ISO2_RE = /^[A-Z]{2}$/

/**
 * @typedef {{ id: string, title: string, group: string, country: string, contents?: string,
 *   source: { countries?: string[], admin1?: string[] }, variants: ('full'|'overview')[],
 *   maps?: boolean, parent?: string }} Region
 *
 * maps: false — регион без своей карты (слишком большой — карта частями), но с указателем поиска и
 * дорогами; parent — часть такого региона: карта своя, указатель поиска и дороги — от родителя.
 */

/** Регионы, у которых есть своя карта. */
export function mapRegions(regions) {
  return regions.filter((r) => r.maps !== false)
}

/** @returns {Region[]} */
export function loadRegions(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const regions = data.regions
  if (!Array.isArray(regions) || regions.length === 0) throw new Error(`${path}: нет списка regions`)
  validateRegions(regions)
  return regions
}

export function validateRegions(regions) {
  const seen = new Set()
  for (const r of regions) {
    const id = r?.id
    const fail = (why) => {
      throw new Error(`регион ${id ?? '?'}: ${why}`)
    }
    if (typeof id !== 'string' || !ID_RE.test(id)) fail('id должен быть вида [a-z0-9-]+')
    if (id.endsWith('-overview')) fail('id не может кончаться на -overview (это имя обзорного варианта)')
    if (seen.has(id)) fail('повторный id')
    seen.add(id)
    if (r.maps !== undefined && typeof r.maps !== 'boolean') fail('maps — true или false')
    if (r.parent !== undefined && !regions.some((x) => x.id === r.parent && x.maps === false))
      fail(`parent ${r.parent}: нет такого региона с maps: false`)
    if (typeof r.title !== 'string' || !r.title.trim()) fail('нет title')
    if (!GROUPS.includes(r.group)) fail(`неизвестная группа ${r.group}`)
    if (typeof r.country !== 'string' || !ISO2_RE.test(r.country)) fail('country — двухбуквенный код ISO')
    const countries = r.source?.countries ?? []
    const admin1 = r.source?.admin1 ?? []
    if (!Array.isArray(countries) || !Array.isArray(admin1)) fail('source.countries и source.admin1 — массивы')
    if (countries.length + admin1.length === 0) fail('пустой source')
    if (countries.some((c) => !ISO2_RE.test(c))) fail('source.countries — коды ISO из двух букв')
    if (!Array.isArray(r.variants) || r.variants.length === 0 || r.variants.some((v) => !VARIANTS.includes(v)))
      fail(`variants — непустой список из ${VARIANTS.join(', ')}`)
  }
}
