export const PMTILES_BINARY_PATH = '/usr/local/bin/pmtiles'

// Clamp these so a user can't ask for nonsense that never extracts
export const EXTRACT_MIN_ZOOM = 0
export const EXTRACT_MAX_ZOOM = 15
export const EXTRACT_DEFAULT_MAX_ZOOM = 15

// Low-zoom global fallback extracted once during base-asset setup (~15 MB). Layered
// underneath regional extracts so the map isn't grey outside a region's polygon.
export const WORLD_BASEMAP_FILENAME = 'world.pmtiles'
export const WORLD_BASEMAP_MAX_ZOOM = 5
export const WORLD_BASEMAP_SOURCE_NAME = 'world'

export interface PmtilesExtractArgOptions {
  sourceUrl: string
  outputFilepath: string
  regionFilepath?: string
  maxzoom?: number
  dryRun?: boolean
  downloadThreads?: number
  overfetch?: number
}

export function buildPmtilesExtractArgs(opts: PmtilesExtractArgOptions): string[] {
  const args = ['extract', opts.sourceUrl, opts.outputFilepath]
  if (opts.regionFilepath) args.push(`--region=${opts.regionFilepath}`)
  if (typeof opts.maxzoom === 'number') args.push(`--maxzoom=${opts.maxzoom}`)
  if (opts.dryRun) args.push('--dry-run')
  if (typeof opts.downloadThreads === 'number') args.push(`--download-threads=${opts.downloadThreads}`)
  if (typeof opts.overfetch === 'number') args.push(`--overfetch=${opts.overfetch}`)
  return args
}

// ---- Карты Кладезя ----

/** Встроенный архив базовых материалов карты (стиль с русскими подписями, шрифты, значки), от process.cwd(). */
export const BUNDLED_BASE_ASSETS_PATH = 'resources/maps/base-assets.tar.gz'

/**
 * Открытый репозиторий с готовыми картами (GitHub Releases). Владелец ещё не выбран:
 * автор заведёт новый аккаунт перед выпуском (план части 3, задача 13). До этого адрес
 * не отвечает, и программа берёт встроенную копию collections-ru/maps.json.
 */
export const KLADEZ_MAPS_REPO = 'kladez-maps-owner/kladez-maps'

/** Адрес списка карт по умолчанию; часть 2 подставляет его в SPEC_URLS.maps через mapsCatalogUrl(). */
export const DEFAULT_MAPS_CATALOG_URL = `https://github.com/${KLADEZ_MAPS_REPO}/releases/latest/download/maps.json`

/**
 * Версия базовых материалов карты Кладезя (стиль с русскими подписями). Лежит в архиве файлом
 * kladez-base-assets.txt. Если на диске другая метка или её нет (например, остались английские
 * материалы NOMAD), программа заменяет их встроенным архивом. Меняйте вместе с архивом.
 */
export const KLADEZ_BASE_ASSETS_VERSION = 'kladez-ru-1'
export const KLADEZ_BASE_ASSETS_MARKER = 'kladez-base-assets.txt'
