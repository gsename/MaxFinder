/**
 * Previsualisation des alertes sur les donnees deja synchronisees.
 *
 * Repond a la question "qu est-ce que cette regle m enverrait ?" sans rien
 * telecharger, sans rien notifier et sans toucher au fichier d etat. A lancer
 * avant de pousser une modification de watches.yml.
 *
 *   npm run watches:preview
 *   npx tsx scripts/watch-preview.ts --file /chemin/vers/un/autre.yml --limit 5
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { formatDateLabel, todayInParis, weekdayLabel, WEEKDAY_KEYS } from '../shared/dates'
import { buildPlaceIndex, stationLabel } from '../shared/places'
import { decodeDayTrips } from '../shared/search'
import { formatArrival, formatDuration, formatHm } from '../shared/time'
import type { DataIndex, Station, Trip, TripsFile } from '../shared/types'
import { datesForWatch, matchWatch } from '../shared/watch'
import { loadWatches, WatchesError } from './watches'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'public', 'data')

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<number> {
  const watchesPath = flag('file') ?? join(ROOT, 'watches.yml')
  const limit = Number(flag('limit') ?? 8)

  let watches
  try {
    watches = await loadWatches(watchesPath)
  } catch (error) {
    if (error instanceof WatchesError) {
      console.error(`\n${watchesPath} est invalide :\n${error.message}\n`)
      return 1
    }
    throw error
  }

  if (watches.length === 0) {
    console.log(`Aucune regle dans ${watchesPath}.`)
    return 0
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
  const days = new Map<string, Trip[]>()
  for (const [date, tuples] of Object.entries(tripsFile.days)) {
    days.set(date, decodeDayTrips(tuples))
  }
  const today = todayInParis()

  console.log(`\nInstantane du ${index.dataset_modified} · ${index.dates.length} dates publiees`)
  console.log(`${watches.length} regle(s) dans ${watchesPath}\n`)

  let problems = 0

  for (const rule of watches) {
    const status = rule.enabled ? '' : '  [DESACTIVEE, aucune alerte ne partira]'
    console.log(`${'='.repeat(72)}\n${rule.name}${status}`)

    const result = matchWatch(rule, days, placeIndex, today)

    for (const item of result.unresolved) {
      problems++
      const hint = item.candidates.length
        ? `Gares proches : ${item.candidates.join(', ')}.`
        : 'Aucune gare approchante dans le dataset.'
      console.log(`  PROBLEME gare "${item.input}" introuvable. ${hint}`)
    }

    const dates = datesForWatch(rule, index.dates, today)
    const jours = rule.weekdays?.length
      ? rule.weekdays.map((k) => weekdayLabel(k)).join(', ')
      : 'tous les jours'
    console.log(`  fenetre    : ${dates.length} date(s) surveillee(s) (${jours})`)
    if (dates.length > 0) console.log(`               ${dates.join(', ')}`)
    console.log(
      `  criteres   : jusqu a ${rule.maxChanges} changement(s)` +
        (rule.departBetween
          ? `, depart entre ${formatHm(rule.departBetween[0])} et ${formatHm(rule.departBetween[1])}`
          : ', toute heure de depart') +
        `, priorite ntfy ${rule.priority}`,
    )

    if (dates.length === 0) {
      console.log('  ATTENTION  aucune date surveillee : cette regle ne declenchera jamais.')
      problems++
      continue
    }

    const total = result.itineraries.length
    const parChangements = new Map<number, number>()
    for (const it of result.itineraries) {
      parChangements.set(it.changes, (parChangements.get(it.changes) ?? 0) + 1)
    }
    const repartition = [...parChangements.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([c, n]) => `${n} a ${c} chgt`)
      .join(', ')

    console.log(`\n  ${total} trajet(s) correspondent aujourd hui${total ? ` (${repartition})` : ''}`)

    if (total === 0) {
      console.log('  Rien pour l instant : vous serez notifie des qu une place se liberera.')
      continue
    }

    // Le fichier d etat etant vide au depart, la premiere notification contient
    // TOUT ce qui correspond deja. Le dire evite la surprise.
    console.log(
      `  La premiere notification listera ces ${total} trajet(s) ; ensuite, seules les` +
        ' nouveautes seront signalees.',
    )
    if (total > 60) {
      console.log(
        `  ATTENTION  ${total} trajets, c est beaucoup pour une notification. Reduisez` +
          ' max_changes ou ajoutez depart_between pour cibler.',
      )
    }

    console.log('')
    for (const it of result.itineraries.slice(0, limit)) {
      const legs = it.legs
        .map((l) => `${l.trainNo} ${stationLabel(placeIndex, l.origin)}>${stationLabel(placeIndex, l.dest)}`)
        .join(' | ')
      const tag = it.changes === 0 ? 'direct' : `${it.changes} chgt`
      console.log(
        `    ${formatDateLabel(it.date).padEnd(14)} ${formatHm(it.dep)}-${formatArrival(it.arr).padEnd(9)}` +
          ` ${formatDuration(it.duration).padStart(8)}  ${tag.padEnd(7)} ${legs}`,
      )
    }
    if (total > limit) console.log(`    ... ${total - limit} autre(s), voir --limit`)
    console.log('')
  }

  console.log('='.repeat(72))
  if (problems > 0) {
    console.log(`${problems} probleme(s) a corriger avant de pousser.`)
    return 1
  }
  const actives = watches.filter((w) => w.enabled).length
  console.log(
    `${actives} regle(s) active(s) sur ${watches.length}. ` +
      (actives === 0 ? 'Passez enabled: true pour recevoir des alertes.' : 'Pret a pousser.'),
  )
  console.log(`Jours de semaine acceptes : ${WEEKDAY_KEYS.join(', ')}\n`)
  return 0
}

main().then((code) => process.exit(code))
