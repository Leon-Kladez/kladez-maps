// Вырезка региона из ежедневной сборки Protomaps программой pmtiles (go-pmtiles).
import { spawn } from 'node:child_process'

export const PROTOMAPS_BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json'
export const PROTOMAPS_BUILD_BASE = 'https://build.protomaps.com/'
/** Лимит GitHub на файл релиза — 2 ГиБ; берём с запасом. */
export const PART_SIZE_LIMIT = 2_000_000_000

/** @param {{key: string, size?: number}[]} builds */
export function latestBuild(builds) {
  if (!Array.isArray(builds) || builds.length === 0) throw new Error('Protomaps: список сборок пуст')
  const key = builds.map((b) => b.key).sort().at(-1)
  const d = key.replace('.pmtiles', '')
  if (!/^\d{8}$/.test(d)) throw new Error(`Protomaps: непонятное имя сборки ${key}`)
  return {
    url: PROTOMAPS_BUILD_BASE + key,
    key,
    date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    version: `${d.slice(0, 4)}-${d.slice(4, 6)}`,
  }
}

export async function fetchLatestBuild() {
  const res = await fetch(PROTOMAPS_BUILDS_URL)
  if (!res.ok) throw new Error(`Protomaps builds.json: HTTP ${res.status}`)
  return latestBuild(await res.json())
}

export function extractArgs({ url, out, regionFile, maxzoom, dryRun = false }) {
  const args = ['extract', url, out, `--region=${regionFile}`, `--maxzoom=${maxzoom}`, '--download-threads=8']
  if (dryRun) args.push('--dry-run')
  return args
}

/** Запускает pmtiles; возвращает stdout+stderr. При ненулевом коде — ошибка с хвостом вывода. */
export function runPmtiles(args, bin = process.env.PMTILES_BIN || 'pmtiles') {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (c) => (out += c))
    p.stderr.on('data', (c) => (out += c))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`pmtiles ${args[0]}: код ${code}\n${out.slice(-2000)}`))))
  })
}

/** Размер из вывода `pmtiles extract --dry-run` (формат нестабилен — как parseDryRunOutput в admin/app/services/map_service.ts). */
export function parseDryRunBytes(output) {
  const m = output.match(/archive\s+size\s+of\s+([\d,.]+)\s*(B|KB|MB|GB|TB|bytes?)?/i)
  if (!m) return 0
  const mult = { B: 1, BYTE: 1, BYTES: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }
  return Math.round(parseFloat(m[1].replace(/,/g, '')) * (mult[(m[2] ?? 'B').toUpperCase()] ?? 1))
}

export function assertPartSize(bytes, id) {
  if (bytes > PART_SIZE_LIMIT)
    throw new Error(`${id}: ${bytes} байт больше лимита ${PART_SIZE_LIMIT} — разделите регион в regions.json на части`)
}
