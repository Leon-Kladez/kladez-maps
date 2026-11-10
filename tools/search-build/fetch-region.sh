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
mkdir -p "$DIR/src"
files=()
for s in $src; do
  url="https://download.geofabrik.de/russia/${s}-latest.osm.pbf"
  if curl -fsSL --retry 3 -o "$DIR/src/$s.osm.pbf" "$url"; then
    curl -fsSL --retry 3 -o "$DIR/src/$s.md5" "$url.md5"
    (cd "$DIR/src" && sed "s#[^ ]*\$#$s.osm.pbf#" "$s.md5" | md5sum -c -)
    files+=("$DIR/src/$s.osm.pbf")
  else
    echo "::warning::не удалось скачать $s — регион без него"
  fi
done
[ ${#files[@]} -gt 0 ] || { echo "нечего обрабатывать"; exit 1; }
if [ ${#files[@]} -gt 1 ]; then
  osmium merge "${files[@]}" -o "$DIR/source.osm.pbf" --overwrite
  rm -f "${files[@]}"
else
  mv "${files[0]}" "$DIR/source.osm.pbf"
fi
ls -la "$DIR/source.osm.pbf"
