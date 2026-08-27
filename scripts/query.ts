/**
 * Interrogation en ligne de commande des donnees deja synchronisees.
 *
 * Sert a verifier le moteur de recherche contre les vraies donnees, sans
 * navigateur, et a comparer un resultat avec SNCF Connect.
 *
 *   npx tsx scripts/query.ts PARIS BORDEAUX
 *   npx tsx scripts/query.ts PARIS NICE --changes 2 --date 2026-09-12
 *   npx tsx scripts/query.ts LYON MARSEILLE --after 17:00 --before 21:00
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { formatDateLabel } from '../shared/dates'
import { buildDayGraph, decodeDayTrips, findItineraries, DEFAULT_SEARCH_OPTIONS } from '../shared/search'
import { buildPlaceIndex, lookupPlace, stationLabel } from '../shared/places'
import { formatArrival, formatDuration, formatHm, parseHm } from '../shared/time'
import type { DataIndex, Itinerary, Station, TripsFile } from '../shared/types'

const DATA_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'data')

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<number> {
  const positional = process.argv.slice(2).filter((arg, i, all) => {
    if (arg.startsWith('--')) return false
    const previous = all[i - 1]
    return !(previous?.startsWith('--') ?? false)
  })
  const [fromInput, toInput] = positional

  if (!fromInput || !toInput) {
    console.error('Usage : npx tsx scripts/query.ts <depart> <arrivee> [--date YYYY-MM-DD]')
    console.error('        [--changes 0|1|2] [--after HH:MM] [--before HH:MM] [--limit N]')
    return 2
  }

  let index: DataIndex
  let stations: Station[]
  let tripsFile: TripsFile
  try {
    index = JSON.parse(await readFile(join(DATA_DIR, 'index.json'), 'utf8')) as DataIndex
    stations = JSON.parse(await readFile(join(DATA_DIR, 'stations.json'), 'utf8')) as Station[]
    tripsFile = JSON.parse(await readFile(join(DATA_DIR, 'trips.json'), 'utf8')) as TripsFile
  } catch {
    console.error(`Donnees absentes de ${DATA_DIR}. Lancez d abord : npm run sync:local`)
    return 1
  }

  const placeIndex = buildPlaceIndex(stations)
  const resolveOne = (input: string, label: string): number | null => {
    const found = lookupPlace(placeIndex, input)
    if (found.place !== undefined) return found.place
    console.error(`Ville de ${label} introuvable : "${input}"`)
    const candidates = (found.candidates ?? []).slice(0, 10).map((id) => placeIndex.places[id]!.name)
    if (candidates.length) console.error(`  Vouliez-vous dire : ${candidates.join(', ')} ?`)
    return null
  }

  const from = resolveOne(fromInput, 'depart')
  const to = resolveOne(toInput, 'arrivee')
  if (from === null || to === null) return 1

  const changes = Number(flag('changes') ?? 0)
  if (![0, 1, 2].includes(changes)) {
    console.error('--changes accepte 0, 1 ou 2')
    return 2
  }
  const date = flag('date')
  if (date && !index.dates.includes(date)) {
    console.error(`La date ${date} n est pas publiee. Fenetre : ${index.dates[0]} a ${index.dates.at(-1)}`)
    return 1
  }
  const limit = Number(flag('limit') ?? 30)

  const opts = {
    from: placeIndex.places[from]!.stations,
    to: placeIndex.places[to]!.stations,
    departFrom: flag('after') ? parseHm(flag('after')!) : undefined,
    departTo: flag('before') ? parseHm(flag('before')!) : undefined,
    maxChanges: changes as 0 | 1 | 2,
    minConnection: DEFAULT_SEARCH_OPTIONS.minConnection,
    cityTransferConnection: DEFAULT_SEARCH_OPTIONS.cityTransferConnection,
    maxConnectionWait: DEFAULT_SEARCH_OPTIONS.maxConnectionWait,
    escalateOnlyIfEmpty: true,
    maxResultsPerLevel: 200,
  }

  const dates = date ? [date] : index.dates
  const found: Itinerary[] = []
  const started = performance.now()
  for (const day of dates) {
    const tuples = tripsFile.days[day]
    if (!tuples) continue
    found.push(...findItineraries(buildDayGraph(day, decodeDayTrips(tuples)), opts, placeIndex))
  }
  const elapsed = performance.now() - started

  // `from` et `to` sont des index de ville, pas de gare : les deux referentiels
  // n'ont pas le meme ordre, il faut lire dans `places`.
  const fromPlace = placeIndex.places[from]!
  const toPlace = placeIndex.places[to]!
  const describePlace = (place: (typeof placeIndex.places)[number]) =>
    place.multiStation ? `${place.name} (${place.stations.length} gares)` : place.name
  console.log(`\n${describePlace(fromPlace)}  vers  ${describePlace(toPlace)}`)
  console.log(
    `Instantane du ${index.dataset_modified} · ${dates.length} date(s) balayee(s) en ${elapsed.toFixed(0)} ms`,
  )
  console.log(`${found.length} trajet(s) trouve(s), jusqu a ${changes} changement(s)\n`)

  let currentDate = ''
  for (const itinerary of found.slice(0, limit)) {
    if (itinerary.date !== currentDate) {
      currentDate = itinerary.date
      const total = index.available_counts[currentDate] ?? 0
      console.log(`  ${formatDateLabel(currentDate)}  (${total} trajets TGVmax ce jour, tout reseau)`)
    }
    const legs = itinerary.legs
      .map((leg) => `${leg.trainNo} ${stationLabel(placeIndex, leg.origin)}>${stationLabel(placeIndex, leg.dest)}`)
      .join(' | ')
    const tag = itinerary.changes === 0 ? 'direct' : `${itinerary.changes} chgt`
    console.log(
      `    ${formatHm(itinerary.dep)} - ${formatArrival(itinerary.arr).padEnd(9)} ` +
        `${formatDuration(itinerary.duration).padStart(8)}  ${tag.padEnd(7)} ${legs}`,
    )
  }
  if (found.length > limit) console.log(`\n  ... ${found.length - limit} autre(s), voir --limit`)

  // Repartition par date : la vraie question est souvent "quel jour partir".
  const perDate = new Map<string, number>()
  for (const itinerary of found) perDate.set(itinerary.date, (perDate.get(itinerary.date) ?? 0) + 1)
  if (!date && perDate.size > 0) {
    console.log('\n  Disponibilite par date :')
    console.log(
      `    ${index.dates.map((d) => `${d.slice(8)}:${String(perDate.get(d) ?? 0).padStart(2)}`).join('  ')}`,
    )
  }
  console.log()
  return 0
}

main().then((code) => process.exit(code))
