#!/usr/bin/env node
// Контуры регионов для указателей поиска — те же, что у карт (Natural Earth, запас по краю).
// Для `osmium extract`: один объект MultiPolygon на файл, плюс общий файл настроек вырезки.
//
//   node outlines.mjs --group russia --out work [--only ru-central,ru-south]
//     → work/<id>.geojson и work/extract.json (вывод в work/pbf/<id>.osm.pbf)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadRegions } from '../maps-build/src/regions.mjs'
import { fetchAdmin1, NE_ADMIN0_PATH } from '../maps-build/src/geodata.mjs'
import { regionGeometry } from '../maps-build/src/geometry.mjs'

/** FeatureCollection из многих (Multi)Polygon → один Feature MultiPolygon. */
export function toSingleMultiPolygon(fc) {
  const polys = []
  for (const f of fc.features) {
    const g = f.geometry
    if (g?.type === 'Polygon') polys.push(g.coordinates)
    else if (g?.type === 'MultiPolygon') polys.push(...g.coordinates)
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } }
}

async function main() {
  const { values: o } = parseArgs({ options: { group: { type: 'string' }, out: { type: 'string' }, only: { type: 'string' } } })
  if (!o.group || !o.out) throw new Error('нужны --group и --out')
  const only = o.only ? new Set(o.only.split(',').map((s) => s.trim()).filter(Boolean)) : null
  const regionsPath = fileURLToPath(new URL('../maps-build/regions.json', import.meta.url))
  const regions = loadRegions(regionsPath).filter((r) => r.group === o.group && (!only || only.has(r.id)))
  if (regions.length === 0) throw new Error(`нет регионов: ${o.group} ${o.only ?? ''}`)
  mkdirSync(join(o.out, 'pbf'), { recursive: true })
  const ne0 = JSON.parse(readFileSync(NE_ADMIN0_PATH, 'utf8'))
  const needsAdmin1 = regions.some((r) => (r.source.admin1 ?? []).length > 0)
  const ne1 = needsAdmin1 ? JSON.parse(readFileSync(await fetchAdmin1(join(o.out, 'geodata')), 'utf8')) : null
  const extracts = []
  for (const r of regions) {
    const file = join(o.out, `${r.id}.geojson`)
    writeFileSync(file, JSON.stringify(toSingleMultiPolygon(regionGeometry(r, ne0, ne1))))
    extracts.push({ output: `${r.id}.osm.pbf`, polygon: { file_name: file, file_type: 'geojson' } })
  }
  writeFileSync(join(o.out, 'extract.json'), JSON.stringify({ directory: join(o.out, 'pbf'), extracts }, null, 1))
  console.log(regions.map((r) => r.id).join(' '))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
