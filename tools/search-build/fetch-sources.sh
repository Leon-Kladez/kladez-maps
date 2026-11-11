#!/usr/bin/env bash
# Скачать файлы OpenStreetMap с Geofabrik (с проверкой md5) и слить в <dir>/source.osm.pbf.
#   fetch-sources.sh <dir> <путь Geofabrik>...   например: fetch-sources.sh work europe/france
# Путь — без «-latest.osm.pbf». Файл, который не скачался, пропускается с предупреждением.
set -euo pipefail
DIR=$1
shift
mkdir -p "$DIR/src"
files=()
for path in "$@"; do
  s=$(basename "$path")
  url="https://download.geofabrik.de/${path}-latest.osm.pbf"
  if curl -fsSL --retry 3 -o "$DIR/src/$s.osm.pbf" "$url"; then
    curl -fsSL --retry 3 -o "$DIR/src/$s.md5" "$url.md5"
    (cd "$DIR/src" && sed "s#[^ ]*\$#$s.osm.pbf#" "$s.md5" | md5sum -c -)
    files+=("$DIR/src/$s.osm.pbf")
  else
    echo "::warning::не удалось скачать $path — без него"
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
