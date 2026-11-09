"""Проверка сборщика указателя поиска на маленьком наборе объектов (без osmium)."""
import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_index as bi  # noqa: E402


def feat(props, geom):
    return json.dumps({'type': 'Feature', 'properties': props, 'geometry': geom}, ensure_ascii=False)


def pt(lat, lon):
    return {'type': 'Point', 'coordinates': [lon, lat]}


def line(*pts):
    return {'type': 'LineString', 'coordinates': [[lon, lat] for lat, lon in pts]}


MOSCOW = (55.7558, 37.6173)
FIXTURE = [
    feat({'place': 'city', 'name': 'Москва', 'name:en': 'Moscow', 'population': '13000000'}, pt(*MOSCOW)),
    feat({'place': 'village', 'name': 'Ивановка'}, pt(55.30, 37.00)),
    feat({'place': 'suburb', 'name': 'Замоскворечье'}, pt(55.735, 37.63)),
    # Улица из двух кусков — одна запись.
    feat({'highway': 'tertiary', 'name': 'Пятницкая улица', 'name:en': 'Pyatnitskaya Street'},
         line((55.745, 37.627), (55.742, 37.628))),
    feat({'highway': 'tertiary', 'name': 'Пятницкая улица'}, line((55.740, 37.628), (55.737, 37.629))),
    # Такая же улица в деревне — отдельная запись со своим «городом».
    feat({'highway': 'residential', 'name': 'Пятницкая улица'}, line((55.301, 37.001), (55.302, 37.002))),
    # Дома: «улица Пятницкая» (другой порядок слов) — та же улица.
    feat({'building': 'yes', 'addr:street': 'улица Пятницкая', 'addr:housenumber': '7 с2'},
         {'type': 'Polygon', 'coordinates': [[[37.6275, 55.7440], [37.6278, 55.7440], [37.6278, 55.7442], [37.6275, 55.7440]]]}),
    feat({'addr:street': 'Пятницкая улица', 'addr:housenumber': '5'}, pt(55.3012, 37.0012)),
    # Адрес по посёлку без улиц.
    feat({'addr:place': 'Ивановка', 'addr:housenumber': '12'}, pt(55.3005, 37.0003)),
    # Адрес на улице, которой нет среди дорог.
    feat({'addr:street': 'Садовая улица', 'addr:housenumber': '3'}, pt(55.7500, 37.6100)),
    # Места.
    feat({'amenity': 'pharmacy', 'name': 'Ригла', 'addr:street': 'Пятницкая улица', 'addr:housenumber': '7'},
         pt(55.7441, 37.6276)),
    feat({'amenity': 'pharmacy'}, pt(55.3003, 37.0004)),  # без названия — всё равно ищется
    feat({'amenity': 'bench', 'name': 'Скамейка'}, pt(55.74, 37.62)),  # скучное — нет
    feat({'railway': 'station', 'station': 'subway', 'name': 'Третьяковская'}, pt(55.7408, 37.6262)),
    '\x1e' + feat({'shop': 'bakery', 'name': 'Хлеб'}, pt(55.743, 37.627)),
    '{битая строка',
]


class BuildIndexTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.path = os.path.join(cls.dir, 'search-test.sqlite')
        cls.meta = bi.build(FIXTURE, cls.path, 'ru-test', '2026-11', log=open(os.devnull, 'w'))
        cls.db = sqlite3.connect(cls.path)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def find(self, q):
        return self.db.execute(
            'SELECT i.cls, i.kind, i.name, i.city, i.id FROM items_fts f JOIN items i ON i.id = f.rowid '
            'WHERE items_fts MATCH ? ORDER BY i.rank DESC', (q,)).fetchall()

    def test_meta(self):
        meta = dict(self.db.execute('SELECT key, value FROM meta'))
        self.assertEqual(meta['schema'], str(bi.SCHEMA_VERSION))
        self.assertEqual(meta['region'], 'ru-test')
        self.assertEqual(meta['version'], '2026-11')

    def test_city_and_prefix(self):
        r = self.find('"моск"*')
        self.assertEqual(r[0][:3], ('place', 'city', 'Москва'))
        self.assertTrue(self.find('moscow'))

    def test_street_pieces_merged_per_city(self):
        r = [x for x in self.find('пятницкая') if x[0] == 'street']
        cities = sorted(x[3] for x in r)
        self.assertEqual(cities, ['Ивановка', 'Москва'])

    def test_houses_attached_to_right_street(self):
        moscow_street = next(x for x in self.find('пятницкая') if x[0] == 'street' and x[3] == 'Москва')[4]
        village_street = next(x for x in self.find('пятницкая') if x[0] == 'street' and x[3] == 'Ивановка')[4]
        h = self.db.execute('SELECT house FROM houses WHERE street_id=? ORDER BY house', (moscow_street,)).fetchall()
        self.assertEqual(h, [('7',), ('7 с2',)])  # дом и адрес аптеки
        h = self.db.execute('SELECT house FROM houses WHERE street_id=?', (village_street,)).fetchall()
        self.assertEqual(h, [('5',)])

    def test_address_by_place(self):
        village = next(x for x in self.find('ивановка') if x[0] == 'place')[4]
        h = self.db.execute('SELECT house FROM houses WHERE street_id=?', (village,)).fetchall()
        self.assertEqual(h, [('12',)])

    def test_street_from_addresses_only(self):
        r = [x for x in self.find('садовая') if x[0] == 'street']
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0][3], 'Москва')

    def test_poi_by_name_and_by_kind_word(self):
        self.assertEqual(self.find('ригла')[0][1:3], ('pharmacy', 'Ригла'))
        kinds = {x[1] for x in self.find('аптека')}
        self.assertEqual(kinds, {'pharmacy'})
        self.assertEqual(len(self.find('аптека')), 2)  # и безымянная
        self.assertEqual(self.find('метро')[0][1:3], ('metro', 'Третьяковская'))
        self.assertEqual(self.find('скамейка'), [])
        self.assertTrue(self.find('хлеб'))  # строка с разделителем записей

    def test_suburb_gets_city(self):
        r = next(x for x in self.find('замоскворечье'))
        self.assertEqual(r[3], 'Москва')

    def test_search_with_city_word(self):
        r = self.find('пятницкая москва')
        self.assertTrue(any(x[0] == 'street' and x[3] == 'Москва' for x in r))
        self.assertFalse(any(x[3] == 'Ивановка' for x in r))

    def test_street_key(self):
        self.assertEqual(bi.street_key('улица Ленина'), bi.street_key('Ленина улица'))
        self.assertEqual(bi.street_key('ул. Ленина'), bi.street_key('улица Ленина'))
        self.assertEqual(bi.street_key('Улица Ёлкина'), bi.street_key('улица Елкина'))


if __name__ == '__main__':
    unittest.main()
