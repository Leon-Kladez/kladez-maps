#!/usr/bin/env bash
# Скачать данные OpenStreetMap для региона России (Geofabrik, по федеральным округам) в <dir>/source.osm.pbf.
# Общий шаг сборки указателей поиска и файлов дорог.
#   fetch-region.sh <регион> <dir>
set -euo pipefail
REGION=$1
DIR=$2
# Округа Geofabrik; соседний берём, где границы округов менялись (Бурятия, Забайкалье).
case "$REGION" in
  ru-central) src="central-fed-district" ;;
  ru-northwest) src="northwestern-fed-district" ;;
  ru-south) src="south-fed-district crimean-fed-district" ;;
  ru-north-caucasus) src="north-caucasus-fed-district" ;;
  ru-volga) src="volga-fed-district" ;;
  ru-urals) src="ural-fed-district" ;;
  ru-siberia) src="siberian-fed-district" ;;
  ru-far-east-south) src="far-eastern-fed-district siberian-fed-district" ;;
  ru-far-east-north) src="far-eastern-fed-district" ;;
  *) echo "нет источника для $REGION"; exit 1 ;;
esac
paths=()
for s in $src; do paths+=("russia/$s"); done
exec "$(dirname "$0")/fetch-sources.sh" "$DIR" "${paths[@]}"
