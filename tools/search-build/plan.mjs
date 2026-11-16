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
  CN: ['asia/china'],
  HK: ['asia/china'],
  MO: ['asia/china'],
  TW: ['asia/taiwan'],
  MN: ['asia/mongolia'],
  KR: ['asia/south-korea'],
  KP: ['asia/north-korea'],
  JP: ['asia/japan'],
  IN: ['asia/india'],
  PK: ['asia/pakistan'],
  AF: ['asia/afghanistan'],
  BD: ['asia/bangladesh'],
  NP: ['asia/nepal'],
  BT: ['asia/bhutan'],
  LK: ['asia/sri-lanka'],
  MV: ['asia/maldives'],
  MM: ['asia/myanmar'],
  TH: ['asia/thailand'],
  LA: ['asia/laos'],
  KH: ['asia/cambodia'],
  VN: ['asia/vietnam'],
  MY: ['asia/malaysia-singapore-brunei'],
  SG: ['asia/malaysia-singapore-brunei'],
  BN: ['asia/malaysia-singapore-brunei'],
  PH: ['asia/philippines'],
  ID: ['asia/indonesia'],
  TL: ['asia/east-timor'],
}

/** США и Канада: у каждого штата и провинции свой файл Geofabrik (вся страна — десятки ГБ). */
export const GEOFABRIK_ADMIN1 = {
  'CA-AB': ['north-america/canada/alberta'],
  'CA-BC': ['north-america/canada/british-columbia'],
  'CA-MB': ['north-america/canada/manitoba'],
  'CA-NB': ['north-america/canada/new-brunswick'],
  'CA-NL': ['north-america/canada/newfoundland-and-labrador'],
  'CA-NS': ['north-america/canada/nova-scotia'],
  'CA-NT': ['north-america/canada/northwest-territories'],
  'CA-NU': ['north-america/canada/nunavut'],
  'CA-ON': ['north-america/canada/ontario'],
  'CA-PE': ['north-america/canada/prince-edward-island'],
  'CA-QC': ['north-america/canada/quebec'],
  'CA-SK': ['north-america/canada/saskatchewan'],
  'CA-YT': ['north-america/canada/yukon'],
  'US-AK': ['north-america/us/alaska'],
  'US-AL': ['north-america/us/alabama'],
  'US-AR': ['north-america/us/arkansas'],
  'US-AZ': ['north-america/us/arizona'],
  'US-CA': ['north-america/us/california'],
  'US-CO': ['north-america/us/colorado'],
  'US-CT': ['north-america/us/connecticut'],
  'US-DC': ['north-america/us/district-of-columbia'],
  'US-DE': ['north-america/us/delaware'],
  'US-FL': ['north-america/us/florida'],
  'US-GA': ['north-america/us/georgia'],
  'US-HI': ['north-america/us/hawaii'],
  'US-IA': ['north-america/us/iowa'],
  'US-ID': ['north-america/us/idaho'],
  'US-IL': ['north-america/us/illinois'],
  'US-IN': ['north-america/us/indiana'],
  'US-KS': ['north-america/us/kansas'],
  'US-KY': ['north-america/us/kentucky'],
  'US-LA': ['north-america/us/louisiana'],
  'US-MA': ['north-america/us/massachusetts'],
  'US-MD': ['north-america/us/maryland'],
  'US-ME': ['north-america/us/maine'],
  'US-MI': ['north-america/us/michigan'],
  'US-MN': ['north-america/us/minnesota'],
  'US-MO': ['north-america/us/missouri'],
  'US-MS': ['north-america/us/mississippi'],
  'US-MT': ['north-america/us/montana'],
  'US-NC': ['north-america/us/north-carolina'],
  'US-ND': ['north-america/us/north-dakota'],
  'US-NE': ['north-america/us/nebraska'],
  'US-NH': ['north-america/us/new-hampshire'],
  'US-NJ': ['north-america/us/new-jersey'],
  'US-NM': ['north-america/us/new-mexico'],
  'US-NV': ['north-america/us/nevada'],
  'US-NY': ['north-america/us/new-york'],
  'US-OH': ['north-america/us/ohio'],
  'US-OK': ['north-america/us/oklahoma'],
  'US-OR': ['north-america/us/oregon'],
  'US-PA': ['north-america/us/pennsylvania'],
  'US-RI': ['north-america/us/rhode-island'],
  'US-SC': ['north-america/us/south-carolina'],
  'US-SD': ['north-america/us/south-dakota'],
  'US-TN': ['north-america/us/tennessee'],
  'US-TX': ['north-america/us/texas'],
  'US-UT': ['north-america/us/utah'],
  'US-VA': ['north-america/us/virginia'],
  'US-VT': ['north-america/us/vermont'],
  'US-WA': ['north-america/us/washington'],
  'US-WI': ['north-america/us/wisconsin'],
  'US-WV': ['north-america/us/west-virginia'],
  'US-WY': ['north-america/us/wyoming'],
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
    const a1 = r.source?.admin1 ?? []
    // Штаты и провинции — своими файлами (Мэриленд с Вашингтоном — двумя, они сливаются).
    const byAdmin1 = a1.length > 0 && a1.every((c) => GEOFABRIK_ADMIN1[c]) ? [...new Set(a1.flatMap((c) => GEOFABRIK_ADMIN1[c]))] : null
    const sources = byAdmin1 || GEOFABRIK[r.country]
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
