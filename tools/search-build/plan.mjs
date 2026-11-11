#!/usr/bin/env node
// План сборки указателей поиска и дорог для стран (не России): одно задание на файл Geofabrik.
// Задание скачивает файлы страны с Geofabrik один раз и собирает данные для всех карт этой
// страны: у частей (Франция: север, юг…) — свой указатель, чтобы каждый был меньше 2 ГБ.
//
//   node plan.mjs --group europe [--only fr,de]   → JSON-массив заданий для matrix
//     [{ "key": "france", "regions": "fr-north,fr-east,…", "sources": "europe/france" }, …]
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadRegions, mapRegions } from '../maps-build/src/regions.mjs'

/** Страна → файлы Geofabrik (путь без -latest.osm.pbf). Несколько — сливаются. */
export const GEOFABRIK = {
  AD: ['europe/andorra'],
  AL: ['europe/albania'],
  AT: ['europe/austria'],
  AX: ['europe/finland'],
  BA: ['europe/bosnia-herzegovina'],
  BE: ['europe/belgium'],
  BG: ['europe/bulgaria'],
  CH: ['europe/switzerland'],
  CY: ['europe/cyprus'],
  CZ: ['europe/czech-republic'],
  DE: ['europe/germany'],
  DK: ['europe/denmark'],
  EE: ['europe/estonia'],
  ES: ['europe/spain'],
  FI: ['europe/finland'],
  FO: ['europe/faroe-islands'],
  FR: ['europe/france'],
  // Северная Ирландия у Geofabrik — вместе с Ирландией.
  GB: ['europe/great-britain', 'europe/ireland-and-northern-ireland'],
  GG: ['europe/guernsey-jersey'],
  GR: ['europe/greece'],
  HR: ['europe/croatia'],
  HU: ['europe/hungary'],
  IE: ['europe/ireland-and-northern-ireland'],
  IM: ['europe/isle-of-man'],
  IS: ['europe/iceland'],
  IT: ['europe/italy'],
  JE: ['europe/guernsey-jersey'],
  LI: ['europe/liechtenstein'],
  LT: ['europe/lithuania'],
  LU: ['europe/luxembourg'],
  LV: ['europe/latvia'],
  MC: ['europe/monaco'],
  ME: ['europe/montenegro'],
  MK: ['europe/macedonia'],
  MT: ['europe/malta'],
  NL: ['europe/netherlands'],
  NO: ['europe/norway'],
  PL: ['europe/poland'],
  PT: ['europe/portugal'],
  RO: ['europe/romania'],
  RS: ['europe/serbia'],
  SE: ['europe/sweden'],
  SI: ['europe/slovenia'],
  SK: ['europe/slovakia'],
  // Сан-Марино и Ватикан у Geofabrik — внутри Италии.
  SM: ['europe/italy'],
  VA: ['europe/italy'],
  XK: ['europe/kosovo'],
  // СНГ и соседи: Украина, Беларусь, Молдова, Грузия — в Европе Geofabrik, остальные — в Азии.
  AM: ['asia/armenia'],
  AZ: ['asia/azerbaijan'],
  BY: ['europe/belarus'],
  GE: ['europe/georgia'],
  KG: ['asia/kyrgyzstan'],
  KZ: ['asia/kazakhstan'],
  MD: ['europe/moldova'],
  TJ: ['asia/tajikistan'],
  TM: ['asia/turkmenistan'],
  UA: ['europe/ukraine'],
  UZ: ['asia/uzbekistan'],
  // Ближний Восток.
  IL: ['asia/israel-and-palestine'],
  TR: ['europe/turkey'],
  LB: ['asia/lebanon'],
  SY: ['asia/syria'],
  JO: ['asia/jordan'],
  IQ: ['asia/iraq'],
  IR: ['asia/iran'],
  // Страны Персидского залива у Geofabrik — одним файлом.
  SA: ['asia/gcc-states'],
  AE: ['asia/gcc-states'],
  QA: ['asia/gcc-states'],
  BH: ['asia/gcc-states'],
  KW: ['asia/gcc-states'],
  OM: ['asia/gcc-states'],
  YE: ['asia/yemen'],
  EG: ['africa/egypt'],
}

/**
 * Задания: по файлу Geofabrik (Сан-Марино и Ватикан — в задании Италии, Аланды — Финляндии),
 * регионы — те, у которых своя карта (у нарезанной страны — её части).
 */
export function plan(regions, group, only = null) {
  const bySource = new Map()
  for (const r of mapRegions(regions)) {
    if (r.group !== group) continue
    const country = r.country.toLowerCase()
    if (only && !only.has(country) && !only.has(r.id)) continue
    const sources = GEOFABRIK[r.country]
    if (!sources) throw new Error(`нет файла Geofabrik для страны ${r.country}`)
    const k = sources.join(' ')
    if (!bySource.has(k)) bySource.set(k, { key: sources[0].split('/').pop(), regions: [], sources: k })
    bySource.get(k).regions.push(r.id)
  }
  return [...bySource.values()].map((j) => ({ ...j, regions: j.regions.join(',') }))
}

async function main() {
  const { values: o } = parseArgs({ options: { group: { type: 'string' }, only: { type: 'string' } } })
  if (!o.group) throw new Error('нужна --group')
  const only = o.only ? new Set(o.only.split(',').map((s) => s.trim()).filter(Boolean)) : null
  const regionsPath = fileURLToPath(new URL('../maps-build/regions.json', import.meta.url))
  console.log(JSON.stringify(plan(loadRegions(regionsPath), o.group, only)))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
