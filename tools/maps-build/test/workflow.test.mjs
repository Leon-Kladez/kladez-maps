import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync(new URL('../../../.github/workflows/build-maps.yml', import.meta.url), 'utf8')

test('новый выпуск не становится «последним», пока в нём нет maps.json', () => {
  const create = wf.slice(wf.indexOf('gh release create'), wf.indexOf('--notes', wf.indexOf('gh release create')))
  assert.ok(create.includes('--latest=false'), create)
})

test('токены не нужны: выкладывает своими правами в свой репозиторий', () => {
  assert.ok(!wf.includes('secrets.'), 'в сценарии не должно быть секретов')
  assert.ok(wf.includes('REPO: ${{ github.repository }}'))
  assert.ok(wf.includes('contents: write'))
})

test('сборка по частям не стирает уже выложенные регионы', () => {
  assert.ok(wf.includes('merge --out parts --base "$base"'))
  assert.ok(wf.includes('tools/maps-build/draft-maps.json'))
})

test('ввод пользователя не подставляется прямо в shell', () => {
  const bad = wf.split('\n').filter((l) => /\$\{\{[^}]*inputs\.(only|groups)/.test(l) && !/^\s*(ONLY|GROUPS)_INPUT:/.test(l))
  assert.deepEqual(bad, [], 'inputs.only / inputs.groups должны идти через env')
})

test('вручную по умолчанию — только оценка размеров', () => {
  const dry = wf.slice(wf.indexOf('dry_run:'), wf.indexOf('permissions:'))
  assert.ok(/default: true/.test(dry), dry)
})
