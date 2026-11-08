// Контуры Natural Earth (общественное достояние), закреплённые по коммиту и sha256.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const NE_ADMIN1 = {
  url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/117488dc884bad03366ff727eca013e434615127/geojson/ne_10m_admin_1_states_provinces.geojson',
  sha256: '22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5',
  file: 'ne_10m_admin_1_states_provinces.geojson',
}

/** Путь к контурам стран, которые уже лежат в программе. */
export const NE_ADMIN0_PATH = new URL('../../../admin/resources/geodata/ne_50m_admin_0_countries.geojson', import.meta.url)

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Скачивает NE admin-1 в destDir (если ещё нет) и проверяет sha256. */
export async function fetchAdmin1(destDir) {
  mkdirSync(destDir, { recursive: true })
  const path = join(destDir, NE_ADMIN1.file)
  if (!existsSync(path)) {
    const res = await fetch(NE_ADMIN1.url)
    if (!res.ok) throw new Error(`Natural Earth: HTTP ${res.status}`)
    writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  }
  const got = sha256(readFileSync(path))
  if (got !== NE_ADMIN1.sha256) throw new Error(`Natural Earth admin-1: sha256 ${got}, ожидалось ${NE_ADMIN1.sha256}`)
  return path
}
