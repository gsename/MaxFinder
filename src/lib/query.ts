import type { PlaceIndex } from '../../shared/places'
import { DEFAULT_SEARCH_OPTIONS } from '../../shared/search'
import { formatHm, parseHm } from '../../shared/time'

export type DateMode = 'single' | 'range' | 'window'

/**
 * Etat du formulaire, aussi porte par la query string pour des liens partageables.
 *
 * `from` et `to` sont des index de *ville* (Place), pas de gare physique :
 * choisir Paris doit chercher au depart de ses six gares.
 */
export interface SearchQuery {
  from: number | null
  to: number | null
  dateMode: DateMode
  dateFrom: string
  dateTo: string
  departFrom: number
  departTo: number
  maxChanges: 0 | 1 | 2
  minConnection: number
  cityTransferConnection: number
  maxConnectionWait: number
  maxDurationMinutes: number | null
}

export function defaultQuery(firstDate: string, lastDate: string): SearchQuery {
  return {
    from: null,
    to: null,
    dateMode: 'window',
    dateFrom: firstDate,
    dateTo: lastDate,
    departFrom: 0,
    departTo: 1439,
    maxChanges: 0,
    minConnection: DEFAULT_SEARCH_OPTIONS.minConnection,
    cityTransferConnection: DEFAULT_SEARCH_OPTIONS.cityTransferConnection,
    maxConnectionWait: DEFAULT_SEARCH_OPTIONS.maxConnectionWait,
    maxDurationMinutes: null,
  }
}

/** Dates du dataset retenues par la requete. */
export function datesForQuery(query: SearchQuery, availableDates: string[]): string[] {
  if (query.dateMode === 'window') return availableDates
  if (query.dateMode === 'single') return availableDates.filter((d) => d === query.dateFrom)
  return availableDates.filter((d) => d >= query.dateFrom && d <= query.dateTo)
}

/**
 * Serialise vers la query string avec le slug de la ville plutot que son index :
 * les index sont recalcules a chaque build et un lien partage cesserait de
 * designer la meme ville au deploiement suivant.
 */
export function queryToSearchParams(query: SearchQuery, index: PlaceIndex): URLSearchParams {
  const params = new URLSearchParams()
  if (query.from !== null) params.set('de', index.places[query.from]!.slug)
  if (query.to !== null) params.set('vers', index.places[query.to]!.slug)
  params.set('quand', query.dateMode)
  if (query.dateMode !== 'window') {
    params.set('d1', query.dateFrom)
    if (query.dateMode === 'range') params.set('d2', query.dateTo)
  }
  if (query.departFrom !== 0 || query.departTo !== 1439) {
    params.set('h', `${formatHm(query.departFrom)}-${formatHm(query.departTo)}`)
  }
  if (query.maxChanges !== 0) params.set('chgt', String(query.maxChanges))
  if (query.maxDurationMinutes !== null) params.set('duree', String(query.maxDurationMinutes))
  return params
}

export function searchParamsToQuery(
  params: URLSearchParams,
  index: PlaceIndex,
  fallback: SearchQuery,
): SearchQuery {
  const query: SearchQuery = { ...fallback }

  const de = params.get('de')
  if (de) query.from = index.bySlug.get(de.toLowerCase()) ?? null
  const vers = params.get('vers')
  if (vers) query.to = index.bySlug.get(vers.toLowerCase()) ?? null

  const mode = params.get('quand')
  if (mode === 'single' || mode === 'range' || mode === 'window') query.dateMode = mode

  const d1 = params.get('d1')
  if (d1 && /^\d{4}-\d{2}-\d{2}$/.test(d1)) query.dateFrom = d1
  const d2 = params.get('d2')
  if (d2 && /^\d{4}-\d{2}-\d{2}$/.test(d2)) query.dateTo = d2

  const hours = params.get('h')
  if (hours) {
    const [a, b] = hours.split('-')
    try {
      if (a) query.departFrom = parseHm(a)
      if (b) query.departTo = parseHm(b)
    } catch {
      // Une plage horaire illisible dans l URL ne doit pas bloquer la page.
    }
  }

  const changes = params.get('chgt')
  if (changes === '1' || changes === '2') query.maxChanges = Number(changes) as 1 | 2

  const duration = Number(params.get('duree'))
  if (Number.isFinite(duration) && duration > 0) query.maxDurationMinutes = duration

  return query
}

/** Gares physiques a interroger pour une ville selectionnee. */
export function stationsOfPlace(index: PlaceIndex, place: number | null): number[] {
  return place === null ? [] : index.places[place]?.stations ?? []
}

/**
 * URL de reservation. Le deep-link horaire de SNCF Connect n etant pas documente
 * publiquement, on ouvre la recherche generique plutot que de fabriquer une URL
 * susceptible de casser sans prevenir.
 */
export const SNCF_CONNECT_URL = 'https://www.sncf-connect.com/'
