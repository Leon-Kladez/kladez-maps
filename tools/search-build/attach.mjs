#!/usr/bin/env node
// Дописывает в maps.json указатели поиска: у пакета региона (вариант full, id = регион)
// появляется поле search { url, size_mb, sha256, version }. Кладезъ скачивает его вместе с картой.
//
//   node attach.mjs --manifest maps.json --dir out --repo owner/name --tag maps-2026-11
//     (в out лежат search-<регион>_<версия>.sqlite)
//   node attach.mjs --manifest maps.json --parts parts
//     (в parts — описания {region, version, url, size, sha256} от сборки регионов)
//   node attach.mjs describe --file out/search-….sqlite --repo owner/name --tag maps-2026-11
//     → такое описание в стандартный вывод
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const SEARCH_FILE_RE = /^search-([a-z0-9-]+)_(\d{4}-\d{2})\.sqlite$/

/** @param {object} manifest maps.json; @param {{region:string,version:string,url:string,size:number,sha256:string}[]} files */
export function attachSearch(manifest, files) {
  const byRegion = new Map(files.map((f) => [f.region, f]))
  let attached = 0
  for (const col of manifest.collections ?? []) {
    for (const res of col.resources ?? []) {
      const f = byRegion.get(res.id)
      if (!f) continue
      res.search = {
        url: f.url,
        size_mb: Math.max(1, Math.round(f.size / 1e6)),
        sha256: f.sha256,
        version: f.version,
      }
      attached++
    }
  }
  return attached
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

async function describe(argv) {
  const { values: o } = parseArgs({ args: argv, options: { file: { type: 'string' }, repo: { type: 'string' }, tag: { type: 'string' } } })
  const name = o.file.split(/[\/]/).pop()
  const m = SEARCH_FILE_RE.exec(name)
  if (!m) throw new Error(`не указатель поиска: ${name}`)
  const d = {
    region: m[1],
    version: m[2],
    url: `https://github.com/${o.repo}/releases/download/${o.tag}/${name}`,
    size: statSync(o.file).size,
    sha256: await sha256File(o.file),
  }
  console.log(JSON.stringify(d))
}

async function main() {
  if (process.argv[2] === 'describe') return describe(process.argv.slice(3))
  const { values: o } = parseArgs({
    options: {
      manifest: { type: 'string' }, dir: { type: 'string' }, parts: { type: 'string' },
      repo: { type: 'string' }, tag: { type: 'string' },
    },
  })
  if (!o.manifest || (!o.dir && !o.parts)) throw new Error('нужны --manifest и --dir (с --repo --tag) или --parts')
  const files = []
  // --parts: готовые описания search-*.json от сборки регионов (файлы уже в выпуске).
  for (const name of o.parts ? readdirSync(o.parts) : []) {
    if (name.endsWith('.json')) files.push(JSON.parse(readFileSync(join(o.parts, name), 'utf8')))
  }
  if (o.dir && (!o.repo || !o.tag)) throw new Error('для --dir нужны --repo и --tag')
  for (const name of o.dir ? readdirSync(o.dir) : []) {
    const m = SEARCH_FILE_RE.exec(name)
    if (!m) continue
    const path = join(o.dir, name)
    files.push({
      region: m[1],
      version: m[2],
      url: `https://github.com/${o.repo}/releases/download/${o.tag}/${name}`,
      size: statSync(path).size,
      sha256: await sha256File(path),
    })
  }
  const manifest = JSON.parse(readFileSync(o.manifest, 'utf8'))
  const n = attachSearch(manifest, files)
  writeFileSync(o.manifest, JSON.stringify(manifest, null, 1) + '\n')
  console.log(`указатели поиска: файлов ${files.length}, прикреплено к пакетам ${n}`)
  if (files.length > 0 && n === 0) throw new Error('ни один указатель не нашёл свой пакет в maps.json')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
