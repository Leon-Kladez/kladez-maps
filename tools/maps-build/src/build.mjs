#!/usr/bin/env node
// Сборщик карт Кладезя.
//
//   node src/build.mjs latest
//       → JSON последней сборки Protomaps ({url, key, date, version}).
//   node src/build.mjs build --group <g> --out <dir> [--only id1,id2] [--dry-run]
//       [--repo owner/name --tag maps-ГГГГ-ММ --upload] [--yandex-bucket b --yandex-prefix p]
//       → вырезка каждого региона группы и варианта; manifest-<g>.json или (с --dry-run) sizes-<g>.json.
//       С --upload каждый файл сразу уходит в релиз (gh) и удаляется с диска: у раннера мало места.
//   node src/build.mjs merge --out <dir>
//       → склеивает manifest-*.json в maps.json.
//   node src/build.mjs draft --out <maps.json> --version ГГГГ-ММ [--repo owner/name]
//       → черновой список карт по estimates.json (все пакеты planned) — до первой сборки.
//   node src/build.mjs districts --out <file.geojson> [--ne-dir <dir>]
//       → упрощённая схема федеральных округов России для окна выбора.
//
// Нужны в PATH: pmtiles (или PMTILES_BIN), mktorrent, при --upload — gh, при --yandex-bucket — aws.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadRegions, mapRegions, VARIANT_MAXZOOM } from './regions.mjs'
import { fetchAdmin1, NE_ADMIN0_PATH } from './geodata.mjs'
import { districtSchema, regionGeometry } from './geometry.mjs'
import { PART_SIZE_LIMIT, extractArgs, fetchLatestBuild, parseDryRunBytes, runPmtiles } from './extract.mjs'
import { assetUrl, buildMapsManifest, mergeManifests, mktorrentArgs, overlayManifests, packageFilename, sha256File } from './package.mjs'
import { KLADEZ_MAPS_REPO_PLACEHOLDER, draftResults } from './draft.mjs'

const REGIONS_PATH = fileURLToPath(new URL('../regions.json', import.meta.url))

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd}: код ${code}`))))
  })
}

async function build(o) {
  if (!o.group) throw new Error('нужен --group')
  mkdirSync(o.out, { recursive: true })
  const only = o.only ? new Set(o.only.split(',')) : null
  const regions = mapRegions(loadRegions(REGIONS_PATH)).filter((r) => r.group === o.group && (!only || only.has(r.id)))
  if (regions.length === 0) throw new Error(`в группе ${o.group} нет выбранных регионов`)

  const info = await fetchLatestBuild()
  const tag = o.tag || `maps-${info.version}`
  const ne0 = JSON.parse(readFileSync(NE_ADMIN0_PATH, 'utf8'))
  const needsAdmin1 = regions.some((r) => (r.source.admin1 ?? []).length > 0)
  const ne1 = needsAdmin1 ? JSON.parse(readFileSync(await fetchAdmin1(join(o.out, 'geodata')), 'utf8')) : null
  if (o.upload && !o.repo) throw new Error('для --upload нужен --repo')
  const yandexBase = o['yandex-bucket']
    ? `https://storage.yandexcloud.net/${o['yandex-bucket']}/${o['yandex-prefix'] ?? info.version}/`
    : undefined

  const results = []
  const sizes = []
  for (const region of regions) {
    const regionFile = join(o.out, `${region.id}.geojson`)
    writeFileSync(regionFile, JSON.stringify(regionGeometry(region, ne0, ne1)))
    for (const variant of region.variants) {
      const filename = packageFilename(region.id, variant, info.version)
      const out = join(o.out, filename)
      const maxzoom = VARIANT_MAXZOOM[variant]
      console.log(`→ ${filename} (масштаб до ${maxzoom})`)
      // Сначала оценка (секунды): файл больше 2 ГБ GitHub не примет — такой вариант
      // пропускаем, регион остаётся в списке «скоро», остальные собираются дальше.
      const estimate = parseDryRunBytes(await runPmtiles(extractArgs({ url: info.url, out, regionFile, maxzoom, dryRun: true })))
      if (o['dry-run']) {
        sizes.push({ id: region.id, variant, bytes: estimate, over_limit: estimate > PART_SIZE_LIMIT })
        continue
      }
      if (estimate > PART_SIZE_LIMIT) {
        console.log(`  пропуск: ${filename} — около ${(estimate / 1e9).toFixed(2)} ГБ, больше предела GitHub`)
        continue
      }
      await runPmtiles(extractArgs({ url: info.url, out, regionFile, maxzoom }))
      const bytes = statSync(out).size
      // Оценка бывает чуть меньше настоящего размера: лишний файл пропускаем, а не роняем группу.
      if (bytes > PART_SIZE_LIMIT) {
        console.log(`  пропуск: ${filename} — ${bytes} байт, больше предела GitHub`)
        rmSync(out)
        continue
      }
      const sha256 = await sha256File(out)
      const webseeds = [assetUrl(o.repo || 'OWNER/REPO', tag, filename), ...(yandexBase ? [yandexBase + filename] : [])]
      await run('mktorrent', mktorrentArgs({ file: out, out: `${out}.torrent`, webseeds }))
      if (yandexBase) {
        await run('aws', ['s3', 'cp', out, `s3://${o['yandex-bucket']}/${o['yandex-prefix'] ?? info.version}/${filename}`,
          '--endpoint-url', 'https://storage.yandexcloud.net'])
      }
      if (o.upload) {
        await run('gh', ['release', 'upload', tag, out, `${out}.torrent`, '--repo', o.repo, '--clobber'])
        rmSync(out)
      }
      results.push({ region, variant, filename, bytes, sha256 })
    }
  }

  if (o['dry-run']) {
    writeFileSync(join(o.out, `sizes-${o.group}.json`), JSON.stringify({ build: info, sizes }, null, 1))
    return
  }
  const manifest = buildMapsManifest(results, { repo: o.repo || 'OWNER/REPO', tag, version: info.version, builtAt: info.date, yandexBase })
  writeFileSync(join(o.out, `manifest-${o.group}.json`), JSON.stringify(manifest, null, 1))
}

async function districts(o) {
  const ne0 = JSON.parse(readFileSync(NE_ADMIN0_PATH, 'utf8'))
  const ne1 = JSON.parse(readFileSync(await fetchAdmin1(o['ne-dir'] ?? 'out/geodata'), 'utf8'))
  writeFileSync(o.out, JSON.stringify(districtSchema(mapRegions(loadRegions(REGIONS_PATH)), ne0, ne1)) + '\n')
}

function draft(o) {
  if (!o.version || !/^\d{4}-\d{2}$/.test(o.version)) throw new Error('нужен --version ГГГГ-ММ')
  const estimates = JSON.parse(readFileSync(new URL('../estimates.json', import.meta.url), 'utf8')).full_mb
  const results = draftResults(loadRegions(REGIONS_PATH), estimates, o.version)
  const repo = o.repo || KLADEZ_MAPS_REPO_PLACEHOLDER
  const spec = buildMapsManifest(results, { repo, tag: `maps-${o.version}`, version: o.version, builtAt: `${o.version}-01-draft`, planned: true })
  writeFileSync(o.out, JSON.stringify(spec, null, 1) + '\n')
}

function merge(o) {
  const parts = readdirSync(o.out)
    .filter((f) => /^manifest-.+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(o.out, f), 'utf8')))
  if (parts.length === 0) throw new Error(`в ${o.out} нет manifest-*.json`)
  // --base: прежний maps.json (или черновик) — собранное кладём поверх него.
  // Записи регионов без своей карты (целые округа, нарезанные на части) из списка убираются.
  const keep = new Set(mapRegions(loadRegions(REGIONS_PATH)).map((r) => r.id))
  const merged = o.base ? overlayManifests(JSON.parse(readFileSync(o.base, 'utf8')), parts, { keep }) : mergeManifests(parts)
  writeFileSync(join(o.out, 'maps.json'), JSON.stringify(merged, null, 1) + '\n')
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'group': { type: 'string' },
    'out': { type: 'string', default: 'out' },
    'only': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'repo': { type: 'string' },
    'tag': { type: 'string' },
    'upload': { type: 'boolean', default: false },
    'yandex-bucket': { type: 'string' },
    'yandex-prefix': { type: 'string' },
    'ne-dir': { type: 'string' },
    'version': { type: 'string' },
    'base': { type: 'string' },
  },
})

const cmd = positionals[0]
try {
  if (cmd === 'latest') console.log(JSON.stringify(await fetchLatestBuild()))
  else if (cmd === 'build') await build(values)
  else if (cmd === 'merge') merge(values)
  else if (cmd === 'districts') await districts(values)
  else if (cmd === 'draft') draft(values)
  else throw new Error('команда: latest | build | merge | districts | draft')
} catch (e) {
  console.error(`Ошибка: ${e.message}`)
  process.exit(1)
}
