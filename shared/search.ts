import type { PlaceIndex } from './places'
import { MINUTES_PER_DAY } from './time'
import type { Itinerary, Leg, StationId, Trip, TripTuple } from './types'

export interface SearchOptions {
  /** Gares physiques de depart acceptees (toutes celles de la ville choisie). */
  from: StationId[]
  to: StationId[]
  /** Borne basse de l'heure de depart du premier troncon, en minutes. */
  departFrom?: number
  departTo?: number
  /** Borne haute de l'heure d'arrivee finale (peut depasser 1440). */
  arriveBefore?: number
  maxDurationMinutes?: number
  /** 0 = directs uniquement, 1 = une correspondance, 2 = deux. */
  maxChanges: 0 | 1 | 2
  /** Correspondance minimale au sein d'une meme gare physique. */
  minConnection: number
  /** Correspondance minimale entre deux gares d'une meme ville (Paris Est vers Montparnasse). */
  cityTransferConnection: number
  /** Attente maximale toleree sur une correspondance. */
  maxConnectionWait: number
  /**
   * N'explorer un niveau de correspondance supplementaire que si le niveau
   * precedent n'a rien donne. Evite de noyer un direct sous 200 trajets a deux
   * changements.
   */
  escalateOnlyIfEmpty: boolean
  /** Garde-fou sur le nombre de resultats par niveau de correspondance. */
  maxResultsPerLevel: number
}

export const DEFAULT_SEARCH_OPTIONS = {
  minConnection: 20,
  cityTransferConnection: 60,
  maxConnectionWait: 240,
  escalateOnlyIfEmpty: true,
  maxResultsPerLevel: 200,
} as const

/** Trajets d'une journee indexes par gare physique de depart, tries par heure. */
export interface DayGraph {
  date: string
  byOrigin: Map<StationId, Trip[]>
  trips: Trip[]
}

export function buildDayGraph(date: string, trips: Trip[]): DayGraph {
  const byOrigin = new Map<StationId, Trip[]>()
  for (const trip of trips) {
    let bucket = byOrigin.get(trip.origin)
    if (!bucket) {
      bucket = []
      byOrigin.set(trip.origin, bucket)
    }
    bucket.push(trip)
  }
  for (const bucket of byOrigin.values()) bucket.sort((a, b) => a.dep - b.dep)
  return { date, byOrigin, trips }
}

/** Index du premier trajet dont le depart est superieur ou egal a minDep. */
function firstDepartureAtOrAfter(sorted: Trip[], minDep: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]!.dep < minDep) lo = mid + 1
    else hi = mid
  }
  return lo
}

function legOf(trip: Trip): Leg {
  return { trainNo: trip.trainNo, origin: trip.origin, dest: trip.dest, dep: trip.dep, arr: trip.arr }
}

function itineraryKey(date: string, legs: Leg[], index: PlaceIndex): string {
  const parts = legs.map((leg) => {
    const o = index.stations[leg.origin]?.iata ?? `#${leg.origin}`
    const d = index.stations[leg.dest]?.iata ?? `#${leg.dest}`
    return `${leg.trainNo}:${o}>${d}@${leg.dep}`
  })
  return `${date}|${parts.join('+')}`
}

function makeItinerary(date: string, legs: Leg[], index: PlaceIndex): Itinerary {
  const first = legs[0]!
  const last = legs[legs.length - 1]!
  // Un transfert intra-ville se lit directement dans la chaine des troncons :
  // on repart d'une gare physique differente de celle ou l'on est arrive.
  const hasCityTransfer = legs.slice(1).some((leg, i) => leg.origin !== legs[i]!.dest)
  return {
    date,
    legs,
    dep: first.dep,
    arr: last.arr,
    duration: last.arr - first.dep,
    changes: legs.length - 1,
    key: itineraryKey(date, legs, index),
    hasCityTransfer,
  }
}

/**
 * Recherche les trajets d'une journee reliant les gares `from` aux gares `to`.
 *
 * Deux regles issues de la forme reelle du dataset :
 *
 *  - Les correspondances ne franchissent jamais minuit. Un troncon qui arrive
 *    apres 24 h ne peut etre que le dernier, la suite du voyage se trouvant dans
 *    le fichier du lendemain.
 *  - Une correspondance peut changer de gare physique au sein d'une meme ville
 *    (arriver a Paris Est, repartir de Montparnasse), au prix du temps de
 *    transfert urbain. Sans cela, aucun trajet transversal via Paris ne serait
 *    trouvable, alors que c'est le cas d'usage le plus courant.
 */
export function findItineraries(
  graph: DayGraph,
  opts: SearchOptions,
  index: PlaceIndex,
): Itinerary[] {
  const from = new Set(opts.from)
  const to = new Set(opts.to)
  if (from.size === 0 || to.size === 0) return []

  const departFrom = opts.departFrom ?? 0
  const departTo = opts.departTo ?? MINUTES_PER_DAY - 1
  const results: Itinerary[] = []
  const seen = new Set<string>()

  const placeOf = (station: StationId): number => index.placeOf[station] ?? -1
  const originPlaces = new Set([...from].map(placeOf))

  const accept = (legs: Leg[]): void => {
    const arr = legs[legs.length - 1]!.arr
    const dep = legs[0]!.dep
    if (opts.arriveBefore !== undefined && arr > opts.arriveBefore) return
    if (opts.maxDurationMinutes !== undefined && arr - dep > opts.maxDurationMinutes) return
    const itinerary = makeItinerary(graph.date, legs, index)
    if (seen.has(itinerary.key)) return
    seen.add(itinerary.key)
    results.push(itinerary)
  }

  /**
   * Trajets repartant apres une arrivee a `arrivalStation`, depuis cette gare ou
   * depuis une gare voisine de la meme ville.
   */
  const onwardTrips = (arrivalStation: StationId, arrivedAt: number): Trip[] => {
    if (arrivedAt >= MINUTES_PER_DAY) return [] // pas de correspondance apres minuit
    const out: Trip[] = []
    for (const departureStation of index.siblingsOf[arrivalStation] ?? [arrivalStation]) {
      const bucket = graph.byOrigin.get(departureStation)
      if (!bucket) continue
      const gap =
        departureStation === arrivalStation ? opts.minConnection : opts.cityTransferConnection
      const earliest = arrivedAt + gap
      const latest = earliest + opts.maxConnectionWait
      for (let i = firstDepartureAtOrAfter(bucket, earliest); i < bucket.length; i++) {
        const trip = bucket[i]!
        if (trip.dep > latest) break
        out.push(trip)
      }
    }
    return out
  }

  const firstLegs: Trip[] = []
  for (const origin of from) {
    const bucket = graph.byOrigin.get(origin)
    if (!bucket) continue
    for (let i = firstDepartureAtOrAfter(bucket, departFrom); i < bucket.length; i++) {
      const trip = bucket[i]!
      if (trip.dep > departTo) break
      firstLegs.push(trip)
    }
  }

  // Niveau 0 : directs.
  for (const trip of firstLegs) {
    if (to.has(trip.dest)) accept([legOf(trip)])
  }
  const directCount = results.length
  if (opts.maxChanges === 0) return sortItineraries(results)
  if (opts.escalateOnlyIfEmpty && directCount > 0) return sortItineraries(results)

  // Niveau 1 : une correspondance.
  for (const first of firstLegs) {
    if (to.has(first.dest)) continue // deja couvert par le direct
    for (const second of onwardTrips(first.dest, first.arr)) {
      // Revenir dans la ville de depart n'est pas une correspondance utile.
      if (originPlaces.has(placeOf(second.dest))) continue
      if (!to.has(second.dest)) continue
      if (results.length - directCount >= opts.maxResultsPerLevel) break
      accept([legOf(first), legOf(second)])
    }
  }
  const oneChangeCount = results.length - directCount
  if (opts.maxChanges === 1) return sortItineraries(results)
  if (opts.escalateOnlyIfEmpty && oneChangeCount > 0) return sortItineraries(results)

  // Niveau 2 : deux correspondances.
  const levelStart = results.length
  outer: for (const first of firstLegs) {
    if (to.has(first.dest)) continue
    for (const second of onwardTrips(first.dest, first.arr)) {
      if (originPlaces.has(placeOf(second.dest)) || to.has(second.dest)) continue
      for (const third of onwardTrips(second.dest, second.arr)) {
        // Ni retour au point de depart, ni boucle par la ville deja traversee.
        if (originPlaces.has(placeOf(third.dest))) continue
        if (placeOf(third.dest) === placeOf(first.dest)) continue
        if (!to.has(third.dest)) continue
        accept([legOf(first), legOf(second), legOf(third)])
        if (results.length - levelStart >= opts.maxResultsPerLevel) break outer
      }
    }
  }

  return sortItineraries(results)
}

/** Moins de changements d'abord, puis arrivee au plus tot, puis trajet le plus court. */
export function sortItineraries(items: Itinerary[]): Itinerary[] {
  return items.sort(
    (a, b) => a.changes - b.changes || a.arr - b.arr || a.duration - b.duration || a.dep - b.dep,
  )
}

export function decodeDayTrips(tuples: readonly TripTuple[]): Trip[] {
  return tuples.map(([trainNo, origin, dest, dep, arr]) => ({ trainNo, origin, dest, dep, arr }))
}
