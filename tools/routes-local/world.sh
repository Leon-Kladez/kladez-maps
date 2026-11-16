#!/usr/bin/env bash
# Дороги всего мира на арендованном сервере без присмотра: граф Старого Света (с Африкой и
# Океанией), проверка маршрутов, выкладка; затем граф Америки — так же. Если проверка не прошла,
# наборы этого графа не выкладываются. Ход — в /work/routes-build/world.log.
#   GH_TOKEN=… nohup bash /work/maps-repo/tools/routes-local/world.sh [world|americas|both] &
# Нужны docker, node и gh на сервере; в /work — maps-repo/tools и routes-build/outlines-world,
# outlines-americas. Повторный запуск продолжает: собранный и выложенный граф пропускается.
set -u
W=/work/routes-build
T=/work/maps-repo/tools
IMG=ghcr.io/valhalla/valhalla:3.9.1
V=${VERSION:-2026-11}
log() { echo "[$(date '+%F %T')] $*" | tee -a "$W/world.log"; }

# Проверка: Valhalla по всему графу и по наборам «как у пользователя».
check() {
  name=$1 out=$2 user_regions=$3 user_check=$4
  shift 4
  docker rm -f serve >/dev/null 2>&1
  docker run -d --name serve -u root --entrypoint sleep -v /work:/work -v /data:/data -e OUT="$out" "$IMG" infinity >/dev/null
  docker exec serve bash "$T/routes-local/build.sh" setup >/dev/null 2>&1
  docker exec serve bash "$T/routes-local/build.sh" serve >>"$W/check-$name.log" 2>&1 || { log "$name: Valhalla не запустилась"; return 1; }
  ip=$(docker inspect serve -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
  for r in "$@"; do
    VALHALLA_URL=http://$ip:8102 timeout 300 node "$T/search-build/route-check.mjs" "$r" >>"$W/check-$name.log" 2>&1 ||
      { log "$name: маршрут $r НЕ построился"; return 1; }
  done
  # shellcheck disable=SC2086
  docker exec serve bash "$T/routes-local/build.sh" user $user_regions >>"$W/check-$name.log" 2>&1 || { log "$name: наборы пользователя не запустились"; return 1; }
  VALHALLA_URL=http://$ip:8102 timeout 300 node "$T/search-build/route-check.mjs" "$user_check" >>"$W/check-$name.log" 2>&1 ||
    { log "$name: маршрут $user_check по наборам $user_regions НЕ построился"; return 1; }
  docker rm -f serve >/dev/null 2>&1
  grep -E '\((auto|pedestrian|bicycle)\):' "$W/check-$name.log" | tail -40 >>"$W/world.log"
}

graph() {
  name=$1 sources=$2 user_regions=$3 user_check=$4
  shift 4
  out=$W/packs-$name
  [ -f "$W/$name.uploaded" ] && { log "$name: уже выложен"; return 0; }
  if [ ! -f "$W/$name.built" ]; then
    log "$name: сборка"
    rm -rf /data/* "$out"
    docker rm -f build >/dev/null 2>&1
    docker run --name build -u root --entrypoint bash -v /work:/work -v /data:/data \
      -e ROAD_SOURCES="$sources" -e OUTLINES="$W/outlines-$name" -e OUT="$out" "$IMG" \
      -c "bash $T/routes-local/build.sh all" >"$W/build-$name.log" 2>&1 ||
      { log "$name: сборка упала — см. build-$name.log"; return 1; }
    touch "$W/$name.built"
    log "$name: собран, наборов $(ls "$out" | wc -l), $(du -sh "$out" | cut -f1)"
  fi
  check "$name" "$out" "$user_regions" "$user_check" "$@" || return 1
  log "$name: маршруты в порядке, выкладываю"
  WORK=$W/upload-$name bash "$T/routes-local/upload.sh" "$out" "$V" >"$W/upload-$name.log" 2>&1 ||
    { log "$name: выкладка упала — см. upload-$name.log"; return 1; }
  grep -q ВЫЛОЖЕНО "$W/upload-$name.log" || { log "$name: выкладка не дошла до конца"; return 1; }
  touch "$W/$name.uploaded"
  log "$name: ВЫЛОЖЕН ($(grep -c ' → ' "$W/upload-$name.log") наборов)"
  rm -rf "$out"
}

what=${1:-both}
ok=true
if [ "$what" != americas ]; then
  graph world "" "eg sd" africa-cross \
    ru-central cross eu-cross ru-eu cn-east jp-center asia-cross za ke africa-cross au-nsw nz || ok=false
fi
if [ "$what" != world ]; then
  graph americas americas "us-ca mx-north" latam-cross \
    us-ny us-ca ca-on na-cross mx-center br-sao-paulo latam-cross || ok=false
fi
$ok && log "ВСЁ ГОТОВО" || log "ЕСТЬ ОШИБКИ"
