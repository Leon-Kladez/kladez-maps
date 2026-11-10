#!/usr/bin/env node
// Пробные маршруты по собранному файлу дорог: на машине, пешком, на велосипеде.
// Ждёт Valhalla на localhost:8002. Падает, если маршрут не построился.
//   node route-check.mjs <регион>

/** Точки по регионам: [откуда, куда, подпись]. Короткий — для пешком/велосипеда, длинный — для машины. */
const POINTS = {
  'ru-central': { short: [[55.7558, 37.6173], [55.7445, 37.6265], 'Красная площадь → Пятницкая'], long: [[55.7558, 37.6173], [54.1931, 37.6175], 'Москва → Тула'] },
  'ru-northwest': { short: [[59.9343, 30.3351], [59.9311, 30.3609], 'Дворцовая → Невский'], long: [[59.9343, 30.3351], [58.5213, 31.2755], 'Петербург → Великий Новгород'] },
  'ru-south': { short: [[47.2357, 39.7015], [47.2225, 39.7203], 'Ростов: центр'], long: [[47.2357, 39.7015], [45.0355, 38.9753], 'Ростов → Краснодар'] },
  'ru-north-caucasus': { short: [[44.0486, 43.0594], [44.0398, 43.0706], 'Пятигорск: центр'], long: [[44.0486, 43.0594], [43.9055, 42.7168], 'Пятигорск → Кисловодск'] },
  'ru-volga': { short: [[55.7963, 49.1088], [55.7887, 49.1221], 'Казань: центр'], long: [[55.7963, 49.1088], [56.3269, 44.0059], 'Казань → Нижний Новгород'] },
  'ru-urals': { short: [[56.8389, 60.6057], [56.8331, 60.5968], 'Екатеринбург: центр'], long: [[56.8389, 60.6057], [55.1644, 61.4368], 'Екатеринбург → Челябинск'] },
  'ru-siberia': { short: [[55.0302, 82.9204], [55.0415, 82.9346], 'Новосибирск: центр'], long: [[55.0302, 82.9204], [54.9885, 73.3242], 'Новосибирск → Омск'] },
  'ru-far-east-south': { short: [[43.1155, 131.8855], [43.1210, 131.8930], 'Владивосток: центр'], long: [[43.1155, 131.8855], [48.4802, 135.0719], 'Владивосток → Хабаровск'] },
  'ru-far-east-north': { short: [[62.0281, 129.7326], [62.0350, 129.7400], 'Якутск: центр'], long: [[62.0281, 129.7326], [61.9, 129.6], 'Якутск: окрестности'] },
}

async function route(from, to, costing) {
  const t0 = Date.now()
  const res = await fetch('http://localhost:8002/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [{ lat: from[0], lon: from[1] }, { lat: to[0], lon: to[1] }],
      costing,
      language: 'ru-RU',
      units: 'kilometers',
    }),
  })
  const body = await res.json()
  const ms = Date.now() - t0
  if (!res.ok || !body.trip) throw new Error(`${costing}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  const s = body.trip.summary
  const steps = body.trip.legs[0].maneuvers.slice(0, 3).map((m) => m.instruction)
  return { ms, km: s.length.toFixed(1), min: Math.round(s.time / 60), steps, maneuvers: body.trip.legs[0].maneuvers.length }
}

const region = process.argv[2]
const p = POINTS[region]
if (!p) {
  console.log(`для ${region} нет пробных точек — пропускаю`)
  process.exit(0)
}
for (const [costing, pts] of [['auto', p.long], ['pedestrian', p.short], ['bicycle', p.short]]) {
  const r = await route(pts[0], pts[1], costing)
  console.log(`${pts[2]} (${costing}): ${r.km} км, ${r.min} мин, ${r.maneuvers} указаний, ответ ${r.ms} мс`)
  for (const s of r.steps) console.log(`   · ${s}`)
}
