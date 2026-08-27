import { WEEKDAY_KEYS, weekdayOf, type WeekdayKey } from '../../shared/dates'
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

export interface WatchDraft {
  name: string
  weekdays: WeekdayKey[]
  useWindow: boolean
  priority: number
}

export function draftFromQuery(query: SearchQuery, index: PlaceIndex): WatchDraft {
  const fromName = query.from !== null ? index.places[query.from]!.name : ''
  const toName = query.to !== null ? index.places[query.to]!.name : ''
  // Une alerte sur une date unique s eteint des que la date sort de la fenetre
  // glissante ; on propose donc par defaut le jour de la semaine correspondant,
  // ce qui donne une surveillance durable.
  const weekdays: WeekdayKey[] =
    query.dateMode === 'single' ? [weekdayOf(query.dateFrom)] : []
  return {
    name: fromName && toName ? `${fromName} vers ${toName}` : 'Nouvelle alerte',
    weekdays,
    useWindow: query.dateMode !== 'range',
    priority: 4,
  }
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

  const hasWeekdays = draft.weekdays.length > 0 && draft.weekdays.length < WEEKDAY_KEYS.length
  if (draft.useWindow || hasWeekdays) {
    push(4, 'dates:')
    if (draft.useWindow) push(6, 'relative_days: [0, 31]')
    else {
      push(6, `from: ${quote(query.dateFrom)}`)
      push(6, `to: ${quote(query.dateTo)}`)
    }
    if (hasWeekdays) push(6, `weekdays: [${draft.weekdays.join(', ')}]`)
  } else {
    push(4, 'dates:')
    push(6, `from: ${quote(query.dateFrom)}`)
    push(6, `to: ${quote(query.dateMode === 'single' ? query.dateFrom : query.dateTo)}`)
  }

  if (query.departFrom !== 0 || query.departTo !== 1439) {
    push(4, `depart_between: [${quote(formatHm(query.departFrom))}, ${quote(formatHm(query.departTo))}]`)
  }
  if (query.maxDurationMinutes !== null) push(4, `max_duration_minutes: ${query.maxDurationMinutes}`)
  if (query.maxChanges !== 0) {
    push(4, `max_changes: ${query.maxChanges}`)
    push(4, `min_connection_minutes: ${query.minConnection}`)
    push(4, `city_transfer_connection_minutes: ${query.cityTransferConnection}`)
    push(4, `max_connection_wait_minutes: ${query.maxConnectionWait}`)
  }
  if (draft.priority !== 4) push(4, `priority: ${draft.priority}`)
  push(4, 'enabled: true')

  return lines.join('\n')
}
