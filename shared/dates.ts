export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: 'lundi',
  tue: 'mardi',
  wed: 'mercredi',
  thu: 'jeudi',
  fri: 'vendredi',
  sat: 'samedi',
  sun: 'dimanche',
}

/**
 * Jour de la semaine d'une date `YYYY-MM-DD`, calcule en UTC.
 *
 * Volontairement sans conversion de fuseau : les dates du dataset sont des
 * dates civiles francaises, pas des instants. Les passer par un Date local
 * decalerait d'un jour selon la machine qui execute le code.
 */
export function weekdayOf(isoDate: string): WeekdayKey {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Date invalide: "${isoDate}" (format attendu YYYY-MM-DD)`)
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = dimanche
  return WEEKDAY_KEYS[(jsDay + 6) % 7]!
}

export function weekdayLabel(key: WeekdayKey): string {
  return WEEKDAY_LABELS[key]
}

/** Ajoute `days` jours a une date civile `YYYY-MM-DD`. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Date invalide: "${isoDate}"`)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** Date du jour en heure de Paris, au format `YYYY-MM-DD`. */
export function todayInParis(now: Date = new Date()): string {
  // en-CA donne directement YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now)
}

/** Etiquette courte et lisible, ex. "jeu. 3 sept.". */
export function formatDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** Nombre de jours civils de `from` a `to` (negatif si `to` precede `from`). */
export function daysBetween(from: string, to: string): number {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) throw new Error(`Date invalide: "${iso}"`)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((parse(to) - parse(from)) / 86_400_000)
}
