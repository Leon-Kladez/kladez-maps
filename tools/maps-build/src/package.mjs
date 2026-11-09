// Упаковка готовых файлов: сумма, торрент, адреса, maps.json (формат NOMAD + поля Кладезя).
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { GROUPS } from './regions.mjs'

export const GROUP_NAMES = {
  'russia': 'Россия',
  'cis': 'СНГ и соседи',
  'europe': 'Европа',
  'middle-east': 'Ближний Восток',
  'north-america': 'Северная Америка',
}
export const GROUP_DESCRIPTIONS = {
  'russia': 'Карты России по федеральным округам.',
  'cis': 'Карты стран СНГ и соседних стран.',
  'europe': 'Карты стран Европы, крупные страны — по частям.',
  'middle-east': 'Карты стран Ближнего Востока.',
  'north-america': 'Карты США по штатам и Канады по провинциям.',
}
export const TRACKERS = ['udp://tracker.opentrackr.org:1337/announce', 'udp://open.demonii.com:1337/announce']

export function packageId(regionId, variant) {
  return variant === 'overview' ? `${regionId}-overview` : regionId
}

/** Имя файла `<id>_<ГГГГ-ММ>.pmtiles` — так его разбирает CollectionManifestService.parseMapFilename. */
export function packageFilename(regionId, variant, version) {
  return `${packageId(regionId, variant)}_${version}.pmtiles`
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  })
}

export function mktorrentArgs({ file, out, webseeds }) {
  return [...TRACKERS.flatMap((t) => ['-a', t]), ...webseeds.flatMap((w) => ['-w', w]), '-o', out, file]
}

export function assetUrl(repo, tag, filename) {
  return `https://github.com/${repo}/releases/download/${tag}/${filename}`
}

/**
 * @param {{ region: import('./regions.mjs').Region, variant: 'full'|'overview', filename: string, bytes: number, sha256: string }[]} results
 * @param {{ repo: string, tag: string, version: string, builtAt: string, yandexBase?: string, planned?: boolean }} opts
 *   planned — черновик до первой сборки: размеры — оценка, файлов ещё нет, программа их не скачивает.
 */
export function buildMapsManifest(results, opts) {
  const byGroup = new Map()
  for (const r of results) {
    const url = assetUrl(opts.repo, opts.tag, r.filename)
    const resource = {
      id: packageId(r.region.id, r.variant),
      version: opts.version,
      title: r.variant === 'overview' ? `${r.region.title} (обзорно)` : r.region.title,
      description: (r.region.contents || `Карта: ${r.region.title}`) + (opts.planned ? ' (файлы ещё не опубликованы, размер — оценка)' : ''),
      url,
      size_mb: Math.ceil(r.bytes / 1e6),
      ...(r.sha256 ? { sha256: r.sha256 } : {}),
      ...(opts.yandexBase ? { mirrors: [opts.yandexBase + r.filename] } : {}),
      torrent: url + '.torrent',
      detail: r.variant,
      country: r.region.country,
      // Все страны пакета: «Израиль и Палестина» находится и по IL, и по PS.
      countries: [...new Set([r.region.country, ...(r.region.source.countries ?? [])])],
      ...(r.region.contents ? { contents: r.region.contents } : {}),
      ...(opts.planned ? { planned: true } : {}),
    }
    if (!byGroup.has(r.region.group)) byGroup.set(r.region.group, [])
    byGroup.get(r.region.group).push(resource)
  }
  return {
    spec_version: opts.builtAt,
    collections: GROUPS.filter((g) => byGroup.has(g)).map((g) => ({
      name: GROUP_NAMES[g],
      slug: g,
      description: GROUP_DESCRIPTIONS[g],
      icon: 'IconMap',
      language: 'ru',
      resources: byGroup.get(g),
    })),
  }
}

/** Склеивает частичные манифесты групп в один maps.json (порядок групп — как в GROUPS). */
export function mergeManifests(parts) {
  const collections = parts.flatMap((p) => p.collections)
  collections.sort((a, b) => GROUPS.indexOf(a.slug) - GROUPS.indexOf(b.slug))
  return { spec_version: parts.map((p) => p.spec_version).sort().at(-1), collections }
}

/**
 * Новые части поверх прежнего списка: регион с тем же id заменяется, остальные
 * остаются как были. Так сборка по частям (сначала Россия, потом остальное) не
 * стирает уже выложенные регионы, а ещё не собранные остаются «скоро» (planned).
 * @param {{ spec_version: string, collections: any[] }} base
 * @param {{ spec_version: string, collections: any[] }[]} parts
 */
export function overlayManifests(base, parts) {
  const collections = (base?.collections ?? []).map((c) => ({ ...c, resources: [...c.resources] }))
  for (const part of parts) {
    for (const col of part.collections) {
      let target = collections.find((c) => c.slug === col.slug)
      if (!target) {
        target = { ...col, resources: [] }
        collections.push(target)
      }
      for (const res of col.resources) {
        const i = target.resources.findIndex((r) => r.id === res.id)
        // Указатель поиска собирается отдельно (build-search) — пересборка карты его не стирает.
        if (i >= 0) target.resources[i] = !res.search && target.resources[i].search ? { ...res, search: target.resources[i].search } : res
        else target.resources.push(res)
      }
    }
  }
  collections.sort((a, b) => GROUPS.indexOf(a.slug) - GROUPS.indexOf(b.slug))
  const versions = parts.map((p) => p.spec_version).sort()
  return { spec_version: versions.at(-1) ?? base?.spec_version, collections }
}
