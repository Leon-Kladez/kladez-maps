#!/usr/bin/env node
// Базовые материалы карты для программы: стиль с русскими подписями, шрифты, значки
// и (если есть) обзорная карта мира world.pmtiles. Результат кладётся в
// admin/resources/maps/base-assets.tar.gz и распаковывается программой без интернета.
//
//   node src/base_assets.mjs --out <путь к .tar.gz> [--nomad-tar <base-assets.tar.gz NOMAD>] [--world <world.pmtiles>]
//
// Без --nomad-tar архив NOMAD скачивается по закреплённому адресу и проверяется по sha256.
// Шрифты Noto Sans (OFL) и значки Protomaps в нём уже содержат кириллицу.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { layers, namedFlavor } from '@protomaps/basemaps'

export const NOMAD_BASE_ASSETS = {
  url: 'https://raw.githubusercontent.com/Crosstalk-Solutions/project-nomad-maps/8ab9d1a778d8c5b2713204e22b1352e00a7baf36/base-assets.tar.gz',
  sha256: '93181e170120fbb32d00ee1cd00c2f79a9c771e29573023bac54f512f80be370',
}
/** Верхняя папка архива: программа распаковывает его с strip: 1 в /storage/maps. */
const TOP = 'tozip'
const ATTRIBUTION = fileURLToPath(new URL('../../../admin/resources/maps/ATTRIBUTION.md', import.meta.url))
const MAP_REGIONS_TS = fileURLToPath(new URL('../../../admin/constants/map_regions.ts', import.meta.url))

/** Версия материалов — из admin/constants/map_regions.ts, чтобы программа и архив не разошлись. */
export function baseAssetsVersion(source = readFileSync(MAP_REGIONS_TS, 'utf8')) {
  const m = /KLADEZ_BASE_ASSETS_VERSION = '([^']+)'/.exec(source)
  if (!m) throw new Error('KLADEZ_BASE_ASSETS_VERSION не найдена в admin/constants/map_regions.ts')
  return m[1]
}

/** Стиль NOMAD с теми же источниками/шрифтами/значками, но слоями Protomaps на русском. */
export function makeRussianStyle(template) {
  return {
    ...structuredClone(template),
    layers: layers('protomaps', namedFlavor('light'), { lang: 'ru' }),
  }
}

function tar(args, cwd) {
  // Относительные пути и cwd: GNU tar в Git Bash принимает «C:» за адрес сервера.
  const r = spawnSync('tar', args, { cwd, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`tar ${args.join(' ')}: код ${r.status}`)
}

async function fetchNomadTar(dir) {
  const res = await fetch(NOMAD_BASE_ASSETS.url)
  if (!res.ok) throw new Error(`base-assets NOMAD: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(buf).digest('hex')
  if (got !== NOMAD_BASE_ASSETS.sha256) throw new Error(`base-assets NOMAD: sha256 ${got}, ожидалось ${NOMAD_BASE_ASSETS.sha256}`)
  const p = join(dir, 'nomad-base-assets.tar.gz')
  writeFileSync(p, buf)
  return p
}

export async function packBaseAssets({ nomadTar, worldPmtiles, out }) {
  const work = mkdtempSync(join(tmpdir(), 'kladez-base-assets-'))
  try {
    const src = nomadTar ? resolve(nomadTar) : await fetchNomadTar(work)
    copyFileSync(src, join(work, 'in.tar.gz'))
    tar(['-xzf', 'in.tar.gz'], work)
    const stylePath = join(work, TOP, 'nomad-base-styles.json')
    const style = makeRussianStyle(JSON.parse(readFileSync(stylePath, 'utf8')))
    writeFileSync(stylePath, JSON.stringify(style))
    copyFileSync(ATTRIBUTION, join(work, TOP, 'ATTRIBUTION.md'))
    writeFileSync(join(work, TOP, 'kladez-base-assets.txt'), baseAssetsVersion() + '\n')
    if (worldPmtiles) {
      mkdirSync(join(work, TOP, 'pmtiles'), { recursive: true })
      copyFileSync(resolve(worldPmtiles), join(work, TOP, 'pmtiles', 'world.pmtiles'))
    }
    tar(['-czf', 'out.tar.gz', TOP], work)
    mkdirSync(dirname(resolve(out)), { recursive: true })
    copyFileSync(join(work, 'out.tar.gz'), resolve(out))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'base_assets.mjs') {
  const { values } = parseArgs({ options: { 'out': { type: 'string' }, 'nomad-tar': { type: 'string' }, 'world': { type: 'string' } } })
  if (!values.out) {
    console.error('нужен --out')
    process.exit(1)
  }
  await packBaseAssets({ nomadTar: values['nomad-tar'], worldPmtiles: values.world, out: values.out })
  console.log(`готово: ${values.out}`)
}
