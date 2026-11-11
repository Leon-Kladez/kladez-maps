#!/usr/bin/env bash
# Сборка дорог Кладезя для России и всей Европы на своём компьютере (бесплатный сервер GitHub
# не вмещает Европу по диску). Запускается ВНУТРИ временной WSL-среды из образа Valhalla:
#   wsl -d KladezRoutes -u root -- bash /mnt/d/…/maps-repo/tools/routes-local/build.sh <этап>
# Этапы: setup | data | graph | packs | serve <папка tiles> | all (= setup data graph packs)
# Данные — в /data (своя файловая система среды, быстро); готовые наборы — в $OUT на диске D:.
# Повторный запуск этапа продолжает с того, что уже есть (скачанное не качается заново).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
BUILD=${BUILD:-$(cd "$REPO/../routes-build" && pwd)}
OUT=$BUILD/packs
OUTLINES=$BUILD/outlines
VERSION=${VERSION:-2026-11}
D=/data
log() { echo "[$(date '+%F %T')] $*"; }

setup() {
  export DEBIAN_FRONTEND=noninteractive
  command -v osmium >/dev/null && python3 -c 'import shapely' 2>/dev/null && return
  apt-get update -qq
  apt-get install -y -qq osmium-tool python3-shapely curl ca-certificates
}

data() {
  mkdir -p "$D/src"
  [ -s "$D/source.osm.pbf" ] && { log "данные уже готовы"; return; }
  # Европа у Geofabrik уже включает Украину, Беларусь, Молдову, Грузию и Турцию; остальное СНГ и
  # Израиль — из Азии. Всё одной сборкой: эти страны граничат и с Россией, и с Европой.
  for s in russia russia/crimean-fed-district europe asia/kazakhstan asia/uzbekistan asia/kyrgyzstan            asia/tajikistan asia/turkmenistan asia/azerbaijan asia/armenia asia/israel-and-palestine; do
    b=$(basename "$s")
    [ -s "$D/src/$b.roads.osm.pbf" ] && continue
    url="https://download.geofabrik.de/${s}-latest.osm.pbf"
    log "скачиваю $s"
    curl -fsSL --retry 5 -C - -o "$D/src/$b.osm.pbf" "$url"
    if curl -fsSL --retry 3 -o "$D/src/$b.md5" "$url.md5"; then
      (cd "$D/src" && sed "s#[^ ]*\$#$b.osm.pbf#" "$b.md5" | md5sum -c -)
    else
      log "нет контрольной суммы для $s — без проверки md5"
    fi
    log "оставляю только дороги: $s"
    # Дороги, паромы, платформы и причалы, запреты поворотов, границы (для стран и часовых поясов).
    osmium tags-filter "$D/src/$b.osm.pbf" w/highway w/route=ferry w/railway=platform \
      w/public_transport=platform w/man_made=pier r/type=restriction r/boundary=administrative \
      -o "$D/src/$b.roads.osm.pbf.part" --overwrite -f pbf
    mv "$D/src/$b.roads.osm.pbf.part" "$D/src/$b.roads.osm.pbf"
    rm -f "$D/src/$b.osm.pbf"
    ls -la "$D/src/$b.roads.osm.pbf"; df -h "$D" | tail -1
  done
  osmium merge "$D"/src/*.roads.osm.pbf -o "$D/source.osm.pbf" --overwrite
  rm -rf "$D/src"
  ls -la "$D/source.osm.pbf"
}

graph() {
  [ -f "$D/tiles/.done" ] && { log "граф уже собран"; return; }
  cd "$D"
  rm -rf "$D/tiles" && mkdir -p "$D/tiles"
  valhalla_build_config --mjolnir-tile-dir "$D/tiles" --mjolnir-tile-extract "$D/no-extract.tar" \
    --mjolnir-admin "$D/tiles/admins.sqlite" --mjolnir-timezone "$D/tiles/timezones.sqlite" \
    --mjolnir-concurrency "$(nproc)" > "$D/valhalla.json"
  log "часовые пояса"
  valhalla_build_timezones > "$D/tiles/timezones.sqlite" || { log "часовые пояса не скачались — без них"; rm -f "$D/tiles/timezones.sqlite"; }
  log "границы стран"
  valhalla_build_admins -c "$D/valhalla.json" "$D/source.osm.pbf"
  log "граф дорог"
  start=$(date +%s)
  valhalla_build_tiles -c "$D/valhalla.json" "$D/source.osm.pbf"
  log "граф собран за $(( ($(date +%s) - start) / 60 )) мин"
  rm -f "$D"/*.bin
  touch "$D/tiles/.done"
  du -sh "$D/tiles"; df -h "$D" | tail -1
}

packs() {
  mkdir -p "$OUT"
  extras=()
  for f in "$D/tiles/admins.sqlite" "$D/tiles/timezones.sqlite"; do [ -f "$f" ] && extras+=("$f"); done
  python3 "$REPO/tools/search-build/route_packs.py" --tiles "$D/tiles" --outlines "$OUTLINES" --out "$OUT" \
    --version "$VERSION" --regions "$(cat "$OUTLINES/regions.txt")" --extra "${extras[@]}" | tee "$BUILD/packs.json"
  for f in "$OUT"/*.tar; do
    [ "$(stat -c %s "$f")" -lt 2100000000 ] || { echo "$f больше 2 ГБ — GitHub не примет, нужно делить"; exit 1; }
  done
  du -sh "$OUT"
}

# Valhalla на порту 8102 (у самого Кладезя свой на 8002) по указанной папке кусочков графа.
serve() {
  tiles=${1:-$D/tiles}
  pkill -f valhalla_service 2>/dev/null || true
  sleep 1
  sed -e "s#$D/tiles#$tiles#g" -e 's#tcp://\*:8002#tcp://*:8102#' "$D/valhalla.json" > "$D/serve.json"
  nohup valhalla_service "$D/serve.json" 2 > "$D/serve.log" 2>&1 &
  for i in $(seq 1 120); do curl -sf localhost:8102/status >/dev/null && { log "Valhalla готова: $tiles"; return; }; sleep 2; done
  tail -20 "$D/serve.log"; exit 1
}

# Папка «как у пользователя»: только наборы указанных регионов.
user() {
  rm -rf "$D/user" && mkdir -p "$D/user/tiles"
  for p in "$@"; do tar -xf "$OUT/routes-${p}_$VERSION.tar" -C "$D/user/tiles"; done
  du -sh "$D/user/tiles"
  serve "$D/user/tiles"
}

stage=${1:-all}
shift || true
case "$stage" in
  setup) setup ;;
  data) data ;;
  graph) graph ;;
  packs) packs ;;
  serve) serve "$@" ;;
  user) user "$@" ;;
  all) setup; data; graph; packs ;;
  *) echo "неизвестный этап: $stage"; exit 2 ;;
esac
log "готово: $stage"
