// Черновой список карт до первой сборки: оценочные размеры, пометка planned (файлов ещё нет).
import { packageFilename } from './package.mjs'

/** Должен совпадать с KLADEZ_MAPS_REPO в admin/constants/map_regions.ts. */
export const KLADEZ_MAPS_REPO_PLACEHOLDER = 'Leon-Kladez/kladez-maps'
/** Обзорный вариант (масштаб 13) — примерно четверть подробного; уточнится первой сборкой. */
export const OVERVIEW_SHARE = 0.25

export function draftResults(regions, estimatesMb, version) {
  return regions.flatMap((region) => {
    const full = estimatesMb[region.id]
    if (typeof full !== 'number') throw new Error(`${region.id}: нет оценки размера в estimates.json`)
    return region.variants.map((variant) => ({
      region,
      variant,
      filename: packageFilename(region.id, variant, version),
      bytes: (variant === 'overview' ? Math.max(5, Math.round(full * OVERVIEW_SHARE)) : full) * 1_000_000,
    }))
  })
}
