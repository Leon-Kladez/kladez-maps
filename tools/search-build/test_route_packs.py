"""Нарезка графа дорог по регионам: геометрия кусочков и выбор кусочков для региона."""
import os
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import route_packs as rp  # noqa: E402


def square(w, s, e, n):
    return {'type': 'MultiPolygon', 'coordinates': [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]]}


def tile_path(level, lon, lat):
    size = rp.TILE_SIZE[level]
    ncols = int(round(360 / size))
    row = int((lat + 90) // size)
    col = int((lon + 180) // size)
    tid = row * ncols + col
    # Как в Valhalla: номер дополняется нулями до кратного трём числа цифр максимального номера уровня.
    digits = f'{tid:09d}' if level == 2 else f'{tid:06d}'
    parts = [digits[i:i + 3] for i in range(0, len(digits), 3)]
    return f'{level}/' + '/'.join(parts) + '.gph'


class RoutePacksTest(unittest.TestCase):
    def test_tile_bbox(self):
        # Москва (37.6, 55.75) на уровне 2 — квадрат 0,25° с этой точкой.
        w, s, e, n = rp.tile_bbox(tile_path(2, 37.6, 55.75))
        self.assertTrue(w <= 37.6 < e and s <= 55.75 < n)
        self.assertAlmostEqual(e - w, 0.25)
        w, s, e, n = rp.tile_bbox(tile_path(0, 37.6, 55.75))
        self.assertAlmostEqual(e - w, 4.0)
        self.assertIsNone(rp.tile_bbox('2/000/1.txt'))
        self.assertIsNone(rp.tile_bbox('admins.sqlite'))

    def test_border_tiles_go_to_both_regions(self):
        west = rp.Region('west', square(30, 50, 40, 60))
        east = rp.Region('east', square(40, 50, 50, 60))
        tiles = [(p, rp.tile_bbox(p)) for p in (
            tile_path(2, 35.1, 55.1),   # глубоко на западе
            tile_path(2, 39.9, 55.1),   # у границы — в обоих
            tile_path(2, 45.1, 55.1),   # глубоко на востоке
            tile_path(2, 80.1, 55.1),   # далеко — ни в одном
            tile_path(0, 41.0, 55.0),   # крупный кусочек на стыке — в обоих
        )]
        packs = rp.plan_packs(tiles, [west, east])
        self.assertIn(tiles[0][0], packs['west'])
        self.assertNotIn(tiles[0][0], packs['east'])
        self.assertIn(tiles[1][0], packs['west'])
        self.assertIn(tiles[1][0], packs['east'])
        self.assertIn(tiles[2][0], packs['east'])
        self.assertNotIn(tiles[3][0], packs['west'] + packs['east'])
        self.assertIn(tiles[4][0], packs['west'])
        self.assertIn(tiles[4][0], packs['east'])

    def test_small_region_inside_big_tile(self):
        tiny = rp.Region('tiny', square(37.5, 55.6, 37.7, 55.8))
        big = tile_path(0, 37.6, 55.7)
        self.assertTrue(tiny.touches(rp.tile_bbox(big), 0))

    def test_pack_files(self):
        d = tempfile.mkdtemp()
        tiles = os.path.join(d, 'tiles')
        rel = tile_path(2, 37.6, 55.75)
        os.makedirs(os.path.join(tiles, os.path.dirname(rel)))
        with open(os.path.join(tiles, rel), 'wb') as fh:
            fh.write(b'x')
        self.assertEqual([t[0] for t in rp.collect_tiles(tiles)], [rel])
        out = os.path.join(d, 'packs')
        os.makedirs(out)
        path = os.path.join(out, 'routes-r_2026-11.tar')
        with tarfile.open(path, 'w') as tf:
            tf.add(os.path.join(tiles, rel), arcname=rel)
        with tarfile.open(path) as tf:
            self.assertEqual(tf.getnames(), [rel])


if __name__ == '__main__':
    unittest.main()
