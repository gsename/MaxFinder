import { decodeDayTrips } from '../../shared/search'
import { buildPlaceIndex, type PlaceIndex } from '../../shared/places'
import type { DataIndex, Station, Trip, TripsFile } from '../../shared/types'

const DATA_BASE = `${import.meta.env.BASE_URL}data/`
const CACHE_NAME = 'tgvmax-data-v1'

/**
 * Recupere un fichier de donnees en le versionnant par `dataset_modified`.
 *
 * L URL portant la version, une entree de cache reste valable jusqu a la
 * prochaine publication SNCF. Le Cache API peut lever (navigation privee,
 * stockage bloque) : on retombe alors sur un simple fetch.
 */
async function fetchVersionedJson<T>(file: string, version: string | null): Promise<T> {
  const url = version ? `${DATA_BASE}${file}?v=${encodeURIComponent(version)}` : `${DATA_BASE}${file}`

  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(url)
    if (hit) return (await hit.json()) as T

    const res = await fetch(url)
    if (!res.ok) throw new Error(`${file} : HTTP ${res.status}`)
    await cache.put(url, res.clone())
    await dropStaleEntries(cache, file, url)
    return (await res.json()) as T
  } catch {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Impossible de charger ${file} (HTTP ${res.status})`)
    return (await res.json()) as T
  }
}

/** Supprime les versions precedentes du meme fichier pour ne pas accumuler. */
async function dropStaleEntries(cache: Cache, file: string, keep: string): Promise<void> {
  const prefix = `${DATA_BASE}${file}`
  for (const request of await cache.keys()) {
    if (request.url !== keep && request.url.startsWith(prefix)) await cache.delete(request)
  }
}

export interface CoreData {
  index: DataIndex
  stations: Station[]
  placeIndex: PlaceIndex
}

/** Charge le referentiel minimal necessaire a l affichage du formulaire (~5 Ko gzip). */
export async function loadCore(): Promise<CoreData> {
  // index.json n est pas versionne, c est lui qui porte la version.
  const index = await fetchVersionedJson<DataIndex>('index.json', null)
  const stations = await fetchVersionedJson<Station[]>('stations.json', index.dataset_modified)
  return { index, stations, placeIndex: buildPlaceIndex(stations) }
}

let tripsPromise: Promise<Map<string, Trip[]>> | null = null
let tripsVersion: string | null = null

/**
 * Charge les trajets des 31 jours (~410 Ko gzip), une seule fois par session.
 *
 * Tout tenir en memoire d un coup permet de calculer les correspondances et le
 * calendrier de disponibilite sans aucune requete supplementaire.
 */
export function loadTrips(datasetModified: string): Promise<Map<string, Trip[]>> {
  if (tripsPromise && tripsVersion === datasetModified) return tripsPromise
  tripsVersion = datasetModified
  tripsPromise = fetchVersionedJson<TripsFile>('trips.json', datasetModified).then((file) => {
    const days = new Map<string, Trip[]>()
    for (const [date, tuples] of Object.entries(file.days)) {
      days.set(date, decodeDayTrips(tuples))
    }
    return days
  })
  tripsPromise.catch(() => {
    // Un echec ne doit pas geler definitivement les recherches suivantes.
    tripsPromise = null
    tripsVersion = null
  })
  return tripsPromise
}
