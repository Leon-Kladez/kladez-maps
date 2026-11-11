import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadRegions } from '../maps-build/src/regions.mjs'
import { GEOFABRIK, plan } from './plan.mjs'

const regions = loadRegions(fileURLToPath(new URL('../maps-build/regions.json', import.meta.url)))

test('Европа: у каждой страны есть файл Geofabrik, у нарезанных — указатель на часть', () => {
  const jobs = plan(regions, 'europe')
  const all = jobs.flatMap((j) => j.regions.split(','))
  // Части, а не страна без своей карты.
  assert.ok(all.includes('fr-north') && !all.includes('fr'))
  assert.ok(all.includes('de-south'))
  // Каждый регион — ровно в одном задании.
  assert.equal(new Set(all).size, all.length)
  for (const r of regions.filter((x) => x.group === 'europe')) assert.ok(GEOFABRIK[r.country], r.country)
})

test('Европа: один файл Geofabrik — одно задание (Сан-Марино и Ватикан — с Италией)', () => {
  const italy = plan(regions, 'europe').find((j) => j.sources === 'europe/italy')
  assert.equal(italy.key, 'italy')
  for (const id of ['sm', 'va', 'it-northwest', 'it-south']) assert.ok(italy.regions.split(',').includes(id), id)
  const gb = plan(regions, 'europe').find((j) => j.key === 'great-britain')
  assert.equal(gb.sources, 'europe/great-britain europe/ireland-and-northern-ireland')
})

test('Европа: только выбранные страны или регионы', () => {
  assert.deepEqual(plan(regions, 'europe', new Set(['fr'])).map((j) => j.key), ['france'])
  assert.deepEqual(plan(regions, 'europe', new Set(['cy', 'de-east'])).map((j) => j.regions), ['cy', 'de-east'])
})
