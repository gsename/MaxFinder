import { describe, expect, it } from 'vitest'
import { defaultWatchRule } from '../shared/watch'
import type { Itinerary } from '../shared/types'
import { diffWatch, type WatchState } from './state'

const rule = defaultWatchRule()

function itinerary(date: string, trainNo: string): Itinerary {
  return {
    date,
    legs: [{ trainNo, origin: 0, dest: 1, dep: 480, arr: 660 }],
    dep: 480,
    arr: 660,
    duration: 180,
    changes: 0,
    key: `${date}|${trainNo}:FR000>FR001@480`,
    hasCityTransfer: false,
  }
}

const state = (keys: string[]): WatchState => ({ keys, last_match_count: keys.length })

describe('diffWatch', () => {
  it('sans etat prealable, tout est nouveau', () => {
    const { diff } = diffWatch(rule, [itinerary('2026-09-03', 'A')], undefined, '2026-09-01')
    expect(diff.fresh).toHaveLength(1)
    expect(diff.total).toBe(1)
  })

  it('ne re-signale pas un trajet deja notifie', () => {
    const items = [itinerary('2026-09-03', 'A')]
    const { diff } = diffWatch(rule, items, state([items[0]!.key]), '2026-09-01')
    expect(diff.fresh).toHaveLength(0)
    expect(diff.total).toBe(1)
  })

  it('isole la nouveaute au milieu de trajets connus', () => {
    const known = itinerary('2026-09-03', 'A')
    const fresh = itinerary('2026-09-03', 'B')
    const { diff } = diffWatch(rule, [known, fresh], state([known.key]), '2026-09-01')
    expect(diff.fresh.map((i) => i.legs[0]!.trainNo)).toEqual(['B'])
  })

  it('compte les places disparues et les retire de l etat', () => {
    const gone = itinerary('2026-09-03', 'A')
    const { diff, nextState } = diffWatch(rule, [], state([gone.key]), '2026-09-01')
    expect(diff.goneCount).toBe(1)
    expect(nextState.keys).toEqual([])
  })

  it('re-signale une place qui se libere a nouveau apres avoir disparu', () => {
    const item = itinerary('2026-09-03', 'A')
    const afterDisappearance = diffWatch(rule, [], state([item.key]), '2026-09-01').nextState
    const { diff } = diffWatch(rule, [item], afterDisappearance, '2026-09-01')
    expect(diff.fresh).toHaveLength(1)
  })

  it('purge les cles sorties de la fenetre glissante sans les compter comme perdues', () => {
    // Sinon le fichier d etat grossirait indefiniment et chaque run signalerait
    // a tort la disparition de dates simplement depubliees.
    const expired = itinerary('2026-08-01', 'A')
    const { diff, nextState } = diffWatch(rule, [], state([expired.key]), '2026-09-01')
    expect(diff.goneCount).toBe(0)
    expect(nextState.keys).toEqual([])
  })

  it('horodate uniquement quand une notification part', () => {
    const item = itinerary('2026-09-03', 'A')
    expect(diffWatch(rule, [item], undefined, '2026-09-01').nextState.last_notified).toBeDefined()

    const previous: WatchState = { keys: [item.key], last_match_count: 1, last_notified: 'hier' }
    expect(diffWatch(rule, [item], previous, '2026-09-01').nextState.last_notified).toBe('hier')
  })

  it('trie les cles pour que le diff git reste lisible', () => {
    const a = itinerary('2026-09-03', 'A')
    const b = itinerary('2026-09-03', 'B')
    const { nextState } = diffWatch(rule, [b, a], undefined, '2026-09-01')
    expect(nextState.keys).toEqual([a.key, b.key])
  })
})
