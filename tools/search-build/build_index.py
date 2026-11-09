#!/usr/bin/env python3
"""Указатель поиска Кладезя для одного региона: города и сёла, улицы, адреса, места.

Читает объекты OpenStreetMap построчно в формате GeoJSONSeq (вывод `osmium export -f geojsonseq`)
со стандартного входа и пишет SQLite-файл, который Кладезъ ищет без интернета (FTS5).

    osmium export region.pbf -f geojsonseq -x print_record_separator=false -o - \\
      | python3 build_index.py --out search-ru-central_2026-11.sqlite --region ru-central --version 2026-11

Схема (SCHEMA_VERSION):
  items(id, cls, kind, name, name_en, city, street, house, lat, lon, rank)
    cls: place — населённый пункт или район; street — улица; poi — место (аптека, школа…)
  items_fts(name, name_en, words, city) — без содержимого (content=''), rowid = items.id
  houses(street_id, house, lat, lon) — дома улицы (street_id → items.id улицы или посёлка)
  meta(key, value)

Данные © участники OpenStreetMap, ODbL.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import sys
import time
from collections import defaultdict

SCHEMA_VERSION = 1

# ---- Населённые пункты ------------------------------------------------------------------------

PLACE_RANK = {
    'city': 100, 'town': 85, 'village': 65, 'hamlet': 50, 'suburb': 60, 'borough': 60,
    'quarter': 45, 'neighbourhood': 40, 'isolated_dwelling': 30, 'locality': 25, 'square': 35,
}
# Чем может быть «город» у адреса: радиус по умолчанию, км.
SETTLEMENT_RADIUS_KM = {'city': 12.0, 'town': 4.0, 'village': 2.0, 'hamlet': 1.0, 'isolated_dwelling': 0.5}

# ---- Улицы -------------------------------------------------------------------------------------

STREET_HIGHWAYS = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
    'living_street', 'pedestrian', 'road', 'service', 'track', 'footway', 'path', 'cycleway',
}
STREET_RANK = 40

# ---- Места -------------------------------------------------------------------------------------

POI_KEYS = ('amenity', 'shop', 'healthcare', 'tourism', 'leisure', 'office', 'historic', 'craft', 'emergency')
# Скучное и бесконечное — не ищем, даже с названием.
POI_SKIP = {
    'bench', 'waste_basket', 'waste_disposal', 'recycling', 'parking_space', 'parking_entrance', 'vending_machine',
    'bicycle_parking', 'motorcycle_parking', 'post_box', 'clock', 'hunting_stand', 'grit_bin', 'bbq', 'yes',
    'no', 'smoking_area', 'loading_dock', 'ticket_validator', 'photo_booth', 'payment_terminal', 'fixme',
    'traffic_signals', 'street_lamp', 'tree', 'picnic_table', 'water_tap', 'boundary_stone',
}
# Важное ищем и без названия: «аптека» найдёт и безымянную.
POI_UNNAMED = {
    'pharmacy', 'hospital', 'clinic', 'doctors', 'dentist', 'police', 'fire_station', 'fuel', 'atm', 'bank',
    'toilets', 'drinking_water', 'shelter', 'post_office', 'charging_station', 'veterinary', 'water_point',
    'ambulance_station', 'defibrillator', 'marketplace',
}
POI_RANK = {
    'hospital': 70, 'station': 70, 'metro': 70, 'aerodrome': 75, 'bus_station': 60, 'university': 55,
    'police': 50, 'fire_station': 50, 'pharmacy': 45, 'clinic': 45, 'mall': 45, 'marketplace': 45,
    'museum': 45, 'theatre': 45, 'place_of_worship': 40, 'school': 40, 'kindergarten': 35,
}
POI_RANK_DEFAULT = 30
POI_RANK_UNNAMED = 15

# Слова для поиска по виду места: «аптека», «заправка», «метро»… (рус. + англ.)
KIND_WORDS = {
    'pharmacy': 'аптека pharmacy', 'chemist': 'аптека химия chemist',
    'hospital': 'больница стационар госпиталь hospital', 'clinic': 'поликлиника клиника медцентр clinic',
    'doctors': 'врач клиника doctor', 'dentist': 'стоматология зубной dentist',
    'veterinary': 'ветеринар ветклиника vet', 'ambulance_station': 'скорая помощь ambulance',
    'defibrillator': 'дефибриллятор defibrillator',
    'police': 'полиция отделение police', 'fire_station': 'пожарная часть мчс fire',
    'shelter': 'укрытие навес shelter', 'fuel': 'заправка азс бензин fuel gas',
    'charging_station': 'зарядка электромобиль charging', 'parking': 'парковка стоянка parking',
    'bank': 'банк bank', 'atm': 'банкомат atm', 'bureau_de_change': 'обмен валюты exchange',
    'post_office': 'почта post', 'place_of_worship': 'храм церковь мечеть синагога church',
    'monastery': 'монастырь monastery', 'school': 'школа school', 'kindergarten': 'детский сад детсад kindergarten',
    'university': 'университет вуз university', 'college': 'колледж техникум college', 'library': 'библиотека library',
    'supermarket': 'супермаркет магазин продукты supermarket', 'convenience': 'магазин продукты grocery',
    'marketplace': 'рынок market', 'mall': 'торговый центр тц mall', 'bakery': 'пекарня хлеб bakery',
    'hardware': 'хозяйственный магазин hardware', 'cafe': 'кафе cafe', 'restaurant': 'ресторан restaurant',
    'fast_food': 'фастфуд еда fast food', 'canteen': 'столовая canteen', 'bar': 'бар bar',
    'hotel': 'гостиница отель hotel', 'hostel': 'хостел hostel', 'guest_house': 'гостевой дом guest house',
    'station': 'станция вокзал station', 'metro': 'метро станция metro subway',
    'bus_station': 'автовокзал автостанция bus station', 'bus_stop': 'остановка bus stop',
    'tram_stop': 'трамвай остановка tram', 'aerodrome': 'аэропорт airport',
    'toilets': 'туалет toilets', 'drinking_water': 'питьевая вода родник water', 'water_point': 'вода water',
    'museum': 'музей museum', 'theatre': 'театр theatre', 'cinema': 'кино кинотеатр cinema',
    'townhall': 'администрация townhall', 'courthouse': 'суд court', 'park': 'парк park',
    'stadium': 'стадион stadium', 'sports_centre': 'спорткомплекс sports', 'swimming_pool': 'бассейн pool',
    'car_repair': 'автосервис ремонт car repair', 'car_wash': 'автомойка car wash',
    'city': 'город city', 'town': 'город town', 'village': 'село деревня village', 'hamlet': 'деревня hamlet',
    'suburb': 'район suburb', 'quarter': 'квартал', 'neighbourhood': 'микрорайон',
}

HOUSE_RE = re.compile(r'\s+')


def norm(s: str) -> str:
    return HOUSE_RE.sub(' ', s.lower().replace('ё', 'е')).strip()


def street_key(name: str) -> str:
    """Ключ улицы без порядка слов: «улица Ленина» = «Ленина улица», «ул. Ленина» ~ «улица Ленина»."""
    words = re.findall(r'[\w-]+', norm(name))
    words = ['улица' if w in ('ул', 'у') else 'проспект' if w == 'пр' else w for w in words]
    return ' '.join(sorted(words))


def rep_point(geom: dict) -> tuple[float, float] | None:
    """(lat, lon) — точка, представляющая объект."""
    t = geom.get('type')
    c = geom.get('coordinates')
    if not c:
        return None
    if t == 'Point':
        return c[1], c[0]
    if t == 'LineString':
        p = c[len(c) // 2]
        return p[1], p[0]
    if t == 'MultiLineString':
        line = max(c, key=len)
        p = line[len(line) // 2]
        return p[1], p[0]
    if t == 'Polygon':
        ring = c[0]
    elif t == 'MultiPolygon':
        ring = max((poly[0] for poly in c), key=len)
    else:
        return None
    n = len(ring) - 1 if len(ring) > 1 and ring[0] == ring[-1] else len(ring)
    if n <= 0:
        return None
    return sum(p[1] for p in ring[:n]) / n, sum(p[0] for p in ring[:n]) / n


def km(lat1, lon1, lat2, lon2) -> float:
    dlat = (lat2 - lat1) * 111.2
    dlon = (lon2 - lon1) * 111.2 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dlat, dlon)


class SettlementFinder:
    """Ближайший «город» для точки: город с большим радиусом побеждает дальний хутор, но не соседнюю деревню."""

    CELL = 0.1  # градус

    def __init__(self):
        self.grid: dict[tuple[int, int], list] = defaultdict(list)
        self.max_radius = 1.0

    def add(self, name: str, kind: str, lat: float, lon: float, population: str | None):
        radius = SETTLEMENT_RADIUS_KM[kind]
        try:
            pop = int(re.sub(r'[^\d]', '', population or '') or 0)
        except ValueError:
            pop = 0
        if pop and kind in ('city', 'town'):
            radius = max(radius, min(35.0, 0.012 * math.sqrt(pop)))
        self.max_radius = max(self.max_radius, radius)
        self.grid[(int(math.floor(lat / self.CELL)), int(math.floor(lon / self.CELL)))].append((name, lat, lon, radius))

    def find(self, lat: float, lon: float) -> str | None:
        reach_lat = int(math.ceil(self.max_radius / (111.2 * self.CELL)))
        coslat = max(0.2, math.cos(math.radians(lat)))
        reach_lon = int(math.ceil(self.max_radius / (111.2 * self.CELL * coslat)))
        ci, cj = int(math.floor(lat / self.CELL)), int(math.floor(lon / self.CELL))
        best, best_score = None, 1.0
        for i in range(ci - reach_lat, ci + reach_lat + 1):
            for j in range(cj - reach_lon, cj + reach_lon + 1):
                for name, plat, plon, radius in self.grid.get((i, j), ()):
                    score = km(lat, lon, plat, plon) / radius
                    if score < best_score:
                        best, best_score = name, score
        return best


class KeyedGrid:
    """Записи по ключу (название улицы/посёлка) и клетке 0.1° — ближайшая без перебора всего региона."""

    CELL = 0.1

    def __init__(self):
        self.cells: dict[tuple, list] = defaultdict(list)

    def _cell(self, lat, lon):
        return int(math.floor(lat / self.CELL)), int(math.floor(lon / self.CELL))

    def add(self, key: str, item_id: int, lat: float, lon: float):
        i, j = self._cell(lat, lon)
        self.cells[(key, i, j)].append((item_id, lat, lon))

    def nearest(self, key: str, lat: float, lon: float, max_km: float) -> int | None:
        ci, cj = self._cell(lat, lon)
        best, best_d = None, max_km
        for i in (ci - 1, ci, ci + 1):
            for j in range(cj - 2, cj + 3):
                for item_id, plat, plon in self.cells.get((key, i, j), ()):
                    d = km(lat, lon, plat, plon)
                    if d < best_d:
                        best, best_d = item_id, d
        return best


def poi_kind(p: dict) -> str | None:
    if p.get('railway') in ('station', 'halt'):
        return 'metro' if p.get('station') == 'subway' else 'station'
    if p.get('public_transport') == 'station':
        return 'metro' if p.get('station') == 'subway' or p.get('subway') == 'yes' else 'station'
    if p.get('amenity') == 'bus_station':
        return 'bus_station'
    if p.get('highway') == 'bus_stop':
        return 'bus_stop'
    if p.get('railway') == 'tram_stop':
        return 'tram_stop'
    if p.get('aeroway') == 'aerodrome':
        return 'aerodrome'
    for k in POI_KEYS:
        v = p.get(k)
        if v and v not in POI_SKIP:
            return v.split(';')[0].strip()
    if p.get('building') and p.get('name'):
        return 'building'
    return None


def build(lines, out_path: str, region: str, version: str, log=sys.stderr) -> dict:
    t0 = time.time()
    places = []  # (name, name_en, kind, lat, lon)
    finder = SettlementFinder()
    streets_raw = []  # (name, name_en, lat, lon)
    addrs = []  # (street_or_place, is_place, house, lat, lon, addr_city)
    pois = []  # (name, name_en, kind, lat, lon, street, house, addr_city)
    bad = 0
    for line in lines:
        line = line.strip().lstrip('\x1e')
        if not line:
            continue
        try:
            f = json.loads(line)
        except json.JSONDecodeError:
            bad += 1
            continue
        p = f.get('properties') or {}
        pt = rep_point(f.get('geometry') or {})
        if not pt:
            continue
        lat, lon = pt
        name = (p.get('name:ru') or p.get('name') or '').strip()
        name_en = (p.get('name:en') or '').strip() or None
        place = p.get('place')
        if place in PLACE_RANK and name:
            places.append((name, name_en, place, lat, lon))
            if place in SETTLEMENT_RADIUS_KM:
                finder.add(name, place, lat, lon, p.get('population'))
            continue
        house = (p.get('addr:housenumber') or '').strip()
        street = (p.get('addr:street') or '').strip()
        addr_place = (p.get('addr:place') or '').strip()
        addr_city = (p.get('addr:city') or '').strip() or None
        kind = poi_kind(p)
        if p.get('highway') in STREET_HIGHWAYS and name and kind is None:
            streets_raw.append((name, name_en, lat, lon))
            continue
        if kind and (name or kind in POI_UNNAMED):
            pois.append((name, name_en, kind, lat, lon, street or addr_place or None, house or None, addr_city))
        if house and (street or addr_place):
            addrs.append((street or addr_place, not street, house, lat, lon, addr_city))
    print(f'{region}: прочитано за {time.time() - t0:.0f} с — мест {len(places)}, улиц (кусков) {len(streets_raw)}, '
          f'адресов {len(addrs)}, объектов {len(pois)}, битых строк {bad}', file=log)

    db = sqlite3.connect(out_path)
    db.executescript(
        """
        PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA page_size=4096;
        DROP TABLE IF EXISTS meta; DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS houses; DROP TABLE IF EXISTS items_fts;
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE items(
          id INTEGER PRIMARY KEY, cls TEXT NOT NULL, kind TEXT, name TEXT NOT NULL, name_en TEXT,
          city TEXT, street TEXT, house TEXT, lat REAL NOT NULL, lon REAL NOT NULL, rank INTEGER NOT NULL);
        CREATE VIRTUAL TABLE items_fts USING fts5(
          name, name_en, words, city, content='', tokenize='unicode61 remove_diacritics 2', prefix='2 3');
        CREATE TABLE houses(street_id INTEGER NOT NULL, house TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL);
        """
    )
    next_id = [1]

    def add_item(cls, kind, name, name_en, city, street, house, lat, lon, rank):
        i = next_id[0]
        next_id[0] += 1
        db.execute('INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                   (i, cls, kind, name, name_en, city, street, house, round(lat, 6), round(lon, 6), rank))
        db.execute('INSERT INTO items_fts(rowid, name, name_en, words, city) VALUES (?,?,?,?,?)',
                   (i, name, name_en or '', KIND_WORDS.get(kind or '', ''), city or ''))
        return i

    # Населённые пункты; районы города — с городом рядом.
    place_ids = KeyedGrid()  # norm(name)
    for name, name_en, kind, lat, lon in places:
        city = None if kind in SETTLEMENT_RADIUS_KM else finder.find(lat, lon)
        i = add_item('place', kind, name, name_en, city, None, None, lat, lon, PLACE_RANK[kind])
        place_ids.add(norm(name), i, lat, lon)

    # Улицы: куски одной улицы в одном городе — одна запись.
    groups: dict[tuple, list] = defaultdict(list)
    for name, name_en, lat, lon in streets_raw:
        groups[(street_key(name), finder.find(lat, lon))].append((name, name_en, lat, lon))
    street_ids = KeyedGrid()  # street_key
    for (key, city), parts in groups.items():
        name = max((p[0] for p in parts), key=lambda n: sum(1 for q in parts if q[0] == n))
        name_en = next((p[1] for p in parts if p[1]), None)
        lat = sum(p[2] for p in parts) / len(parts)
        lon = sum(p[3] for p in parts) / len(parts)
        # Точка — кусок улицы, ближайший к середине (у изогнутой улицы середина бывает в стороне).
        near = min(parts, key=lambda p: km(lat, lon, p[2], p[3]))
        i = add_item('street', 'street', name, name_en, city, None, None, near[2], near[3], STREET_RANK)
        street_ids.add(key, i, near[2], near[3])

    # Адреса → дома улиц.
    created_streets = 0
    houses = 0
    for street, is_place, house, lat, lon, addr_city in addrs:
        if is_place:
            grid, key, reach = place_ids, norm(street), 8
        else:
            grid, key, reach = street_ids, street_key(street), 6
        sid = grid.nearest(key, lat, lon, reach)
        if sid is None:
            # Улицы нет среди дорог с названием (или она далеко) — запись по самим адресам.
            city = addr_city or finder.find(lat, lon)
            sid = add_item('street', 'street', street, None, city, None, None, lat, lon, STREET_RANK - 5)
            grid.add(key, sid, lat, lon)
            created_streets += 1
        db.execute('INSERT INTO houses VALUES (?,?,?,?)', (sid, house, round(lat, 6), round(lon, 6)))
        houses += 1

    # Места.
    for name, name_en, kind, lat, lon, street, house, addr_city in pois:
        city = addr_city or finder.find(lat, lon)
        rank = POI_RANK.get(kind, POI_RANK_DEFAULT) if name else POI_RANK_UNNAMED
        add_item('poi', kind, name or '', name_en, city, street, house, lat, lon, rank)

    db.executescript(
        """
        CREATE INDEX houses_street ON houses(street_id, house COLLATE NOCASE);
        CREATE INDEX houses_geo ON houses(lat, lon);
        CREATE INDEX items_geo ON items(lat, lon) WHERE cls = 'poi';
        INSERT INTO items_fts(items_fts) VALUES('optimize');
        """
    )
    meta = {
        'schema': str(SCHEMA_VERSION), 'region': region, 'version': version,
        'built': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'items': str(next_id[0] - 1), 'houses': str(houses),
        'license': 'Data © OpenStreetMap contributors, ODbL',
    }
    db.executemany('INSERT INTO meta VALUES (?,?)', meta.items())
    db.commit()
    db.execute('VACUUM')
    db.close()
    print(f'{region}: записей {meta["items"]}, домов {houses}, улиц по адресам {created_streets}, '
          f'всего {time.time() - t0:.0f} с', file=log)
    return meta


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True)
    ap.add_argument('--region', required=True)
    ap.add_argument('--version', required=True)
    a = ap.parse_args()
    sys.stdin.reconfigure(encoding='utf-8')
    build(sys.stdin, a.out, a.region, a.version)


if __name__ == '__main__':
    main()
