import { describe, expect, it } from 'vitest'
import { itineraryUrl } from '../../shared/deeplink'
import { buildPlaceIndex, normalizeStationName } from '../../shared/places'
import type { Station } from '../../shared/types'
import {
  defaultQuery,
  queryToSearchParams,
  searchParamsToQuery,
  stationsOfPlace,
  type SearchQuery,
} from './query'

const RAW: Array<[string, string]> = [
  ['BORDEAUX ST JEAN', 'FRBOJ'],
  ['PARIS (intramuros)', 'FRPMO'],
  ['PARIS (intramuros)', 'FRPLY'],
  ['TOULOUSE MATABIAU', 'FRXYT'],
]
const stations: Station[] = RAW.map(([name, iata]) => ({
  name,
  iata,
  norm: normalizeStationName(name),
}))
const index = buildPlaceIndex(stations)
const PARIS = index.byNorm.get(normalizeStationName('PARIS (intramuros)'))!
const TOULOUSE = index.byNorm.get(normalizeStationName('TOULOUSE MATABIAU'))!

const base = () => defaultQuery('2026-08-28', '2026-09-27')

function roundTrip(query: SearchQuery): SearchQuery {
  return searchParamsToQuery(queryToSearchParams(query, index), index, base())
}

describe('liens partageables', () => {
  it('conserve la recherche a l aller-retour', () => {
    const query: SearchQuery = {
      ...base(),
      from: TOULOUSE,
      to: PARIS,
      dateMode: 'single',
      dateFrom: '2026-08-30',
      departFrom: 960,
      departTo: 1290,
      maxChanges: 2,
      maxDurationMinutes: 500,
    }
    const back = roundTrip(query)
    expect(back.from).toBe(TOULOUSE)
    expect(back.to).toBe(PARIS)
    expect(back.dateMode).toBe('single')
    expect(back.dateFrom).toBe('2026-08-30')
    expect(back.departFrom).toBe(960)
    expect(back.departTo).toBe(1290)
    expect(back.maxChanges).toBe(2)
    expect(back.maxDurationMinutes).toBe(500)
  })

  it('designe les villes par leur slug, stable entre deux builds', () => {
    const params = queryToSearchParams({ ...base(), from: TOULOUSE, to: PARIS }, index)
    expect(params.get('de')).toBe('toulouse-matabiau')
    expect(params.get('vers')).toBe('paris-intramuros')
    // Un index de ville n aurait aucun sens dans une URL partagee : il est
    // recalcule a chaque build.
    expect(params.toString()).not.toContain(String(PARIS))
  })

  it('resiste a une URL abimee sans planter', () => {
    const params = new URLSearchParams('de=gare-inexistante&vers=paris-intramuros&h=nawak&d1=32/13')
    const back = searchParamsToQuery(params, index, base())
    expect(back.from).toBeNull()
    expect(back.to).toBe(PARIS)
    expect(back.departFrom).toBe(0) // plage horaire illisible : valeur par defaut
    expect(back.dateFrom).toBe('2026-08-28')
  })
})

describe('stationsOfPlace', () => {
  it('developpe une ville en toutes ses gares physiques', () => {
    expect(stationsOfPlace(index, PARIS)).toHaveLength(2)
    expect(stationsOfPlace(index, TOULOUSE)).toHaveLength(1)
    expect(stationsOfPlace(index, null)).toEqual([])
  })
})

describe('itineraryUrl', () => {
  /**
   * Le lien des notifications doit etre relisible par le site : c est ce qui
   * permet d ouvrir la bonne recherche d une seule touche depuis le telephone.
   */
  it('produit une URL que le site sait relire', () => {
    const url = itineraryUrl('https://gsename.github.io/MaxFinder/', {
      fromSlug: 'toulouse-matabiau',
      toSlug: 'paris-intramuros',
      date: '2026-08-30',
      maxChanges: 1,
    })
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/MaxFinder/')

    const back = searchParamsToQuery(parsed.searchParams, index, base())
    expect(back.from).toBe(TOULOUSE)
    expect(back.to).toBe(PARIS)
    expect(back.dateMode).toBe('single')
    expect(back.dateFrom).toBe('2026-08-30')
    expect(back.maxChanges).toBe(1)
  })

  it('tolere une URL de site avec ou sans barre finale', () => {
    const target = {
      fromSlug: 'toulouse-matabiau',
      toSlug: 'paris-intramuros',
      date: '2026-08-30',
      maxChanges: 0 as const,
    }
    expect(itineraryUrl('https://exemple.fr/app', target)).toBe(
      itineraryUrl('https://exemple.fr/app/', target),
    )
  })

  it('omet le parametre de correspondances pour un direct', () => {
    const url = itineraryUrl('https://exemple.fr/', {
      fromSlug: 'a',
      toSlug: 'b',
      date: '2026-08-30',
      maxChanges: 0,
    })
    expect(url).not.toContain('chgt')
  })
})
