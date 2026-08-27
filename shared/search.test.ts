import { describe, expect, it } from 'vitest'
import { buildPlaceIndex, normalizeStationName } from './places'
import { buildDayGraph, findItineraries, type SearchOptions } from './search'
import { MINUTES_PER_DAY, parseHm } from './time'
import type { Station, Trip } from './types'

/**
 * Fixture calquee sur la forme reelle du dataset : "PARIS (intramuros)" y porte
 * deux gares physiques distinctes, comme les six vraies. C est ce qui distingue
 * une correspondance au meme quai d un transfert a traverser la ville.
 */
const RAW: Array<[name: string, iata: string]> = [
  ['ANGOULEME', 'FRANG'],
  ['BORDEAUX ST JEAN', 'FRBOJ'],
  ['MASSY TGV', 'FRDJU'],
  ['PARIS (intramuros)', 'FRPST'], // Paris Est
  ['PARIS (intramuros)', 'FRPMO'], // Paris Montparnasse
  ['POITIERS', 'FRPIS'],
]
const stations: Station[] = RAW.map(([name, iata]) => ({
  name,
  iata,
  norm: normalizeStationName(name),
}))
const index = buildPlaceIndex(stations)
const [ANGOULEME, BORDEAUX, MASSY, PARIS_EST, PARIS_MONTP, POITIERS] = [0, 1, 2, 3, 4, 5]
const PARIS_ALL = [PARIS_EST, PARIS_MONTP]

function trip(trainNo: string, origin: number, dest: number, dep: string, arr: string): Trip {
  const depMin = parseHm(dep)
  const arrMin = parseHm(arr)
  return {
    trainNo,
    origin,
    dest,
    dep: depMin,
    arr: arrMin < depMin ? arrMin + MINUTES_PER_DAY : arrMin,
  }
}

function opts(overrides: Partial<SearchOptions> = {}): SearchOptions {
  return {
    from: PARIS_ALL,
    to: [BORDEAUX],
    maxChanges: 1,
    minConnection: 20,
    cityTransferConnection: 60,
    maxConnectionWait: 240,
    escalateOnlyIfEmpty: false,
    maxResultsPerLevel: 200,
    ...overrides,
  }
}

const graph = (trips: Trip[]) => buildDayGraph('2026-09-03', trips)

describe('villes multi-gares', () => {
  it('regroupe les gares homonymes en une seule ville', () => {
    const paris = index.places[index.placeOf[PARIS_EST]!]!
    expect(paris.name).toBe('PARIS (intramuros)')
    expect(paris.multiStation).toBe(true)
    expect(paris.stations).toEqual(PARIS_ALL)
    expect(index.placeOf[PARIS_EST]).toBe(index.placeOf[PARIS_MONTP])
  })

  it('choisir la ville trouve les trains de toutes ses gares', () => {
    // Regression : en indexant par code IATA seul, une recherche "PARIS" ne
    // voyait qu une gare sur deux et manquait la majorite des trains.
    const trips = [
      trip('DEPUIS-EST', PARIS_EST, BORDEAUX, '08:00', '11:00'),
      trip('DEPUIS-MONTP', PARIS_MONTP, BORDEAUX, '09:00', '12:00'),
    ]
    const found = findItineraries(graph(trips), opts({ maxChanges: 0 }), index)
    expect(found.map((i) => i.legs[0]!.trainNo).sort()).toEqual(['DEPUIS-EST', 'DEPUIS-MONTP'])
  })

  it('trouve aussi les arrivees dans toutes les gares de la ville', () => {
    const trips = [
      trip('VERS-EST', BORDEAUX, PARIS_EST, '08:00', '11:00'),
      trip('VERS-MONTP', BORDEAUX, PARIS_MONTP, '09:00', '12:00'),
    ]
    const found = findItineraries(
      graph(trips),
      opts({ from: [BORDEAUX], to: PARIS_ALL, maxChanges: 0 }),
      index,
    )
    expect(found).toHaveLength(2)
  })
})

describe('trajets directs', () => {
  it('trouve un direct et calcule sa duree', () => {
    const found = findItineraries(
      graph([trip('8441', PARIS_MONTP, BORDEAUX, '06:06', '09:02')]),
      opts({ maxChanges: 0 }),
      index,
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.changes).toBe(0)
    expect(found[0]!.duration).toBe(176)
    expect(found[0]!.hasCityTransfer).toBe(false)
  })

  it('respecte la plage horaire de depart', () => {
    const trips = [
      trip('1', PARIS_MONTP, BORDEAUX, '06:06', '09:02'),
      trip('2', PARIS_MONTP, BORDEAUX, '18:10', '21:00'),
    ]
    const found = findItineraries(
      graph(trips),
      opts({ maxChanges: 0, departFrom: parseHm('16:00'), departTo: parseHm('21:00') }),
      index,
    )
    expect(found.map((i) => i.legs[0]!.trainNo)).toEqual(['2'])
  })

  it('filtre sur l heure d arrivee et la duree totale', () => {
    const trips = [trip('1', PARIS_MONTP, BORDEAUX, '06:06', '09:02')]
    expect(
      findItineraries(graph(trips), opts({ maxChanges: 0, arriveBefore: parseHm('08:00') }), index),
    ).toHaveLength(0)
    expect(
      findItineraries(graph(trips), opts({ maxChanges: 0, maxDurationMinutes: 120 }), index),
    ).toHaveLength(0)
  })

  it('batit la cle sur les codes IATA, stables, et non sur les StationId', () => {
    const found = findItineraries(
      graph([trip('8441', PARIS_MONTP, BORDEAUX, '06:06', '09:02')]),
      opts({ maxChanges: 0 }),
      index,
    )
    expect(found[0]!.key).toBe(`2026-09-03|8441:FRPMO>FRBOJ@${parseHm('06:06')}`)
  })
})

describe('une correspondance', () => {
  it('enchaine deux troncons quand la correspondance est suffisante', () => {
    const trips = [
      trip('A', PARIS_MONTP, POITIERS, '07:00', '08:30'),
      trip('B', POITIERS, BORDEAUX, '09:00', '10:15'),
    ]
    const found = findItineraries(graph(trips), opts(), index)
    expect(found).toHaveLength(1)
    expect(found[0]!.changes).toBe(1)
    expect(found[0]!.legs.map((l) => l.trainNo)).toEqual(['A', 'B'])
    expect(found[0]!.duration).toBe(195)
    expect(found[0]!.hasCityTransfer).toBe(false)
  })

  it('refuse une correspondance plus courte que le minimum', () => {
    const trips = [
      trip('A', PARIS_MONTP, POITIERS, '07:00', '08:30'),
      trip('B', POITIERS, BORDEAUX, '08:45', '10:00'), // 15 min, minimum 20
    ]
    expect(findItineraries(graph(trips), opts(), index)).toHaveLength(0)
    expect(findItineraries(graph(trips), opts({ minConnection: 15 }), index)).toHaveLength(1)
  })

  it('refuse une attente superieure au plafond', () => {
    const trips = [
      trip('A', PARIS_MONTP, POITIERS, '07:00', '08:30'),
      trip('B', POITIERS, BORDEAUX, '15:00', '16:15'), // 6 h 30 d attente
    ]
    expect(findItineraries(graph(trips), opts({ maxConnectionWait: 240 }), index)).toHaveLength(0)
    expect(findItineraries(graph(trips), opts({ maxConnectionWait: 420 }), index)).toHaveLength(1)
  })

  it('ne prolonge pas un troncon arrive apres minuit', () => {
    // La suite du voyage serait dans le fichier du lendemain, que le graphe du
    // jour ne contient pas : proposer la correspondance serait un mensonge.
    const trips = [
      trip('A', PARIS_MONTP, POITIERS, '23:00', '00:30'),
      trip('B', POITIERS, BORDEAUX, '01:30', '02:45'),
    ]
    expect(findItineraries(graph(trips), opts(), index)).toHaveLength(0)
  })

  it('accepte un direct qui arrive apres minuit', () => {
    const found = findItineraries(
      graph([trip('A', PARIS_MONTP, BORDEAUX, '23:00', '01:30')]),
      opts({ maxChanges: 0 }),
      index,
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.duration).toBe(150)
    expect(found[0]!.arr).toBeGreaterThan(MINUTES_PER_DAY)
  })
})

describe('transfert entre deux gares d une meme ville', () => {
  it('rend possible un trajet transversal via Paris', () => {
    // Sans ce mecanisme, arriver Gare de l Est et repartir de Montparnasse
    // serait introuvable, alors que c est le trajet transversal le plus banal.
    const trips = [
      trip('A', ANGOULEME, PARIS_EST, '07:00', '09:00'),
      trip('B', PARIS_MONTP, BORDEAUX, '10:30', '12:30'),
    ]
    const found = findItineraries(graph(trips), opts({ from: [ANGOULEME] }), index)
    expect(found).toHaveLength(1)
    expect(found[0]!.hasCityTransfer).toBe(true)
    expect(found[0]!.legs[0]!.dest).toBe(PARIS_EST)
    expect(found[0]!.legs[1]!.origin).toBe(PARIS_MONTP)
  })

  it('exige le temps de transfert urbain, plus long qu une correspondance a quai', () => {
    const trips = [
      trip('A', ANGOULEME, PARIS_EST, '07:00', '09:00'),
      trip('B', PARIS_MONTP, BORDEAUX, '09:30', '11:30'), // 30 min pour traverser Paris
    ]
    const o = opts({ from: [ANGOULEME] })
    expect(findItineraries(graph(trips), o, index)).toHaveLength(0)
    expect(findItineraries(graph(trips), { ...o, cityTransferConnection: 30 }, index)).toHaveLength(1)
  })

  it('n applique pas le delai urbain a une correspondance dans la meme gare', () => {
    // Rester a Montparnasse ne coute que le temps de changer de quai, meme si
    // la ville, elle, compte plusieurs gares.
    const trips = [
      trip('A', ANGOULEME, PARIS_MONTP, '07:00', '09:00'),
      trip('B', PARIS_MONTP, BORDEAUX, '09:25', '11:30'), // 25 min, meme gare
    ]
    const found = findItineraries(graph(trips), opts({ from: [ANGOULEME] }), index)
    expect(found).toHaveLength(1)
    expect(found[0]!.hasCityTransfer).toBe(false)
  })

  it('interdit de revenir dans la ville de depart', () => {
    const trips = [
      trip('A', PARIS_MONTP, POITIERS, '07:00', '08:30'),
      trip('B', POITIERS, PARIS_EST, '09:00', '10:30'),
    ]
    // Meme en visant une autre gare parisienne, ce n est pas un trajet utile.
    expect(
      findItineraries(graph(trips), opts({ to: PARIS_ALL }), index).filter((i) => i.changes === 1),
    ).toHaveLength(0)
  })
})

describe('deux correspondances', () => {
  const trips = [
    trip('A', PARIS_MONTP, POITIERS, '07:00', '08:30'),
    trip('B', POITIERS, MASSY, '09:00', '10:00'),
    trip('C', MASSY, BORDEAUX, '10:30', '12:30'),
  ]

  it('enchaine trois troncons', () => {
    const found = findItineraries(graph(trips), opts({ maxChanges: 2 }), index)
    expect(found).toHaveLength(1)
    expect(found[0]!.changes).toBe(2)
    expect(found[0]!.legs.map((l) => l.trainNo)).toEqual(['A', 'B', 'C'])
  })

  it('ne les cherche pas quand maxChanges vaut 1', () => {
    expect(findItineraries(graph(trips), opts({ maxChanges: 1 }), index)).toHaveLength(0)
  })

  it('ne boucle pas par une ville deja traversee', () => {
    const looping = [
      trip('A', PARIS_MONTP, POITIERS, '07:00', '08:30'),
      trip('B', POITIERS, MASSY, '09:00', '10:00'),
      trip('C', MASSY, POITIERS, '10:30', '11:30'),
    ]
    expect(
      findItineraries(graph(looping), opts({ maxChanges: 2, to: [POITIERS] }), index).filter(
        (i) => i.changes === 2,
      ),
    ).toHaveLength(0)
  })
})

describe('escalade progressive', () => {
  const trips = [
    trip('DIRECT', PARIS_MONTP, BORDEAUX, '08:00', '11:00'),
    trip('A', PARIS_MONTP, POITIERS, '07:00', '08:30'),
    trip('B', POITIERS, BORDEAUX, '09:00', '10:15'),
  ]

  it('masque les correspondances quand un direct existe', () => {
    const found = findItineraries(graph(trips), opts({ escalateOnlyIfEmpty: true }), index)
    expect(found.map((i) => i.changes)).toEqual([0])
  })

  it('les expose quand on demande tout', () => {
    const found = findItineraries(graph(trips), opts({ escalateOnlyIfEmpty: false }), index)
    expect(found.map((i) => i.changes)).toEqual([0, 1])
  })

  it('trie du moins de changements a l arrivee la plus tot', () => {
    const found = findItineraries(
      graph([
        trip('TARD', PARIS_MONTP, BORDEAUX, '08:00', '12:00'),
        trip('TOT', PARIS_MONTP, BORDEAUX, '06:00', '09:00'),
      ]),
      opts({ maxChanges: 0 }),
      index,
    )
    expect(found.map((i) => i.legs[0]!.trainNo)).toEqual(['TOT', 'TARD'])
  })
})

describe('robustesse', () => {
  it('renvoie une liste vide sans gare selectionnee', () => {
    expect(findItineraries(graph([]), opts({ from: [] }), index)).toEqual([])
    expect(findItineraries(graph([]), opts({ to: [] }), index)).toEqual([])
  })

  it('deduplique des trajets identiques', () => {
    const t = trip('A', PARIS_MONTP, BORDEAUX, '08:00', '11:00')
    const found = findItineraries(graph([t, { ...t }]), opts({ maxChanges: 0 }), index)
    expect(found).toHaveLength(1)
  })
})
