import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestBuild, extractArgs, assertPartSize, PART_SIZE_LIMIT } from '../src/extract.mjs'

test('latestBuild берёт самую свежую сборку', () => {
  const b = latestBuild([{ key: '20261103.pmtiles', size: 1 }, { key: '20261104.pmtiles', size: 2 }])
  assert.equal(b.key, '20261104.pmtiles')
  assert.equal(b.url, 'https://build.protomaps.com/20261104.pmtiles')
  assert.equal(b.date, '2026-11-04')
  assert.equal(b.version, '2026-11')
})

test('latestBuild без сборок — ошибка', () => {
  assert.throws(() => latestBuild([]))
})

test('extractArgs', () => {
  const a = extractArgs({ url: 'https://x/1.pmtiles', out: 'o.pmtiles', regionFile: 'r.geojson', maxzoom: 13 })
  assert.deepEqual(a.slice(0, 3), ['extract', 'https://x/1.pmtiles', 'o.pmtiles'])
  assert.ok(a.includes('--region=r.geojson'))
  assert.ok(a.includes('--maxzoom=13'))
  assert.ok(a.includes('--download-threads=8'))
  assert.ok(extractArgs({ url: 'u', out: 'o', regionFile: 'r', maxzoom: 15, dryRun: true }).includes('--dry-run'))
})

test('assertPartSize: предел 2 000 000 000 байт', () => {
  assert.equal(PART_SIZE_LIMIT, 2_000_000_000)
  assert.throws(() => assertPartSize(2_000_000_001, 'de-south'), /de-south/)
  assert.doesNotThrow(() => assertPartSize(2_000_000_000, 'de-south'))
})
