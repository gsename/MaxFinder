export const MINUTES_PER_DAY = 1440

/** "06:36" -> 396. Leve une erreur sur une entree malformee. */
export function parseHm(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) throw new Error(`Heure invalide: "${value}" (format attendu HH:MM)`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) throw new Error(`Heure hors bornes: "${value}"`)
  return h * 60 + min
}

/** 396 -> "06:36". Les minutes au-dela de 1440 sont ramenees dans la journee. */
export function formatHm(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Nombre de jours de decalage porte par une valeur de minutes (0 ou 1 en pratique). */
export function dayOffset(minutes: number): number {
  return Math.floor(minutes / MINUTES_PER_DAY)
}

/**
 * Le dataset SNCF publie des heures locales brutes : un train parti a 23:50 et
 * arrive a 01:25 a une heure d'arrivee *inferieure* a son heure de depart.
 * On ajoute alors une journee pour que les durees et les tris restent corrects.
 */
export function normalizeArrival(dep: number, arr: number): number {
  return arr < dep ? arr + MINUTES_PER_DAY : arr
}

/** 136 -> "2 h 16", 45 -> "45 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

/** Etiquette d'arrivee, suffixee "+1" quand le train arrive le lendemain. */
export function formatArrival(minutes: number): string {
  const off = dayOffset(minutes)
  return off > 0 ? `${formatHm(minutes)} +${off}` : formatHm(minutes)
}
