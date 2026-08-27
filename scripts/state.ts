import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Itinerary } from '../shared/types'
import type { WatchRule } from '../shared/watch'

export const STATE_VERSION = 1

export interface WatchState {
  /** Cles d itineraires deja signalees, triees pour un diff git lisible. */
  keys: string[]
  last_notified?: string
  last_match_count: number
}

export interface SyncState {
  version: number
  dataset_modified?: string
  last_run?: string
  watches: Record<string, WatchState>
}

export function emptyState(): SyncState {
  return { version: STATE_VERSION, watches: {} }
}

export async function loadState(path: string): Promise<SyncState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as SyncState
    if (parsed.version !== STATE_VERSION) {
      console.warn(`  etat en version ${parsed.version}, attendu ${STATE_VERSION} : reinitialisation`)
      return emptyState()
    }
    return { ...emptyState(), ...parsed, watches: parsed.watches ?? {} }
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      console.warn(`  etat illisible (${String(error)}) : reinitialisation`)
    }
    return emptyState()
  }
}

export async function saveState(path: string, state: SyncState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export interface WatchDiff {
  rule: WatchRule
  /** Itineraires jamais signales jusqu ici. */
  fresh: Itinerary[]
  /** Nombre d itineraires correspondants au total. */
  total: number
  /** Cles disparues depuis le dernier run (place partie, ou date sortie de la fenetre). */
  goneCount: number
}

/**
 * Compare les correspondances d une regle a ce qui avait deja ete notifie.
 *
 * On ne diffe jamais les 61 000 lignes du dataset : l etat ne retient que les
 * cles par regle, soit quelques dizaines d entrees. Une cle disparue est
 * retiree de l etat, si bien qu une place qui se libere a nouveau plus tard
 * declenche bien une seconde alerte.
 */
export function diffWatch(
  rule: WatchRule,
  itineraries: Itinerary[],
  previous: WatchState | undefined,
  keepDatesFrom: string,
): { diff: WatchDiff; nextState: WatchState } {
  const currentKeys = new Set(itineraries.map((it) => it.key))
  const previousKeys = new Set(previous?.keys ?? [])

  const fresh = itineraries.filter((it) => !previousKeys.has(it.key))

  // Purge des cles perimees : sans cela le fichier d etat grossirait
  // indefiniment au fil de la fenetre glissante de 31 jours.
  let goneCount = 0
  for (const key of previousKeys) {
    if (currentKeys.has(key)) continue
    const date = key.slice(0, 10)
    if (date >= keepDatesFrom) goneCount++
  }

  const nextState: WatchState = {
    keys: [...currentKeys].sort(),
    last_match_count: itineraries.length,
    last_notified: fresh.length > 0 ? new Date().toISOString() : previous?.last_notified,
  }

  return { diff: { rule, fresh, total: itineraries.length, goneCount }, nextState }
}
