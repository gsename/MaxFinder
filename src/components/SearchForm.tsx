import { useState } from 'react'
import { formatHm, parseHm } from '../../shared/time'
import type { PlaceIndex } from '../../shared/places'
import type { DataIndex } from '../../shared/types'
import type { DateMode, SearchQuery } from '../lib/query'
import { PlaceCombobox } from './PlaceCombobox'

interface Props {
  query: SearchQuery
  onChange: (next: SearchQuery) => void
  index: PlaceIndex
  dataIndex: DataIndex
}

const DATE_MODES: Array<{ key: DateMode; label: string }> = [
  { key: 'window', label: 'Tous les jours' },
  { key: 'single', label: 'Une date' },
  { key: 'range', label: 'Une periode' },
]

function TimeField({
  label,
  minutes,
  onChange,
}: {
  label: string
  minutes: number
  onChange: (minutes: number) => void
}) {
  return (
    <label className="flex-1">
      <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </span>
      <input
        type="time"
        value={formatHm(minutes)}
        onChange={(event) => {
          try {
            onChange(parseHm(event.target.value))
          } catch {
            // Un champ time vide remonte une chaine vide : on ignore.
          }
        }}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tnum shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  )
}

export function SearchForm({ query, onChange, index, dataIndex }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const set = (patch: Partial<SearchQuery>) => onChange({ ...query, ...patch })

  const firstDate = dataIndex.dates[0]!
  const lastDate = dataIndex.dates[dataIndex.dates.length - 1]!
  const clampDate = (value: string) =>
    value < firstDate ? firstDate : value > lastDate ? lastDate : value

  const swap = () => set({ from: query.to, to: query.from })

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <PlaceCombobox
          label="Depart"
          value={query.from}
          onChange={(id) => set({ from: id })}
          index={index}
          placeholder="Paris, Lyon, Bordeaux..."
        />
        <button
          type="button"
          onClick={swap}
          title="Inverser depart et arrivee"
          aria-label="Inverser depart et arrivee"
          className="mb-1 justify-self-center rounded-lg border border-slate-300 px-2.5 py-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <span aria-hidden="true">⇄</span>
        </button>
        <PlaceCombobox
          label="Arrivee"
          value={query.to}
          onChange={(id) => set({ to: id })}
          index={index}
          placeholder="Marseille, Rennes, Lille..."
        />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Quand
          </span>
          <div className="mt-1 inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
            {DATE_MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => set({ dateMode: mode.key })}
                aria-pressed={query.dateMode === mode.key}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  query.dateMode === mode.key
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {query.dateMode !== 'window' && (
          <label>
            <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              {query.dateMode === 'single' ? 'Date' : 'Du'}
            </span>
            <input
              type="date"
              min={firstDate}
              max={lastDate}
              value={query.dateFrom}
              onChange={(event) => {
                const next = clampDate(event.target.value || firstDate)
                set({ dateFrom: next, dateTo: query.dateTo < next ? next : query.dateTo })
              }}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tnum shadow-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
        )}
        {query.dateMode === 'range' && (
          <label>
            <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Au
            </span>
            <input
              type="date"
              min={query.dateFrom}
              max={lastDate}
              value={query.dateTo}
              onChange={(event) => set({ dateTo: clampDate(event.target.value || lastDate) })}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tnum shadow-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
        )}

        <div className="flex min-w-[15rem] flex-1 gap-3">
          <TimeField
            label="Depart apres"
            minutes={query.departFrom}
            onChange={(minutes) => set({ departFrom: minutes })}
          />
          <TimeField
            label="Depart avant"
            minutes={query.departTo}
            onChange={(minutes) => set({ departTo: minutes })}
          />
        </div>

        <label>
          <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Correspondances
          </span>
          <select
            value={query.maxChanges}
            onChange={(event) => set({ maxChanges: Number(event.target.value) as 0 | 1 | 2 })}
            className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value={0}>Directs uniquement</option>
            <option value={1}>Jusqu a 1 changement</option>
            <option value={2}>Jusqu a 2 changements</option>
          </select>
        </label>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? 'Masquer les reglages fins' : 'Reglages fins'}
        </button>
      </div>

      {advancedOpen && (
        <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4 dark:bg-slate-950/50">
          <label className="text-xs">
            <span className="block font-medium text-slate-500 dark:text-slate-400">
              Correspondance min. (min)
            </span>
            <input
              type="number"
              min={0}
              max={600}
              value={query.minConnection}
              onChange={(event) => set({ minConnection: Number(event.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tnum dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-500 dark:text-slate-400">
              Transfert intra-ville (min)
            </span>
            <input
              type="number"
              min={0}
              max={600}
              value={query.cityTransferConnection}
              onChange={(event) => set({ cityTransferConnection: Number(event.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tnum dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-500 dark:text-slate-400">
              Attente max. (min)
            </span>
            <input
              type="number"
              min={10}
              max={1440}
              value={query.maxConnectionWait}
              onChange={(event) => set({ maxConnectionWait: Number(event.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tnum dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-slate-500 dark:text-slate-400">
              Duree totale max. (min)
            </span>
            <input
              type="number"
              min={10}
              max={2000}
              placeholder="sans limite"
              value={query.maxDurationMinutes ?? ''}
              onChange={(event) =>
                set({
                  maxDurationMinutes: event.target.value === '' ? null : Number(event.target.value),
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tnum dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <p className="text-xs leading-relaxed text-slate-500 sm:col-span-2 lg:col-span-4 dark:text-slate-400">
            Le transfert intra-ville s applique aux gares notees « (intramuros) » : elles
            regroupent plusieurs gares physiques, une correspondance y implique donc de traverser
            la ville.
          </p>
        </div>
      )}
    </section>
  )
}
