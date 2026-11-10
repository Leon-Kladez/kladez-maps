#!/usr/bin/env python3
"""Нарезка графа дорог Valhalla (одна сборка на всю страну) на наборы по регионам.

Кусочки графа (tiles/<уровень>/xxx/yyy/zzz.gph) — квадраты сетки: уровень 0 — 4°, 1 — 1°, 2 — 0,25°.
В набор региона идёт каждый кусочек, задевающий контур региона (с запасом в одну клетку).
Кусочки на границе попадают в оба соседних набора — они одинаковые (одна сборка), поэтому
регионы складываются в одну папку у пользователя без порчи, и маршрут идёт через границу.

    python3 route_packs.py --tiles work/tiles --outlines work --out work/packs --version 2026-11 \\
        --regions ru-central,ru-south [--extra work/admins.sqlite work/timezones.sqlite]
    → work/packs/routes-<регион>_<версия>.tar
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tarfile

TILE_SIZE = {0: 4.0, 1: 1.0, 2: 0.25}
TILE_RE = re.compile(r'^(\d)/((?:\d{3}/)*\d{3})\.gph$')


def tile_bbox(rel: str):
    """'2/000/755/193.gph' → (запад, юг, восток, север); None — не кусочек графа."""
    m = TILE_RE.match(rel.replace(os.sep, '/'))
    if not m:
        return None
    level = int(m.group(1))
    size = TILE_SIZE.get(level)
    if size is None:
        return None
    tid = int(m.group(2).replace('/', ''))
    ncols = int(round(360.0 / size))
    row, col = divmod(tid, ncols)
    w = -180.0 + col * size
    s = -90.0 + row * size
    return (w, s, w + size, s + size)


def rings_of(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def point_in_poly(x, y, poly):
    """poly — [наружное кольцо, дыры…]."""
    def in_ring(ring):
        inside = False
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
                inside = not inside
            j = i
        return inside
    return in_ring(poly[0]) and not any(in_ring(h) for h in poly[1:])


try:  # Быстрая геометрия (на сборке ставится pip install shapely); без неё — медленный запасной путь.
    from shapely.geometry import box as _box, shape as _shape
    from shapely.prepared import prep as _prep
except ImportError:  # pragma: no cover
    _shape = None


class Region:
    def __init__(self, rid: str, geom: dict):
        self.id = rid
        self.polys = rings_of(geom)
        xs = [p[0] for poly in self.polys for p in poly[0]]
        ys = [p[1] for poly in self.polys for p in poly[0]]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))
        # Точки контура — для кусочков крупнее самого региона (уровень 0).
        self.vertices = [(p[0], p[1]) for poly in self.polys for p in poly[0]]
        self.prepared = _prep(_shape(geom).buffer(0)) if _shape else None

    def touches(self, bb, margin: float) -> bool:
        w, s, e, n = bb[0] - margin, bb[1] - margin, bb[2] + margin, bb[3] + margin
        rw, rs, re_, rn = self.bbox
        if e < rw or w > re_ or n < rs or s > rn:
            return False
        if self.prepared is not None:
            return self.prepared.intersects(_box(w, s, e, n))
        # Сетка точек по квадрату (с запасом): хоть одна внутри региона?
        steps = 4
        for i in range(steps + 1):
            for j in range(steps + 1):
                x = w + (e - w) * i / steps
                y = s + (n - s) * j / steps
                if any(point_in_poly(x, y, poly) for poly in self.polys):
                    return True
        # Регион меньше квадрата: хоть одна точка контура внутри квадрата?
        return any(w <= x <= e and s <= y <= n for x, y in self.vertices)


def collect_tiles(tiles_dir: str):
    out = []
    for root, _dirs, files in os.walk(tiles_dir):
        for f in files:
            if not f.endswith('.gph'):
                continue
            rel = os.path.relpath(os.path.join(root, f), tiles_dir).replace(os.sep, '/')
            bb = tile_bbox(rel)
            if bb:
                out.append((rel, bb))
    return sorted(out)


def plan_packs(tiles, regions):
    """{регион: [кусочки]} — с запасом в одну клетку своего уровня."""
    packs = {r.id: [] for r in regions}
    for rel, bb in tiles:
        margin = bb[2] - bb[0]
        for r in regions:
            if r.touches(bb, margin):
                packs[r.id].append(rel)
    return packs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles', required=True)
    ap.add_argument('--outlines', required=True, help='папка с <регион>.geojson (outlines.mjs)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--version', required=True)
    ap.add_argument('--regions', required=True)
    ap.add_argument('--extra', nargs='*', default=[], help='файлы в каждый набор (admins.sqlite, timezones.sqlite)')
    a = ap.parse_args()
    regions = []
    for rid in [x.strip() for x in a.regions.split(',') if x.strip()]:
        with open(os.path.join(a.outlines, f'{rid}.geojson'), encoding='utf-8') as fh:
            regions.append(Region(rid, json.load(fh)['geometry']))
    tiles = collect_tiles(a.tiles)
    print(f'кусочков графа: {len(tiles)}', file=sys.stderr)
    packs = plan_packs(tiles, regions)
    os.makedirs(a.out, exist_ok=True)
    summary = {}
    for rid, rels in packs.items():
        path = os.path.join(a.out, f'routes-{rid}_{a.version}.tar')
        with tarfile.open(path, 'w') as tf:
            for rel in rels:
                tf.add(os.path.join(a.tiles, rel), arcname=rel)
            for extra in a.extra:
                if os.path.exists(extra):
                    tf.add(extra, arcname=os.path.basename(extra))
        summary[rid] = {'tiles': len(rels), 'bytes': os.path.getsize(path)}
        print(f'{rid}: кусочков {len(rels)}, {os.path.getsize(path) // 1_000_000} МБ', file=sys.stderr)
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
