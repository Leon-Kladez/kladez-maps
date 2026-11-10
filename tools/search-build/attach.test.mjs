import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachData, attachSearch, parseDataFilename, SEARCH_FILE_RE } from './attach.mjs'
import { toSingleMultiPolygon } from './outlines.mjs'
import { overlayManifests } from '../maps-build/src/package.mjs'

const manifest = () => ({
  spec_version: '2026-11',
  collections: [
    {
      slug: 'russia',
      resources: [
        { id: 'ru-central', version: '2026-11', url: 'a' },
        { id: 'ru-central-overview', version: '2026-11', url: 'b' },
      ],
    },
  ],
})

test('имя файла указателя', () => {
  assert.deepEqual([...SEARCH_FILE_RE.exec('search-ru-central_2026-11.sqlite')].slice(1), ['ru-central', '2026-11'])
  assert.equal(SEARCH_FILE_RE.exec('ru-central_2026-11.pmtiles'), null)
})

test('указатель прикрепляется только к подробному пакету региона', () => {
  const m = manifest()
  const n = attachSearch(m, [{ region: 'ru-central', version: '2026-11', url: 'u', size: 123_400_000, sha256: 'x' }])
  assert.equal(n, 1)
  assert.deepEqual(m.collections[0].resources[0].search, { url: 'u', size_mb: 123, sha256: 'x', version: '2026-11' })
  assert.equal(m.collections[0].resources[1].search, undefined)
})

test('пересборка карт не стирает указатель поиска', () => {
  const base = manifest()
  attachSearch(base, [{ region: 'ru-central', version: '2026-11', url: 'u', size: 1e6, sha256: 'x' }])
  const part = { spec_version: '2026-11', collections: [{ slug: 'russia', resources: [{ id: 'ru-central', version: '2026-11', url: 'new' }] }] }
  const out = overlayManifests(base, [part])
  const res = out.collections[0].resources.find((r) => r.id === 'ru-central')
  assert.equal(res.url, 'new')
  assert.equal(res.search.url, 'u')
})

test('контур региона — один MultiPolygon', () => {
  const f = toSingleMultiPolygon({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[2, 2], [3, 2], [3, 3], [2, 2]]], [[[4, 4], [5, 4], [5, 5], [4, 4]]]] } },
    ],
  })
  assert.equal(f.geometry.type, 'MultiPolygon')
  assert.equal(f.geometry.coordinates.length, 3)
})

test('файлы дорог: имя и поле routes рядом с search', () => {
  assert.deepEqual(parseDataFilename('routes-ru-central_2026-11.tar'), { kind: 'routes', region: 'ru-central', version: '2026-11' })
  assert.deepEqual(parseDataFilename('search-ru-central_2026-11.sqlite'), { kind: 'search', region: 'ru-central', version: '2026-11' })
  assert.equal(parseDataFilename('routes-ru-central_2026-11.sqlite'), null)
  assert.equal(parseDataFilename('ru-central_2026-11.pmtiles'), null)
  const m = manifest()
  attachData(m, [
    { kind: 'search', region: 'ru-central', version: '2026-11', url: 's', size: 1e6, sha256: 'a' },
    { kind: 'routes', region: 'ru-central', version: '2026-11', url: 'r', size: 900e6, sha256: 'b' },
  ])
  const res = m.collections[0].resources[0]
  assert.equal(res.search.url, 's')
  assert.deepEqual(res.routes, { url: 'r', size_mb: 900, sha256: 'b', version: '2026-11' })
  // Пересборка карты сохраняет и то и другое.
  const part = { spec_version: '2026-11', collections: [{ slug: 'russia', resources: [{ id: 'ru-central', version: '2026-11', url: 'new' }] }] }
  const out = overlayManifests(m, [part]).collections[0].resources.find((r) => r.id === 'ru-central')
  assert.equal(out.routes.url, 'r')
  assert.equal(out.search.url, 's')
})
