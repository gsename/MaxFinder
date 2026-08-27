import { describe, expect, it } from 'vitest'
import { addDays, todayInParis, weekdayOf } from './dates'
import { buildPlaceIndex, normalizeStationName } from './places'
import { parseHm } from './time'
import type { Station, Trip } from './types'
import {
  datesForWatch,
  defaultWatchRule,
  describeWatchWindow,
  matchWatch,
  resolvePlaceNames,
  type WatchRule,
} from './watch'

const NAMES = ['BORDEAUX ST JEAN', 'MASSY TGV', 'PARIS (intramuros)', 'POITIERS']
const stations: Station[] = NAMES.map((name, i) => ({
  name,
  iata: `FR${String(i).padStart(3, '0')}`,
  norm: normalizeStationName(name),
}))
const index = buildPlaceIndex(stations)
const [BORDEAUX, , PARIS, POITIERS] = [0, 1, 2, 3]

function rule(overrides: Partial<WatchRule> = {}): WatchRule {
  return { ...defaultWatchRule(), from: ['PARIS (intramuros)'], to: ['BORDEAUX ST JEAN'], ...overrides }
}

describe('weekdayOf', () => {
  it('calcule le jour sans se laisser decaler par le fuseau', () => {
    expect(weekdayOf('2026-08-27')).toBe('thu')
    expect(weekdayOf('2026-08-29')).toBe('sat')
    expect(weekdayOf('2026-08-30')).toBe('sun')
    expect(weekdayOf('2026-08-31')).toBe('mon')
  })
})

describe('resolvePlaceNames', () => {
  it('resout un libelle exact, un code IATA et une forme accentuee', () => {
    expect(resolvePlaceNames(index, ['PARIS (intramuros)']).stations).toEqual([PARIS])
    expect(resolvePlaceNames(index, ['FR000']).stations).toEqual([BORDEAUX])
    expect(resolvePlaceNames(index, ['Poitiers']).stations).toEqual([POITIERS])
  })

  it('resout un prefixe sans ambiguite', () => {
    expect(resolvePlaceNames(index, ['bordeaux']).stations).toEqual([BORDEAUX])
  })

  it('signale une gare inconnue avec des candidats plutot que d en choisir une', () => {
    const resolved = resolvePlaceNames(index, ['Bordeau-la-Faute'])
    expect(resolved.stations).toEqual([])
    expect(resolved.unresolved).toHaveLength(1)
    expect(resolved.unresolved[0]!.input).toBe('Bordeau-la-Faute')
  })

  it('deduplique deux ecritures de la meme gare', () => {
    expect(resolvePlaceNames(index, ['POITIERS', 'poitiers']).stations).toEqual([POITIERS])
  })
})

describe('datesForWatch', () => {
  const dates = ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31']

  it('sans contrainte, retient toute la fenetre', () => {
    expect(datesForWatch(rule(), dates, '2026-08-27')).toEqual(dates)
  })

  it('applique une fenetre glissante relative', () => {
    expect(datesForWatch(rule({ relativeDays: [1, 2] }), dates, '2026-08-27')).toEqual([
      '2026-08-28',
      '2026-08-29',
    ])
  })

  it('filtre par jour de semaine', () => {
    expect(datesForWatch(rule({ weekdays: ['sat', 'sun'] }), dates, '2026-08-27')).toEqual([
      '2026-08-29',
      '2026-08-30',
    ])
  })

  it('combine bornes absolues et fenetre relative en gardant la plus restrictive', () => {
    const combined = rule({ relativeDays: [0, 31], dateFrom: '2026-08-29', dateTo: '2026-08-30' })
    expect(datesForWatch(combined, dates, '2026-08-27')).toEqual(['2026-08-29', '2026-08-30'])
  })

  it('la fenetre relative suit le jour courant', () => {
    const today = todayInParis()
    const tomorrow = addDays(today, 1)
    expect(datesForWatch(rule({ relativeDays: [1, 1] }), [today, tomorrow], today)).toEqual([
      tomorrow,
    ])
  })
})

describe('matchWatch', () => {
  const days = new Map<string, Trip[]>([
    [
      '2026-08-29',
      [
        { trainNo: 'DIRECT', origin: PARIS, dest: BORDEAUX, dep: parseHm('08:00'), arr: parseHm('11:00') },
        { trainNo: 'A', origin: PARIS, dest: POITIERS, dep: parseHm('17:00'), arr: parseHm('18:30') },
        { trainNo: 'B', origin: POITIERS, dest: BORDEAUX, dep: parseHm('19:00'), arr: parseHm('20:15') },
      ],
    ],
    [
      '2026-08-30',
      [
        { trainNo: 'C', origin: PARIS, dest: BORDEAUX, dep: parseHm('09:00'), arr: parseHm('12:00') },
      ],
    ],
  ])

  it('remonte les directs des dates surveillees', () => {
    const result = matchWatch(rule({ weekdays: ['sat'] }), days, index, '2026-08-29')
    expect(result.itineraries.map((i) => i.legs[0]!.trainNo)).toEqual(['DIRECT'])
  })

  it('remonte aussi les correspondances meme si un direct existe', () => {
    // Une alerte doit tout signaler : l horaire du direct ne convient pas
    // forcement a l abonne, c est justement pourquoi il surveille la liaison.
    const result = matchWatch(rule({ maxChanges: 1, weekdays: ['sat'] }), days, index, '2026-08-29')
    expect(result.itineraries.map((i) => i.changes).sort()).toEqual([0, 1])
  })

  it('applique la plage horaire de depart', () => {
    const result = matchWatch(
      rule({ maxChanges: 1, departBetween: [parseHm('16:00'), parseHm('21:00')] }),
      days,
      index,
      '2026-08-29',
    )
    expect(result.itineraries.map((i) => i.legs[0]!.trainNo)).toEqual(['A'])
  })

  it('ne renvoie rien pour une regle desactivee', () => {
    expect(matchWatch(rule({ enabled: false }), days, index, '2026-08-29').itineraries).toEqual([])
  })

  it('ne renvoie rien mais signale le probleme quand une gare est introuvable', () => {
    const result = matchWatch(rule({ to: ['GARE FANTOME'] }), days, index, '2026-08-29')
    expect(result.itineraries).toEqual([])
    expect(result.unresolved.map((u) => u.input)).toEqual(['GARE FANTOME'])
  })

  it('produit des cles distinctes par date', () => {
    const result = matchWatch(rule(), days, index, '2026-08-29')
    const keys = result.itineraries.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.some((k) => k.startsWith('2026-08-29'))).toBe(true)
    expect(keys.some((k) => k.startsWith('2026-08-30'))).toBe(true)
  })
})

describe('describeWatchWindow', () => {
  // Fenetre publiee de 31 jours, comme celle du dataset reel.
  const dates = Array.from({ length: 31 }, (_, i) => addDays('2026-08-27', i))
  const today = '2026-08-27'
  const dateRule = (from: string, to = from) =>
    rule({ relativeDays: undefined, dateFrom: from, dateTo: to })

  it('reconnait une date presente dans la fenetre', () => {
    const window = describeWatchWindow(dateRule('2026-09-12'), dates, today)
    expect(window.kind).toBe('active')
    if (window.kind === 'active') expect(window.dates).toEqual(['2026-09-12'])
  })

  it('distingue une date encore non publiee d une regle morte', () => {
    // Le cas courant : un voyage prepare deux mois a l avance. La regle est
    // correcte, la SNCF n a simplement pas encore publie la date.
    const window = describeWatchWindow(dateRule('2026-10-24'), dates, today)
    expect(window.kind).toBe('future')
    if (window.kind === 'future') {
      expect(window.target).toBe('2026-10-24')
      // Dernier jour publie = J+30, donc le 24/10 apparaitra 30 jours avant.
      expect(window.publishedOn).toBe('2026-09-24')
      expect(window.inDays).toBe(28)
    }
  })

  it('signale une date sortie de la fenetre', () => {
    const window = describeWatchWindow(dateRule('2026-07-01'), dates, today)
    expect(window.kind).toBe('past')
    if (window.kind === 'past') expect(window.target).toBe('2026-07-01')
  })

  it('signale des criteres qui ne se recoupent jamais', () => {
    // Le 12 septembre 2026 est un samedi : exiger un lundi ne donne rien.
    const impossible = rule({
      relativeDays: undefined,
      dateFrom: '2026-09-12',
      dateTo: '2026-09-12',
      weekdays: ['mon'],
    })
    expect(describeWatchWindow(impossible, dates, today).kind).toBe('filtered')
  })

  it('la date limite de la fenetre est active, pas future', () => {
    const last = dates[dates.length - 1]!
    expect(describeWatchWindow(dateRule(last), dates, today).kind).toBe('active')
  })

  it('une fenetre glissante reste active', () => {
    expect(describeWatchWindow(rule({ relativeDays: [0, 31] }), dates, today).kind).toBe('active')
  })
})
