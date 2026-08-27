import { addDays, daysBetween, weekdayOf, type WeekdayKey } from './dates'
import { lookupPlace, type PlaceIndex } from './places'
import { buildDayGraph, findItineraries, DEFAULT_SEARCH_OPTIONS, type SearchOptions } from './search'
import type { Itinerary, StationId, Trip } from './types'

/**
 * Une regle de surveillance, telle qu'elle vit dans `watches.yml`.
 *
 * Les gares sont designees par leur libelle (ou par un code IATA), jamais par un
 * StationId : les ids sont des index de build et changent des que la SNCF ajoute
 * ou retire une gare.
 */
export interface WatchRule {
  name: string
  enabled: boolean
  from: string[]
  to: string[]
  /** Bornes absolues, format YYYY-MM-DD. */
  dateFrom?: string
  dateTo?: string
  /** Fenetre glissante en jours a partir d'aujourd'hui, ex. [0, 31]. */
  relativeDays?: [number, number]
  /** Restreint aux jours de la semaine listes. */
  weekdays?: WeekdayKey[]
  departBetween?: [number, number]
  arriveBefore?: number
  maxDurationMinutes?: number
  maxChanges: 0 | 1 | 2
  minConnection: number
  cityTransferConnection: number
  maxConnectionWait: number
  /** Priorite ntfy (1 = discret, 5 = urgent). */
  priority: number
}

export interface ResolvedPlaces {
  /** Gares physiques a interroger : toutes celles des villes reconnues. */
  stations: StationId[]
  /** Libelles saisis qu'on n'a pas su resoudre, avec les candidats trouves. */
  unresolved: Array<{ input: string; candidates: string[] }>
}

/**
 * Traduit des libelles de villes en gares physiques.
 *
 * Une seule saisie peut donner plusieurs gares : "PARIS (intramuros)" en donne
 * six. C'est voulu, sinon une alerte Paris vers Bordeaux ignorerait cinq gares
 * parisiennes sur six.
 */
export function resolvePlaceNames(index: PlaceIndex, names: string[]): ResolvedPlaces {
  const stations: StationId[] = []
  const unresolved: ResolvedPlaces['unresolved'] = []
  for (const name of names) {
    const found = lookupPlace(index, name)
    if (found.place !== undefined) {
      stations.push(...index.places[found.place]!.stations)
    } else {
      unresolved.push({
        input: name,
        candidates: (found.candidates ?? []).slice(0, 6).map((id) => index.places[id]!.name),
      })
    }
  }
  return { stations: [...new Set(stations)], unresolved }
}

/** Bornes absolues effectives de la regle, contraintes relatives resolues. */
export function watchDateBounds(
  rule: WatchRule,
  today: string,
): { lower?: string; upper?: string } {
  let lower = rule.dateFrom
  let upper = rule.dateTo

  if (rule.relativeDays) {
    const [start, end] = rule.relativeDays
    const relLower = addDays(today, start)
    const relUpper = addDays(today, end)
    lower = lower && lower > relLower ? lower : relLower
    upper = upper && upper < relUpper ? upper : relUpper
  }

  return { lower, upper }
}

/** Dates du dataset retenues par la regle. */
export function datesForWatch(rule: WatchRule, availableDates: string[], today: string): string[] {
  const { lower, upper } = watchDateBounds(rule, today)

  return availableDates.filter((date) => {
    if (lower && date < lower) return false
    if (upper && date > upper) return false
    if (rule.weekdays && rule.weekdays.length > 0 && !rule.weekdays.includes(weekdayOf(date))) {
      return false
    }
    return true
  })
}

export function watchToSearchOptions(
  rule: WatchRule,
  from: StationId[],
  to: StationId[],
): SearchOptions {
  return {
    from,
    to,
    departFrom: rule.departBetween?.[0],
    departTo: rule.departBetween?.[1],
    arriveBefore: rule.arriveBefore,
    maxDurationMinutes: rule.maxDurationMinutes,
    maxChanges: rule.maxChanges,
    minConnection: rule.minConnection,
    cityTransferConnection: rule.cityTransferConnection,
    maxConnectionWait: rule.maxConnectionWait,
    // Une alerte doit rapporter tout ce qui existe, y compris les
    // correspondances quand un direct est deja dispo : l'horaire du direct ne
    // convient pas forcement a l'abonne.
    escalateOnlyIfEmpty: false,
    maxResultsPerLevel: 50,
  }
}

export interface WatchMatchResult {
  rule: WatchRule
  itineraries: Itinerary[]
  unresolved: ResolvedPlaces['unresolved']
}

/**
 * Evalue une regle sur les journees fournies.
 *
 * Cette fonction est le point de verite unique : elle sert au job d'alertes dans
 * GitHub Actions comme a la previsualisation dans le navigateur, ce qui garantit
 * qu'une alerte annonce exactement ce que le site affiche.
 */
export function matchWatch(
  rule: WatchRule,
  days: Map<string, Trip[]>,
  index: PlaceIndex,
  today: string,
): WatchMatchResult {
  const fromResolved = resolvePlaceNames(index, rule.from)
  const toResolved = resolvePlaceNames(index, rule.to)
  const unresolved = [...fromResolved.unresolved, ...toResolved.unresolved]

  if (!rule.enabled || fromResolved.stations.length === 0 || toResolved.stations.length === 0) {
    return { rule, itineraries: [], unresolved }
  }

  const opts = watchToSearchOptions(rule, fromResolved.stations, toResolved.stations)
  const dates = datesForWatch(rule, [...days.keys()].sort(), today)

  const itineraries: Itinerary[] = []
  for (const date of dates) {
    const trips = days.get(date)
    if (!trips) continue
    itineraries.push(...findItineraries(buildDayGraph(date, trips), opts, index))
  }

  return { rule, itineraries, unresolved }
}

export function defaultWatchRule(): WatchRule {
  return {
    name: 'Nouvelle alerte',
    enabled: true,
    from: [],
    to: [],
    relativeDays: [0, 31],
    maxChanges: 0,
    minConnection: DEFAULT_SEARCH_OPTIONS.minConnection,
    cityTransferConnection: DEFAULT_SEARCH_OPTIONS.cityTransferConnection,
    maxConnectionWait: DEFAULT_SEARCH_OPTIONS.maxConnectionWait,
    priority: 4,
  }
}

/**
 * Etat de la fenetre d une regle, pour un diagnostic honnete.
 *
 * Une regle visant une date au-dela des 31 jours publies ne surveille rien
 * *encore* : elle s activera quand la fenetre glissante atteindra cette date.
 * La confondre avec une regle definitivement morte enverrait corriger une
 * configuration parfaitement correcte — c est le cas courant d un voyage
 * reserve deux mois a l avance.
 */
export type WatchWindow =
  | { kind: 'active'; dates: string[] }
  | { kind: 'future'; target: string; publishedOn: string; inDays: number }
  | { kind: 'past'; target: string }
  | { kind: 'filtered' }

export function describeWatchWindow(
  rule: WatchRule,
  availableDates: string[],
  today: string,
): WatchWindow {
  const dates = datesForWatch(rule, availableDates, today)
  if (dates.length > 0) return { kind: 'active', dates }

  const first = availableDates[0]
  const last = availableDates[availableDates.length - 1]
  if (!first || !last) return { kind: 'filtered' }

  const { lower, upper } = watchDateBounds(rule, today)

  if (lower && lower > last) {
    // La fenetre avance d un jour par jour : la date sera publiee quand
    // l ecart avec aujourd hui tombera sous la profondeur de la fenetre.
    const depth = daysBetween(today, last)
    const inDays = Math.max(0, daysBetween(today, lower) - depth)
    return { kind: 'future', target: lower, publishedOn: addDays(today, inDays), inDays }
  }
  if (upper && upper < first) return { kind: 'past', target: upper }
  return { kind: 'filtered' }
}
