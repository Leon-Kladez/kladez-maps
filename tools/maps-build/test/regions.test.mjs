import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadRegions } from '../src/regions.mjs'

const REGIONS = fileURLToPath(new URL('../regions.json', import.meta.url))

function fixture(regions) {
  const dir = mkdtempSync(join(tmpdir(), 'regions-'))
  const p = join(dir, 'regions.json')
  writeFileSync(p, JSON.stringify({ regions }))
  return p
}

const ok = {
  id: 'by',
  title: 'Беларусь',
  group: 'cis',
  country: 'BY',
  source: { countries: ['BY'] },
  variants: ['full', 'overview'],
}

test('regions.json проходит проверку, id уникальны и правильного вида', () => {
  const regions = loadRegions(REGIONS)
  const ids = regions.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/)
    assert.ok(!id.endsWith('-overview'), id)
  }
})

test('Россия — все 85 субъектов ровно в одной карте; у каждой карты есть «что входит»', () => {
  const ru = loadRegions(REGIONS).filter((r) => r.group === 'russia')
  // Целые округа (maps: false) — для поиска и дорог; карты — части и обычные округа.
  const maps = ru.filter((r) => r.maps !== false)
  const admin1 = maps.flatMap((r) => r.source.admin1 ?? [])
  assert.equal(new Set(admin1).size, admin1.length, 'субъект в двух картах')
  const all = ru.filter((r) => !r.parent).flatMap((r) => r.source.admin1 ?? [])
  assert.deepEqual([...admin1].sort(), [...all].sort())
  for (const r of maps) assert.ok(r.contents && r.contents.length > 0, r.id)
})

test('повторный id — ошибка с этим id', () => {
  assert.throws(() => loadRegions(fixture([ok, ok])), /by/)
})

test('пустой source — ошибка', () => {
  assert.throws(() => loadRegions(fixture([{ ...ok, source: {} }])), /by/)
})

test('неизвестная группа или вариант — ошибка', () => {
  assert.throws(() => loadRegions(fixture([{ ...ok, group: 'mars' }])), /by/)
  assert.throws(() => loadRegions(fixture([{ ...ok, variants: ['huge'] }])), /by/)
})

test('коды субъектов есть в Natural Earth, каждый субъект РФ ровно в одном округе', (t) => {
  const neepath = process.env.NE_ADMIN1_PATH
  if (!neepath) return t.skip('NE_ADMIN1_PATH не задан')
  const ne = JSON.parse(readFileSync(neepath, 'utf8'))
  const known = new Set(ne.features.map((f) => f.properties.iso_3166_2))
  const regions = loadRegions(REGIONS)
  for (const r of regions) {
    for (const code of r.source.admin1 ?? []) assert.ok(known.has(code), `${r.id}: ${code}`)
  }
  const ruCodes = ne.features.filter((f) => f.properties.iso_a2 === 'RU').map((f) => f.properties.iso_3166_2)
  const districts = regions.filter((r) => r.group === 'russia')
  for (const code of ruCodes) {
    const n = districts.filter((r) => (r.source.admin1 ?? []).includes(code)).length
    assert.equal(n, 1, `${code} входит в ${n} округов`)
  }
})

test('у частей страны в названии есть страна («Китай: юг», «США: Айова»), кроме округов России (Кладезъ дописывает «Россия: …» сам)', () => {
  const regions = loadRegions(new URL('../regions.json', import.meta.url))
  const bad = regions.filter((r) => r.id.includes('-') && r.source?.admin1?.length && r.country !== 'RU' && !/^[^:]+: /.test(r.title))
  assert.deepEqual(bad.map((r) => `${r.id}: ${r.title}`), [])
})
