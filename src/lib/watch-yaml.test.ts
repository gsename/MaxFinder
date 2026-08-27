import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { loadWatches } from '../../scripts/watches'
import { buildPlaceIndex, normalizeStationName } from '../../shared/places'
import type { Station } from '../../shared/types'
import { defaultQuery, type SearchQuery } from './query'
import { draftFromQuery, exactDates, watchToYaml, type WatchDraft } from './watch-yaml'

const NAMES = ['PARIS (intramuros)', 'TOULOUSE MATABIAU']
const stations: Station[] = NAMES.map((name, i) => ({
  name,
  iata: `FR${String(i).padStart(3, '0')}`,
  norm: normalizeStationName(name),
}))
const index = buildPlaceIndex(stations)
const PARIS = index.byNorm.get(normalizeStationName('PARIS (intramuros)'))!
const TOULOUSE = index.byNorm.get(normalizeStationName('TOULOUSE MATABIAU'))!

/** Fenetre publiee : 2026-08-27 au 2026-09-26, comme le dataset reel. */
function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    ...defaultQuery('2026-08-27', '2026-09-26'),
    from: TOULOUSE,
    to: PARIS,
    ...overrides,
  }
}

/** Relit le YAML genere, pour verifier ce que le job d alertes lira vraiment. */
function parseRule(yaml: string): Record<string, unknown> {
  const parsed = parseYaml(`watches:\n${yaml}`) as { watches: Array<Record<string, unknown>> }
  expect(parsed.watches).toHaveLength(1)
  return parsed.watches[0]!
}

function draft(q: SearchQuery, overrides: Partial<WatchDraft> = {}): WatchDraft {
  return { ...draftFromQuery(q, index), ...overrides }
}

describe('exactDates', () => {
  it('une date unique donne deux bornes identiques', () => {
    // Regression : la borne haute prenait `dateTo`, reste a la fin de la
    // fenetre, ce qui transformait « le 30 aout » en un mois entier.
    const q = query({ dateMode: 'single', dateFrom: '2026-08-30' })
    expect(exactDates(q)).toEqual({ from: '2026-08-30', to: '2026-08-30' })
  })

  it('une plage conserve ses deux bornes', () => {
    const q = query({ dateMode: 'range', dateFrom: '2026-09-10', dateTo: '2026-09-14' })
    expect(exactDates(q)).toEqual({ from: '2026-09-10', to: '2026-09-14' })
  })
})

describe('draftFromQuery', () => {
  it('une date choisie reste une date, et non un jour de semaine', () => {
    // Regression : le brouillon convertissait la date en weekday, produisant
    // une alerte « tous les dimanches » a la place du jour demande.
    const d = draftFromQuery(query({ dateMode: 'single', dateFrom: '2026-08-30' }), index)
    expect(d.scope).toBe('exact')
    expect(d.weekdays).toEqual([])
  })

  it('une plage reste une plage', () => {
    expect(draftFromQuery(query({ dateMode: 'range' }), index).scope).toBe('exact')
  })

  it('une recherche sur toute la fenetre propose la surveillance continue', () => {
    expect(draftFromQuery(query({ dateMode: 'window' }), index).scope).toBe('window')
  })

  it('nomme l alerte d apres les deux villes', () => {
    expect(draftFromQuery(query(), index).name).toBe('TOULOUSE MATABIAU vers PARIS (intramuros)')
  })
})

describe('watchToYaml', () => {
  it('fige une date unique sur cette seule date', () => {
    const q = query({ dateMode: 'single', dateFrom: '2026-08-30' })
    const rule = parseRule(watchToYaml(q, draft(q), index))
    expect(rule.dates).toEqual({ from: '2026-08-30', to: '2026-08-30' })
    expect(rule.dates).not.toHaveProperty('relative_days')
    expect(rule.dates).not.toHaveProperty('weekdays')
    expect(rule.enabled).toBe(true)
    expect(rule.from).toEqual(['TOULOUSE MATABIAU'])
    expect(rule.to).toEqual(['PARIS (intramuros)'])
  })

  it('respecte une plage de dates', () => {
    const q = query({ dateMode: 'range', dateFrom: '2026-09-10', dateTo: '2026-09-14' })
    expect(parseRule(watchToYaml(q, draft(q), index)).dates).toEqual({
      from: '2026-09-10',
      to: '2026-09-14',
    })
  })

  it('emet une fenetre glissante en portee continue', () => {
    const q = query({ dateMode: 'window' })
    expect(parseRule(watchToYaml(q, draft(q), index)).dates).toEqual({ relative_days: [0, 31] })
  })

  it('ignore les jours de semaine sur une date unique, ou ils n ont pas de sens', () => {
    const q = query({ dateMode: 'single', dateFrom: '2026-08-30' })
    const rule = parseRule(watchToYaml(q, draft(q, { weekdays: ['mon'] }), index))
    expect(rule.dates).toEqual({ from: '2026-08-30', to: '2026-08-30' })
  })

  it('applique les jours de semaine a une fenetre continue', () => {
    const q = query({ dateMode: 'window' })
    expect(parseRule(watchToYaml(q, draft(q, { weekdays: ['fri', 'sat'] }), index)).dates).toEqual({
      relative_days: [0, 31],
      weekdays: ['fri', 'sat'],
    })
  })

  it('applique les jours de semaine a une plage de dates', () => {
    const q = query({ dateMode: 'range', dateFrom: '2026-09-01', dateTo: '2026-09-30' })
    expect(parseRule(watchToYaml(q, draft(q, { weekdays: ['sun'] }), index)).dates).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      weekdays: ['sun'],
    })
  })

  it('omet les sept jours coches, equivalents a aucune restriction', () => {
    const q = query({ dateMode: 'window' })
    const all = draft(q, { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] })
    expect(parseRule(watchToYaml(q, all, index)).dates).not.toHaveProperty('weekdays')
  })

  it('reporte la plage horaire et la duree maximale', () => {
    const q = query({ departFrom: 960, departTo: 1290, maxDurationMinutes: 400 })
    const rule = parseRule(watchToYaml(q, draft(q), index))
    expect(rule.depart_between).toEqual(['16:00', '21:30'])
    expect(rule.max_duration_minutes).toBe(400)
  })

  it('omet une plage horaire couvrant la journee entiere', () => {
    const rule = parseRule(watchToYaml(query(), draft(query()), index))
    expect(rule).not.toHaveProperty('depart_between')
  })

  it('n emet les temps de correspondance que s ils s ecartent des defauts', () => {
    const q = query({ maxChanges: 2 })
    const rule = parseRule(watchToYaml(q, draft(q), index))
    expect(rule.max_changes).toBe(2)
    expect(rule).not.toHaveProperty('min_connection_minutes')

    const custom = query({ maxChanges: 2, minConnection: 45 })
    const tuned = parseRule(watchToYaml(custom, draft(custom), index))
    expect(tuned.min_connection_minutes).toBe(45)
  })

  it('omet max_changes pour une recherche en directs seuls', () => {
    const rule = parseRule(watchToYaml(query(), draft(query()), index))
    expect(rule).not.toHaveProperty('max_changes')
  })

  it('echappe les guillemets d un nom de gare ou d alerte', () => {
    const q = query()
    const rule = parseRule(watchToYaml(q, draft(q, { name: 'Trajet "special"' }), index))
    expect(rule.name).toBe('Trajet "special"')
  })

  it('produit un bloc indente pour la liste watches:', () => {
    const yaml = watchToYaml(query(), draft(query()), index)
    expect(yaml.split('\n')[0]).toMatch(/^ {2}- name:/)
    expect(yaml.split('\n')[1]).toMatch(/^ {4}from:/)
  })
})

describe('le bloc genere est accepte par le job d alertes', () => {
  /**
   * Boucle complete : ce que le dialogue produit passe par le validateur zod du
   * job planifie. Sans ce test, l interface pourrait generer un bloc que la
   * synchronisation refuse — et l utilisateur ne le decouvrirait qu apres avoir
   * pousse sur GitHub.
   */
  async function loadGenerated(q: SearchQuery, overrides: Partial<WatchDraft> = {}) {
    const yaml = watchToYaml(q, draft(q, overrides), index)
    const dir = await mkdtemp(join(tmpdir(), 'maxfinder-yaml-'))
    const path = join(dir, 'watches.yml')
    await writeFile(path, `watches:
${yaml}
`, 'utf8')
    const rules = await loadWatches(path)
    expect(rules).toHaveLength(1)
    return rules[0]!
  }

  it('une alerte sur une date unique arrive intacte', async () => {
    const q = query({ dateMode: 'single', dateFrom: '2026-08-30' })
    const rule = await loadGenerated(q)
    expect(rule.dateFrom).toBe('2026-08-30')
    expect(rule.dateTo).toBe('2026-08-30')
    expect(rule.relativeDays).toBeUndefined()
    expect(rule.weekdays).toBeUndefined()
    expect(rule.enabled).toBe(true)
  })

  it('une plage avec jours de semaine arrive intacte', async () => {
    const q = query({ dateMode: 'range', dateFrom: '2026-09-01', dateTo: '2026-09-30' })
    const rule = await loadGenerated(q, { weekdays: ['sun'] })
    expect(rule.dateFrom).toBe('2026-09-01')
    expect(rule.dateTo).toBe('2026-09-30')
    expect(rule.weekdays).toEqual(['sun'])
  })

  it('une surveillance continue arrive intacte', async () => {
    const q = query({ dateMode: 'window', maxChanges: 2, departFrom: 960, departTo: 1290 })
    const rule = await loadGenerated(q, { priority: 5 })
    expect(rule.relativeDays).toEqual([0, 31])
    expect(rule.maxChanges).toBe(2)
    expect(rule.departBetween).toEqual([960, 1290])
    expect(rule.priority).toBe(5)
  })
})
