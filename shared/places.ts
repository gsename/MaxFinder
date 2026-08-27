import type { Station, StationId } from './types'

/**
 * Le dataset SNCF designe les gares par un couple (libelle, code IATA), et ces
 * deux niveaux ne coincident pas : "PARIS (intramuros)" recouvre six gares
 * physiques (FRPMO, FRPLY, FRPNO, FRPST, FRPAZ, FRPBE), "LYON (intramuros)" deux,
 * "LILLE (intramuros)" deux. Au total 29 % des trajets partent ou arrivent dans
 * une de ces villes.
 *
 * D ou deux niveaux distincts :
 *   - `Station`, la gare physique, portee par son code IATA. C est le noeud du
 *     graphe : deux trains ne se correspondent au meme quai que sur un meme code.
 *   - `Place`, la ville selectionnable dans l interface, qui regroupe les gares
 *     partageant un libelle. Choisir "PARIS" doit chercher au depart des six.
 *
 * Confondre les deux rendait invisibles la plupart des trains parisiens.
 */
export interface Place {
  name: string
  norm: string
  /** Forme stable pour les URL partageables, ex. "paris-intramuros". */
  slug: string
  stations: StationId[]
  /** Vrai quand plusieurs gares physiques portent ce libelle. */
  multiStation: boolean
}

export interface PlaceIndex {
  stations: Station[]
  places: Place[]
  /** Ville de chaque gare, indexe par StationId. */
  placeOf: number[]
  /** Gares de la meme ville, la gare elle-meme incluse. */
  siblingsOf: StationId[][]
  byNorm: Map<string, number>
  bySlug: Map<string, number>
  byIata: Map<string, StationId>
}

/**
 * "AIX EN PROVENCE TGV" -> "aix en provence tgv"
 * "PARIS (intramuros)"  -> "paris intramuros"
 *
 * Les accents sont retires : le dataset ecrit "NIMES" la ou l utilisateur tape
 * "Nîmes".
 */
export function normalizeStationName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function slugify(norm: string): string {
  return norm.replace(/ /g, '-')
}

export function buildPlaceIndex(stations: Station[]): PlaceIndex {
  const byNorm = new Map<string, number>()
  const bySlug = new Map<string, number>()
  const byIata = new Map<string, StationId>()
  const places: Place[] = []
  const placeOf: number[] = new Array(stations.length).fill(-1)

  stations.forEach((station, id) => {
    byIata.set(station.iata, id)
    let placeId = byNorm.get(station.norm)
    if (placeId === undefined) {
      placeId = places.length
      const slug = slugify(station.norm)
      places.push({
        name: station.name,
        norm: station.norm,
        slug,
        stations: [],
        multiStation: false,
      })
      byNorm.set(station.norm, placeId)
      bySlug.set(slug, placeId)
    }
    places[placeId]!.stations.push(id)
    placeOf[id] = placeId
  })

  for (const place of places) place.multiStation = place.stations.length > 1

  const siblingsOf: StationId[][] = stations.map((_, id) => places[placeOf[id]!]!.stations)

  return { stations, places, placeOf, siblingsOf, byNorm, bySlug, byIata }
}

export interface PlaceLookup {
  place?: number
  /** Renseigne quand la saisie ne designe pas une ville unique. */
  candidates?: number[]
}

/**
 * Resout une saisie utilisateur vers une ville unique.
 *
 * Ordre d essai : slug, libelle normalise, code IATA d une gare, puis prefixe
 * puis sous-chaine uniques. Une saisie ambigue renvoie les candidats au lieu
 * d en choisir un au hasard, pour que le message d erreur soit utile.
 */
export function lookupPlace(index: PlaceIndex, query: string): PlaceLookup {
  const raw = query.trim()
  if (!raw) return { candidates: [] }

  const bySlug = index.bySlug.get(raw.toLowerCase())
  if (bySlug !== undefined) return { place: bySlug }

  const station = index.byIata.get(raw.toUpperCase())
  if (station !== undefined) return { place: index.placeOf[station]! }

  const norm = normalizeStationName(raw)
  const byNorm = index.byNorm.get(norm)
  if (byNorm !== undefined) return { place: byNorm }

  const bySlugNorm = index.bySlug.get(slugify(norm))
  if (bySlugNorm !== undefined) return { place: bySlugNorm }

  const prefixed: number[] = []
  index.places.forEach((place, id) => {
    if (place.norm.startsWith(norm)) prefixed.push(id)
  })
  if (prefixed.length === 1) return { place: prefixed[0]! }
  if (prefixed.length > 1) return { candidates: prefixed }

  const contained: number[] = []
  index.places.forEach((place, id) => {
    if (place.norm.includes(norm)) contained.push(id)
  })
  if (contained.length === 1) return { place: contained[0]! }
  return { candidates: contained }
}

/** Recherche pour l autocompletion, classee du plus au moins pertinent. */
export function searchPlaces(index: PlaceIndex, query: string, limit = 10): number[] {
  const norm = normalizeStationName(query)
  if (!norm) {
    // Sans saisie, les villes multi-gares sont les grands hubs : plus utile
    // qu un ordre alphabetique qui remonterait "AEROPORT ROISSY" en premier.
    return index.places
      .map((place, id) => ({ place, id }))
      .filter((entry) => entry.place.multiStation)
      .slice(0, limit)
      .map((entry) => entry.id)
  }

  const scored: Array<{ id: number; score: number }> = []
  index.places.forEach((place, id) => {
    const hay = place.norm
    let rank: number
    if (hay === norm) rank = 0
    else if (hay.startsWith(norm)) rank = 1
    else if (hay.split(' ').some((word) => word.startsWith(norm))) rank = 2
    else if (hay.includes(norm)) rank = 3
    else return
    // A rang egal, les libelles courts sont plus souvent ce qu on cherche
    // ("LYON (intramuros)" avant "LYON ST EXUPERY TGV").
    scored.push({ id, score: rank * 1000 + hay.length })
  })

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((entry) => entry.id)
}

/** Libelle de la ville d une gare. */
export function placeNameOf(index: PlaceIndex, station: StationId): string {
  const place = index.places[index.placeOf[station] ?? -1]
  return place?.name ?? `gare #${station}`
}

/**
 * Etiquette d une gare physique.
 *
 * Dans une ville multi-gares, le dataset ne fournit aucun nom de gare : on
 * expose donc le code IATA plutot que d inventer un libelle.
 */
export function stationLabel(index: PlaceIndex, station: StationId): string {
  const place = index.places[index.placeOf[station] ?? -1]
  const code = index.stations[station]?.iata
  if (!place) return code ?? `gare #${station}`
  return place.multiStation && code ? `${place.name} [${code}]` : place.name
}
