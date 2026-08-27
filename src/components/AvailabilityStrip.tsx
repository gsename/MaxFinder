import { formatDateLabel, weekdayOf } from '../../shared/dates'

interface Props {
  /** Nombre de trajets trouves pour la liaison, par date. */
  counts: Map<string, number>
  dates: string[]
  selectedDates: Set<string>
  onPickDate: (date: string) => void
}

/**
 * Bande de 31 jours montrant ou la liaison est ouverte.
 *
 * C est l information que le dataset SNCF rend difficile a lire : savoir non
 * pas « y a-t-il un train le 12 » mais « quels jours du mois sont ouverts ».
 */
export function AvailabilityStrip({ counts, dates, selectedDates, onPickDate }: Props) {
  const max = Math.max(1, ...counts.values())
  const openDays = dates.filter((date) => (counts.get(date) ?? 0) > 0).length

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Disponibilite sur les {dates.length} prochains jours</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {openDays} jour{openDays > 1 ? 's' : ''} avec au moins un trajet
        </p>
      </div>

      <ol className="mt-3 flex gap-1 overflow-x-auto pb-1">
        {dates.map((date) => {
          const count = counts.get(date) ?? 0
          const selected = selectedDates.has(date)
          const weekend = ['sat', 'sun'].includes(weekdayOf(date))
          // L intensite code la quantite ; une racine carree evite qu un pic
          // sur une date ecrase visuellement toutes les autres.
          const intensity = count === 0 ? 0 : Math.sqrt(count / max)
          return (
            <li key={date} className="shrink-0">
              <button
                type="button"
                onClick={() => onPickDate(date)}
                title={`${formatDateLabel(date)} : ${count} trajet${count > 1 ? 's' : ''}`}
                className={`flex w-11 flex-col items-center rounded-lg border px-1 py-1.5 text-center transition ${
                  selected
                    ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                    : 'border-slate-200 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500'
                }`}
              >
                <span
                  className={`text-[0.65rem] leading-none ${
                    weekend
                      ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {formatDateLabel(date).split(' ')[0]}
                </span>
                <span className="mt-0.5 text-sm font-semibold tnum">{date.slice(8)}</span>
                <span
                  aria-hidden="true"
                  className="mt-1 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800"
                >
                  <span
                    className="block h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.round(intensity * 100)}%` }}
                  />
                </span>
                <span
                  className={`mt-1 text-[0.65rem] leading-none tnum ${
                    count === 0 ? 'text-slate-300 dark:text-slate-600' : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {count === 0 ? '—' : count}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
