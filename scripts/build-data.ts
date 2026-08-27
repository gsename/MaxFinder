import { mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeStationName } from '../shared/places'
import { normalizeArrival, parseHm } from '../shared/time'
import type { DataIndex, Station, TripsFile, TripTuple } from '../shared/types'
import { fetchCountsByDate, fetchDatasetMeta, streamAvailableRows, type RawRow } from './ods'

export interface BuildResult {
  index: DataIndex
  /** Trajets disponibles par date, pour l'evaluation des alertes sans relire le disque. */
  days: Map<string, TripTuple[]>
  stations: Station[]
  rowsRead: number
  rowsSkipped: number
  bytesWritten: number
  warnings: string[]
}

interface StationAccumulator {
  name: string
  iata: string
}

/**
 * Telecharge le dataset et ecrit les fichiers statiques consommes par le front.
 *
 * Sortie :
 *   <outDir>/index.json     metadonnees + compteurs par date
 *   <outDir>/stations.json  referentiel des gares, indexe par StationId
 *   <outDir>/trips.json     trajets disponibles des 31 jours, groupes par date
 *
 * Les 31 jours tiennent dans un seul fichier de ~410 Ko gzippes. Un fichier
 * unique vaut mieux que 31 : il rend toute recherche multi-dates instantanee et
 * alimente gratuitement le calendrier de disponibilite, pour un cout reseau
 * paye une seule fois par mise a jour du dataset.
 */
export async function buildData(outDir: string): Promise<BuildResult> {
  const meta = await fetchDatasetMeta()
  const warnings: string[] = []

  // Collecte : un passage unique sur le flux JSONL.
  const stationsByIata = new Map<string, StationAccumulator>()
  const rawByDate = new Map<string, RawRow[]>()
  let rowsRead = 0
  let rowsSkipped = 0

  for await (const row of streamAvailableRows()) {
    rowsRead++
    if (!row.date || !row.origine_iata || !row.destination_iata) {
      rowsSkipped++
      continue
    }
    const date = row.date.slice(0, 10)

    stationsByIata.set(row.origine_iata, { name: row.origine, iata: row.origine_iata })
    stationsByIata.set(row.destination_iata, { name: row.destination, iata: row.destination_iata })

    let bucket = rawByDate.get(date)
    if (!bucket) {
      bucket = []
      rawByDate.set(date, bucket)
    }
    bucket.push(row)
  }

  if (rowsRead === 0) {
    throw new Error('Export JSONL vide : synchronisation interrompue pour ne pas ecraser les donnees')
  }

  // Ids attribues par ordre alphabetique de libelle : stable d'un build a
  // l'autre tant que le referentiel de gares ne bouge pas. Le front invalide
  // son cache sur `dataset_modified`, ce qui couvre les cas ou il bouge.
  const stations: Station[] = [...stationsByIata.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map((entry) => ({
      name: entry.name,
      iata: entry.iata,
      norm: normalizeStationName(entry.name),
    }))

  const idByIata = new Map<string, number>()
  stations.forEach((station, id) => idByIata.set(station.iata, id))

  const days = new Map<string, TripTuple[]>()
  const availableCounts: Record<string, number> = {}

  for (const [date, rows] of rawByDate) {
    const trips: TripTuple[] = []
    for (const row of rows) {
      const origin = idByIata.get(row.origine_iata)
      const dest = idByIata.get(row.destination_iata)
      if (origin === undefined || dest === undefined || origin === dest) {
        rowsSkipped++
        continue
      }
      let dep: number
      let arr: number
      try {
        dep = parseHm(row.heure_depart)
        arr = normalizeArrival(dep, parseHm(row.heure_arrivee))
      } catch {
        rowsSkipped++
        continue
      }
      trips.push([row.train_no, origin, dest, dep, arr])
    }
    trips.sort((a, b) => a[3] - b[3] || a[1] - b[1] || a[2] - b[2])
    days.set(date, trips)
    availableCounts[date] = trips.length
  }

  // Deux requetes d'agregation pour verifier le build et alimenter l'affichage
  // "X trains dispos sur Y" cote front.
  const [referenceAvailable, totalCounts] = await Promise.all([
    fetchCountsByDate('od_happy_card="OUI"'),
    fetchCountsByDate(),
  ])

  for (const [date, expected] of Object.entries(referenceAvailable)) {
    const got = availableCounts[date] ?? 0
    if (got !== expected) {
      warnings.push(
        `Ecart sur ${date} : ${got} trajets construits contre ${expected} annonces par l API`,
      )
    }
  }
  for (const date of Object.keys(availableCounts)) {
    if (!(date in referenceAvailable)) {
      warnings.push(`Date ${date} presente dans l export mais absente de l agregation de controle`)
    }
  }

  const dates = [...days.keys()].sort()
  const index: DataIndex = {
    generated_at: new Date().toISOString(),
    dataset_modified: meta.modified,
    dates,
    station_count: stations.length,
    available_counts: availableCounts,
    total_counts: totalCounts,
  }

  // Ecriture dans un repertoire propre : une date sortie de la fenetre
  // glissante doit disparaitre, pas survivre en fichier orphelin.
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const tripsFile: TripsFile = { days: Object.fromEntries(dates.map((d) => [d, days.get(d)!])) }
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index), 'utf8')
  await writeFile(join(outDir, 'stations.json'), JSON.stringify(stations), 'utf8')
  await writeFile(join(outDir, 'trips.json'), JSON.stringify(tripsFile), 'utf8')

  const bytesWritten = await directorySize(outDir)

  return { index, days, stations, rowsRead, rowsSkipped, bytesWritten, warnings }
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(path)
    else total += (await stat(path)).size
  }
  return total
}
