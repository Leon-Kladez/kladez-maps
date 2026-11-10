#!/usr/bin/env node
// Дописывает в maps.json данные к карте региона: у пакета (вариант full, id = регион) появляются
//   search { url, size_mb, sha256, version } — указатель поиска (search-<регион>_<версия>.sqlite);
//   routes { url, size_mb, sha256, version } — файл дорог для маршрутов (routes-<регион>_<версия>.tar).
// Кладезъ скачивает их вместе с картой.
//
//   node attach.mjs --manifest maps.json --dir out --repo owner/name --tag maps-2026-11
//     (в out лежат файлы search-…/routes-…)
//   node attach.mjs --manifest maps.json --parts parts
//     (в parts — описания {kind, region, version, url, size, sha256} от сборки регионов)
//   node attach.mjs describe --file out/search-….sqlite --repo owner/name --tag maps-2026-11
//     → такое описание в стандартный вывод
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const SEARCH_FILE_RE = /^search-([a-z0-9-]+)_(\d{4}-\d{2})\.sqlite$/
/** Указатель поиска (search) или файл дорог для маршрутов (routes). */
export const DATA_FILE_RE = /^(search|routes)-([a-z0-9-]+)_(\d{4}-\d{2})\.(sqlite|tar)$/

/** Имя файла → {kind, region, version}; null — не наш файл. */
export function parseDataFilename(name) {
  const m = DATA_FILE_RE.exec(name)
  if (!m) return null
  if ((m[1] === 'search') !== (m[4] === 'sqlite')) return null
  return { kind: m[1], region: m[2], version: m[3] }
}

/**
 * @param {object} manifest maps.json
 * @param {{kind?:'search'|'routes',region:string,version:string,url:string,size:number,sha256:string}[]} files
 *   kind не указан — указатель поиска (описания из первой сборки поиска).
 */
export function attachData(manifest, files) {
  let attached = 0
  for (const col of manifest.collections ?? []) {
    for (const res of col.resources ?? []) {
      for (const f of files) {
        if (f.region !== res.id) continue
        res[f.kind ?? 'search'] = {
          url: f.url,
          size_mb: Math.max(1, Math.round(f.size / 1e6)),
          sha256: f.sha256,
          version: f.version,
        }
        attached++
      }
    }
  }
  return attached
}

/** Прежнее имя: только указатели поиска. */
export const attachSearch = attachData

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

async function describeFile(path, name, repo, tag) {
  const p = parseDataFilename(name)
  if (!p) throw new Error(`не указатель поиска и не файл дорог: ${name}`)
  return {
    ...p,
    url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    size: statSync(path).size,
    sha256: await sha256File(path),
  }
}

async function main() {
  if (process.argv[2] === 'describe') {
    const { values: o } = parseArgs({
      args: process.argv.slice(3),
      options: { file: { type: 'string' }, repo: { type: 'string' }, tag: { type: 'string' } },
    })
    console.log(JSON.stringify(await describeFile(o.file, o.file.split(/[\\/]/).pop(), o.repo, o.tag)))
    return
  }
  const { values: o } = parseArgs({
    options: {
      manifest: { type: 'string' }, dir: { type: 'string' }, parts: { type: 'string' },
      repo: { type: 'string' }, tag: { type: 'string' },
    },
  })
  if (!o.manifest || (!o.dir && !o.parts)) throw new Error('нужны --manifest и --dir (с --repo --tag) или --parts')
  const files = []
  for (const name of o.parts ? readdirSync(o.parts) : []) {
    if (name.endsWith('.json')) files.push(JSON.parse(readFileSync(join(o.parts, name), 'utf8')))
  }
  if (o.dir && (!o.repo || !o.tag)) throw new Error('для --dir нужны --repo и --tag')
  for (const name of o.dir ? readdirSync(o.dir) : []) {
    if (parseDataFilename(name)) files.push(await describeFile(join(o.dir, name), name, o.repo, o.tag))
  }
  const manifest = JSON.parse(readFileSync(o.manifest, 'utf8'))
  const n = attachData(manifest, files)
  writeFileSync(o.manifest, JSON.stringify(manifest, null, 1) + '\n')
  console.log(`файлов ${files.length}, прикреплено к пакетам ${n}`)
  if (files.length > 0 && n === 0) throw new Error('ни один файл не нашёл свой пакет в maps.json')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
