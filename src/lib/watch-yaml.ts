import { formatDateLabel, WEEKDAY_KEYS, weekdayOf, type WeekdayKey } from '../../shared/dates'
import { DEFAULT_SEARCH_OPTIONS } from '../../shared/search'
import { formatHm } from '../../shared/time'
import type { PlaceIndex } from '../../shared/places'
import type { SearchQuery } from './query'

const REPO = (import.meta.env.VITE_REPO as string | undefined)?.trim() || ''

/** Lien vers l editeur web GitHub de watches.yml, ou null si le depot est inconnu. */
export function watchesEditUrl(): string | null {
  if (!REPO) return null
  const branch = (import.meta.env.VITE_BRANCH as string | undefined)?.trim() || 'main'
  return `https://github.com/${REPO}/edit/${branch}/watches.yml`
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

/**
 * Portee temporelle de l alerte.
 *
 * `exact`  : les dates effectivement cherchees, telles quelles.
 * `window` : surveillance continue de la fenetre glissante de 31 jours.
 */
export type WatchScope = 'exact' | 'window'

export interface WatchDraft {
  name: string
  scope: WatchScope
  /** N a de sens que pour une portee `window` ou une plage de dates. */
  weekdays: WeekdayKey[]
  priority: number
}

/** Dates que couvrira une alerte de portee `exact`. */
export function exactDates(query: SearchQuery): { from: string; to: string } {
  return {
    from: query.dateFrom,
    // Une date unique se traduit par des bornes identiques. Prendre `dateTo`
    // ici donnerait la fin de la fenetre, soit un mois entier au lieu du jour
    // demande.
    to: query.dateMode === 'single' ? query.dateFrom : query.dateTo,
  }
}

/** Les cases « jours de la semaine » n ont aucun sens sur une date unique. */
export function weekdaysApply(query: SearchQuery, scope: WatchScope): boolean {
  return scope === 'window' || query.dateMode === 'range'
}

export function draftFromQuery(query: SearchQuery, index: PlaceIndex): WatchDraft {
  const fromName = query.from !== null ? index.places[query.from]!.name : ''
  const toName = query.to !== null ? index.places[query.to]!.name : ''
  return {
    name: fromName && toName ? `${fromName} vers ${toName}` : 'Nouvelle alerte',
    // L alerte reprend par defaut exactement ce qui a ete cherche : demander le
    // 30 aout doit produire une alerte sur le 30 aout, et non sur tous les
    // dimanches du mois.
    scope: query.dateMode === 'window' ? 'window' : 'exact',
    weekdays: [],
    priority: 4,
  }
}

/**
 * Jour de semaine de la date cherchee, a proposer si l utilisateur bascule en
 * surveillance continue : « le 30 aout » devient alors « tous les dimanches ».
 */
export function suggestedWeekday(query: SearchQuery): WeekdayKey | null {
  return query.dateMode === 'single' ? weekdayOf(query.dateFrom) : null
}

function weekdaysLabel(weekdays: WeekdayKey[]): string {
  return weekdays.map((k) => `${k}.`).join(' ')
}

/** Resume en clair des dates couvertes, pour lever toute ambiguite. */
export function describeScope(query: SearchQuery, draft: WatchDraft): string {
  const restricted =
    weekdaysApply(query, draft.scope) &&
    draft.weekdays.length > 0 &&
    draft.weekdays.length < WEEKDAY_KEYS.length

  if (draft.scope === 'window') {
    return restricted
      ? `En continu, les ${weekdaysLabel(draft.weekdays)} des 31 prochains jours.`
      : 'En continu, tous les jours des 31 prochains jours.'
  }

  const { from, to } = exactDates(query)
  if (from === to) return `Uniquement le ${formatDateLabel(from)}.`
  return restricted
    ? `Du ${formatDateLabel(from)} au ${formatDateLabel(to)}, uniquement ${weekdaysLabel(draft.weekdays)}`
    : `Du ${formatDateLabel(from)} au ${formatDateLabel(to)}.`
}

/** Genere le bloc YAML a coller dans la liste `watches:` de watches.yml. */
export function watchToYaml(query: SearchQuery, draft: WatchDraft, index: PlaceIndex): string {
  const lines: string[] = []
  const push = (indent: number, text: string) => lines.push(`${' '.repeat(indent)}${text}`)

  const fromName = query.from !== null ? index.places[query.from]!.name : ''
  const toName = query.to !== null ? index.places[query.to]!.name : ''

  push(2, `- name: ${quote(draft.name)}`)
  push(4, `from: [${quote(fromName)}]`)
  push(4, `to: [${quote(toName)}]`)

  const useWeekdays =
    weekdaysApply(query, draft.scope) &&
    draft.weekdays.length > 0 &&
    draft.weekdays.length < WEEKDAY_KEYS.length

  push(4, 'dates:')
  if (draft.scope === 'window') {
    push(6, 'relative_days: [0, 31]')
  } else {
    const { from, to } = exactDates(query)
    push(6, `from: ${quote(from)}`)
    push(6, `to: ${quote(to)}`)
  }
  if (useWeekdays) push(6, `weekdays: [${draft.weekdays.join(', ')}]`)

  if (query.departFrom !== 0 || query.departTo !== 1439) {
    push(
      4,
      `depart_between: [${quote(formatHm(query.departFrom))}, ${quote(formatHm(query.departTo))}]`,
    )
  }
  if (query.maxDurationMinutes !== null) push(4, `max_duration_minutes: ${query.maxDurationMinutes}`)

  if (query.maxChanges !== 0) {
    push(4, `max_changes: ${query.maxChanges}`)
    // Les temps de correspondance ne sont emis que s ils s ecartent des valeurs
    // du bloc `defaults` : les recopier a l identique alourdit le fichier sans
    // rien changer au comportement.
    if (query.minConnection !== DEFAULT_SEARCH_OPTIONS.minConnection) {
      push(4, `min_connection_minutes: ${query.minConnection}`)
    }
    if (query.cityTransferConnection !== DEFAULT_SEARCH_OPTIONS.cityTransferConnection) {
      push(4, `city_transfer_connection_minutes: ${query.cityTransferConnection}`)
    }
    if (query.maxConnectionWait !== DEFAULT_SEARCH_OPTIONS.maxConnectionWait) {
      push(4, `max_connection_wait_minutes: ${query.maxConnectionWait}`)
    }
  }
  if (draft.priority !== 4) push(4, `priority: ${draft.priority}`)
  push(4, 'enabled: true')

  return lines.join('\n')
}
