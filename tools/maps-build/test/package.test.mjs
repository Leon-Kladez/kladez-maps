import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sha256File, mktorrentArgs, assetUrl, buildMapsManifest, packageFilename, mergeManifests } from '../src/package.mjs'

const central = {
  id: 'ru-central', title: 'Центральный федеральный округ', group: 'russia', country: 'RU',
  contents: 'Москва и Московская область', source: { admin1: ['RU-MOW'] }, variants: ['full', 'overview'],
}
const SHA = 'a'.repeat(64)
const results = [
  { region: central, variant: 'full', filename: 'ru-central_2026-11.pmtiles', bytes: 1_099_500_000, sha256: SHA },
  { region: central, variant: 'overview', filename: 'ru-central-overview_2026-11.pmtiles', bytes: 300_000_000, sha256: SHA },
]
const opts = { repo: 'kladez/kladez-maps', tag: 'maps-2026-11', version: '2026-11', builtAt: '2026-11-04' }

test('packageFilename разбирается регуляркой parseMapFilename', () => {
  const name = packageFilename('ru-central', 'overview', '2026-11')
  assert.equal(name, 'ru-central-overview_2026-11.pmtiles')
  const m = name.replace(/\.pmtiles$/, '').match(/^(.+)_(\d{4}-\d{2})$/)
  assert.deepEqual([m[1], m[2]], ['ru-central-overview', '2026-11'])
})

test('buildMapsManifest: ресурсы, размеры, без зеркал', () => {
  const spec = buildMapsManifest(results, opts)
  assert.equal(spec.spec_version, '2026-11-04')
  assert.equal(spec.collections.length, 1)
  const c = spec.collections[0]
  assert.deepEqual([c.slug, c.name, c.language, c.icon], ['russia', 'Россия', 'ru', 'IconMap'])
  const [full, ov] = c.resources
  assert.equal(full.id, 'ru-central')
  assert.equal(ov.id, 'ru-central-overview')
  assert.equal(full.size_mb, 1100)
  assert.equal(full.version, '2026-11')
  assert.equal(full.url, 'https://github.com/kladez/kladez-maps/releases/download/maps-2026-11/ru-central_2026-11.pmtiles')
  assert.equal(full.torrent, full.url + '.torrent')
  assert.equal(full.sha256, SHA)
  assert.deepEqual([full.detail, ov.detail, full.country], ['full', 'overview', 'RU'])
  assert.equal(full.description, 'Москва и Московская область')
  assert.equal(full.contents, 'Москва и Московская область')
  assert.ok(!('mirrors' in full))
})

test('buildMapsManifest: все страны пакета в countries', () => {
  const ip = { ...central, id: 'israel-palestine', group: 'middle-east', country: 'IL', contents: undefined, title: 'Израиль и Палестина', source: { countries: ['IL', 'PS'] } }
  const spec = buildMapsManifest([{ ...results[0], region: ip, filename: 'israel-palestine_2026-11.pmtiles' }], opts)
  assert.deepEqual(spec.collections[0].resources[0].countries, ['IL', 'PS'])
  assert.deepEqual(buildMapsManifest(results, opts).collections[0].resources[0].countries, ['RU'])
})

test('buildMapsManifest: зеркало Яндекса, если задано', () => {
  const spec = buildMapsManifest(results, { ...opts, yandexBase: 'https://storage.yandexcloud.net/kladez-maps/2026-11/' })
  assert.deepEqual(spec.collections[0].resources[0].mirrors, [
    'https://storage.yandexcloud.net/kladez-maps/2026-11/ru-central_2026-11.pmtiles',
  ])
})

test('mergeManifests склеивает группы в порядке GROUPS', () => {
  const a = buildMapsManifest(results, opts)
  const b = buildMapsManifest([{ ...results[0], region: { ...central, id: 'by', group: 'cis', country: 'BY', contents: undefined, title: 'Беларусь' }, filename: 'by_2026-11.pmtiles' }], opts)
  const m = mergeManifests([b, a])
  assert.deepEqual(m.collections.map((c) => c.slug), ['russia', 'cis'])
  assert.equal(m.collections[1].resources[0].description, 'Карта: Беларусь')
})

test('mktorrentArgs с веб-сидами', () => {
  const a = mktorrentArgs({ file: 'f.pmtiles', out: 'f.pmtiles.torrent', webseeds: ['https://a/f', 'https://b/f'] })
  assert.equal(a[a.indexOf('https://a/f') - 1], '-w')
  assert.equal(a[a.indexOf('https://b/f') - 1], '-w')
  assert.equal(a.at(-1), 'f.pmtiles')
  assert.ok(a.includes('-o'))
})

test('assetUrl', () => {
  assert.equal(assetUrl('o/r', 't', 'f'), 'https://github.com/o/r/releases/download/t/f')
})

test('sha256File', async () => {
  const p = join(mkdtempSync(join(tmpdir(), 'sha-')), 'abc')
  writeFileSync(p, 'abc')
  assert.equal(await sha256File(p), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('buildMapsManifest: черновик с оценками — пометка planned, без суммы', () => {
  const draft = results.map((r) => ({ ...r, sha256: undefined }))
  const spec = buildMapsManifest(draft, { ...opts, planned: true })
  const [full] = spec.collections[0].resources
  assert.equal(full.planned, true)
  assert.ok(!('sha256' in full))
  assert.match(full.description, /ещё не опубликован/)
})

test('draftResults: оценки, обзорно — четверть, нет оценки — ошибка', async () => {
  const { draftResults } = await import('../src/draft.mjs')
  const r = draftResults([central], { 'ru-central': 1104 }, '2026-11')
  assert.deepEqual(r.map((x) => [x.filename, x.bytes]), [
    ['ru-central_2026-11.pmtiles', 1_104_000_000],
    ['ru-central-overview_2026-11.pmtiles', 276_000_000],
  ])
  assert.throws(() => draftResults([central], {}, '2026-11'), /ru-central/)
})

test('overlayManifests: собранное заменяет «скоро», остальное остаётся', async () => {
  const { overlayManifests } = await import('../src/package.mjs')
  const base = {
    spec_version: '2026-11-01-draft',
    collections: [
      { slug: 'russia', name: 'Россия', resources: [{ id: 'ru-central', planned: true }, { id: 'ru-south', planned: true }] },
      { slug: 'europe', name: 'Европа', resources: [{ id: 'de', planned: true }] },
    ],
  }
  const part = buildMapsManifest([results[0]], opts)
  const out = overlayManifests(base, [part])
  const ru = out.collections.find((c) => c.slug === 'russia')
  assert.equal(ru.resources.find((r) => r.id === 'ru-central').planned, undefined)
  assert.equal(ru.resources.find((r) => r.id === 'ru-south').planned, true)
  assert.deepEqual(out.collections.map((c) => c.slug), ['russia', 'europe'])
  assert.equal(out.spec_version, '2026-11-04')
  assert.equal(base.collections[0].resources[0].planned, true, 'исходный список не меняется')
})

test('нарезка: целый округ уходит из списка, части наследуют поиск и дороги', async () => {
  const { overlayManifests } = await import('../src/package.mjs')
  const base = {
    spec_version: '2026-11',
    collections: [{ slug: 'russia', resources: [
      { id: 'ru-volga', planned: true, search: { url: 's' }, routes: { url: 'r' } },
      { id: 'ru-volga-overview', url: 'o' },
      { id: 'ru-central', url: 'c' },
    ] }],
  }
  const part = { spec_version: '2026-11', collections: [{ slug: 'russia', resources: [
    { id: 'ru-volga-west', parent: 'ru-volga', url: 'w' },
    { id: 'ru-volga-west-overview', parent: 'ru-volga', url: 'wo' },
  ] }] }
  const keep = new Set(['ru-central', 'ru-volga-west'])
  const res = overlayManifests(base, [part], { keep }).collections[0].resources
  const ids = res.map((r) => r.id)
  assert.ok(!ids.includes('ru-volga') && !ids.includes('ru-volga-overview'))
  assert.ok(ids.includes('ru-central'))
  const w = res.find((r) => r.id === 'ru-volga-west')
  assert.equal(w.search.url, 's')
  assert.equal(w.routes.url, 'r')
  assert.equal(res.find((r) => r.id === 'ru-volga-west-overview').search, undefined)
})

test('regions.json: части покрывают целые округа без дыр, у каждой — родитель без карты', async () => {
  const { loadRegions, mapRegions } = await import('../src/regions.mjs')
  const { fileURLToPath } = await import('node:url')
  const regions = loadRegions(fileURLToPath(new URL('../regions.json', import.meta.url)))
  for (const parent of regions.filter((r) => r.maps === false)) {
    const parts = regions.filter((r) => r.parent === parent.id)
    assert.ok(parts.length >= 2, parent.id)
    assert.deepEqual(parts.flatMap((p) => p.source.admin1).sort(), [...parent.source.admin1].sort())
  }
  assert.ok(!mapRegions(regions).some((r) => r.id === 'ru-volga'))
})
