#!/usr/bin/env bash
# Выкладка наборов дорог в выпуски карт и дописывание их в maps.json.
#   GH_TOKEN=… tools/routes-local/upload.sh <папка с routes-*.tar> [ГГГГ-ММ]
# Азия, обе Америки, Африка и Океания — в своих выпусках (asia-, america-, latam-, africa-,
# oceania-ГГГГ-ММ: в выпуске GitHub не больше 1000 файлов), остальное — в maps-ГГГГ-ММ; список maps.json — всегда в maps-ГГГГ-ММ. Повторный запуск продолжает: уже
# описанные наборы (parts/<имя>.json) не выкладываются заново. Ключ GitHub — только в окружении.
set -u
PACKS=${1:?папка с наборами}
V=${2:-2026-11}
REPO=Leon-Kladez/kladez-maps
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK=${WORK:-$PACKS/../upload}
mkdir -p "$WORK/parts" "$WORK/base"
# Выпуск для каждого региона: группа → asia-, america-, latam-, africa-, oceania- или maps-ГГГГ-ММ.
TAGS=$(node -e "
  const pre = { asia: 'asia', 'north-america': 'america', 'latin-america': 'latam', africa: 'africa', oceania: 'oceania' }
  const r = require('$ROOT/tools/maps-build/regions.json').regions
  for (const x of r) console.log(x.id + ' ' + (pre[x.group] ?? 'maps'))")
n=0
for f in "$PACKS"/routes-*_"$V".tar; do
  b=$(basename "$f" .tar)
  [ -s "$WORK/parts/$b.json" ] && continue
  id=${b#routes-}; id=${id%_"$V"}
  tag=$(echo "$TAGS" | awk -v id="$id" '$1 == id { print $2 }')-$V
  [ "$tag" = "-$V" ] && { echo "нет региона $id в regions.json"; exit 1; }
  gh release view "$tag" --repo "$REPO" >/dev/null 2>&1 ||
    gh release create "$tag" --repo "$REPO" --title "Карты $tag" --latest=false --notes "Для Кладезя: список карт — в выпуске maps-$V."
  ok=false
  for i in 1 2 3 4 5; do
    gh release upload "$tag" "$f" --repo "$REPO" --clobber && { ok=true; break; }
    echo "повтор $b ($i)"; sleep 30
  done
  $ok || { echo "НЕ ВЫЛОЖЕН $b"; exit 1; }
  node "$ROOT/tools/search-build/attach.mjs" describe --file "$f" --repo "$REPO" --tag "$tag" > "$WORK/parts/$b.json"
  n=$((n + 1)); echo "[$(date +%T)] $n $b → $tag"
done
gh release download "maps-$V" --repo "$REPO" --pattern maps.json --dir "$WORK/base" --clobber
cp "$WORK/base/maps.json" "$WORK/base/maps.json.before"
node "$ROOT/tools/search-build/attach.mjs" --manifest "$WORK/base/maps.json" --parts "$WORK/parts"
gh release upload "maps-$V" "$WORK/base/maps.json" --repo "$REPO" --clobber
echo ВЫЛОЖЕНО
