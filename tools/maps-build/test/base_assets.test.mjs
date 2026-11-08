import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRussianStyle, baseAssetsVersion } from '../src/base_assets.mjs'

const template = {
  version: 8,
  sources: { protomaps: { type: 'vector', attribution: '© OpenStreetMap', url: 'pmtiles://http://localhost:8080/x.pmtiles' } },
  layers: [{ id: 'old', type: 'background' }],
  sprite: 'http://localhost:8080/basemaps-assets/sprites/v4/light',
  glyphs: 'http://localhost:8080/basemaps-assets/fonts/{fontstack}/{range}.pbf',
}

test('makeRussianStyle: подписи по-русски, остальное из шаблона', () => {
  const style = makeRussianStyle(template)
  const country = style.layers.find((l) => l.id === 'places_country')
  const tf = JSON.stringify(country.layout['text-field'])
  assert.ok(tf.includes('"name:ru"'), tf)
  assert.ok(tf.indexOf('"name:ru"') < (tf.indexOf('"name:en"') === -1 ? Infinity : tf.indexOf('"name:en"')), 'сначала русское имя')
  const locality = JSON.stringify(style.layers.find((l) => l.id === 'places_locality').layout['text-field'])
  assert.ok(locality.includes('"name:ru"'))
  assert.deepEqual(style.sources, template.sources)
  assert.equal(style.glyphs, template.glyphs)
  assert.equal(style.sprite, template.sprite)
  assert.equal(style.version, 8)
  assert.ok(style.layers.length > 50)
  assert.ok(!style.layers.some((l) => l.id === 'old'))
})

test('makeRussianStyle не меняет шаблон', () => {
  makeRussianStyle(template)
  assert.deepEqual(template.layers, [{ id: 'old', type: 'background' }])
})

test('baseAssetsVersion: берётся из констант программы', () => {
  assert.equal(baseAssetsVersion("export const KLADEZ_BASE_ASSETS_VERSION = 'kladez-ru-7'"), 'kladez-ru-7')
  assert.match(baseAssetsVersion(), /^kladez-ru-\d+$/)
  assert.throws(() => baseAssetsVersion('nothing'))
})
