import { useEffect, useMemo, useState } from 'react'
import type { PlaceIndex } from '../shared/places'
import { buildDayGraph, findItineraries, type SearchOptions } from '../shared/search'
import type { Itinerary, Trip } from '../shared/types'
import { loadCore, loadTrips, type CoreData } from './lib/data'
import {
  datesForQuery,
  stationsOfPlace,
  defaultQuery,
  queryToSearchParams,
  searchParamsToQuery,
  type SearchQuery,
} from './lib/query'
import { AvailabilityStrip } from './components/AvailabilityStrip'
import { Results } from './components/Results'
import { SearchForm } from './components/SearchForm'
import { WatchDialog } from './components/WatchDialog'

/** Plafond d affichage : au-dela, la liste cesse d etre lisible. */
const MAX_SHOWN = 300

function searchOptionsFor(
  query: SearchQuery,
  index: PlaceIndex,
  escalateOnlyIfEmpty: boolean,
): SearchOptions {
  return {
    // Une ville se traduit en toutes ses gares physiques : chercher au depart de
    // Paris doit couvrir Montparnasse, Gare de Lyon, Nord, Est, Austerlitz, Bercy.
    from: stationsOfPlace(index, query.from),
    to: stationsOfPlace(index, query.to),
    departFrom: query.departFrom,
    departTo: query.departTo,
    maxDurationMinutes: query.maxDurationMinutes ?? undefined,
    maxChanges: query.maxChanges,
    minConnection: query.minConnection,
    cityTransferConnection: query.cityTransferConnection,
    maxConnectionWait: query.maxConnectionWait,
    escalateOnlyIfEmpty,
    maxResultsPerLevel: 200,
  }
}

export default function App() {
  const [core, setCore] = useState<CoreData | null>(null)
  const [trips, setTrips] = useState<Map<string, Trip[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState<SearchQuery | null>(null)
  const [watchOpen, setWatchOpen] = useState(false)

  // 1. Referentiel (~5 Ko), puis 2. horaires (~410 Ko) en tache de fond : le
  // formulaire est utilisable avant la fin du second chargement.
  useEffect(() => {
    loadCore()
      .then((loaded) => {
        setCore(loaded)
        const fallback = defaultQuery(loaded.index.dates[0]!, loaded.index.dates.at(-1)!)
        setQuery(
          searchParamsToQuery(new URLSearchParams(window.location.search), loaded.placeIndex, fallback),
        )
        return loadTrips(loaded.index.dataset_modified)
      })
      .then((loadedTrips) => setTrips(loadedTrips))
      .catch((cause: unknown) => setError(String(cause instanceof Error ? cause.message : cause)))
  }, [])

  // La query string reflete la recherche : le lien reste partageable.
  useEffect(() => {
    if (!core || !query) return
    const params = queryToSearchParams(query, core.placeIndex)
    const search = params.toString()
    const next = `${window.location.pathname}${search ? `?${search}` : ''}`
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next)
    }
  }, [core, query])

  const selectedDates = useMemo(
    () => new Set(core && query ? datesForQuery(query, core.index.dates) : []),
    [core, query],
  )

  const itineraries = useMemo<Itinerary[]>(() => {
    if (!core || !query || !trips || query.from === null || query.to === null) return []
    const opts = searchOptionsFor(query, core.placeIndex, true)
    const found: Itinerary[] = []
    for (const date of core.index.dates) {
      if (!selectedDates.has(date)) continue
      const dayTrips = trips.get(date)
      if (!dayTrips) continue
      found.push(...findItineraries(buildDayGraph(date, dayTrips), opts, core.placeIndex))
    }
    return found
  }, [core, query, trips, selectedDates])

  /** Comptage sur toute la fenetre, independamment des dates selectionnees. */
  const availabilityCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (!core || !query || !trips || query.from === null || query.to === null) return counts
    const opts = searchOptionsFor(query, core.placeIndex, true)
    for (const date of core.index.dates) {
      const dayTrips = trips.get(date)
      if (!dayTrips) continue
      counts.set(date, findItineraries(buildDayGraph(date, dayTrips), opts, core.placeIndex).length)
    }
    return counts
  }, [core, query, trips])

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold">Donnees indisponibles</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{error}</p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          En local, generez les fichiers avec <code>npm run sync:local</code> avant{' '}
          <code>npm run dev</code>.
        </p>
      </main>
    )
  }

  if (!core || !query) {
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-slate-500">Chargement du referentiel...</main>
    )
  }

  const readyToSearch = query.from !== null && query.to !== null
  const shown = itineraries.slice(0, MAX_SHOWN)

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">MaxFinder</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Les trains TGV INOUI et INTERCITES ouverts aux pass MAX JEUNE et MAX SENIOR, sur les{' '}
          {core.index.dates.length} prochains jours. Correspondances incluses.
        </p>
      </header>

      <div className="space-y-5">
        <SearchForm query={query} onChange={setQuery} index={core.placeIndex} dataIndex={core.index} />

        {!readyToSearch && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Choisissez une gare de depart et une gare d arrivee.
          </p>
        )}

        {readyToSearch && !trips && (
          <p className="rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Chargement des horaires des {core.index.dates.length} jours...
          </p>
        )}

        {readyToSearch && trips && (
          <>
            <AvailabilityStrip
              counts={availabilityCounts}
              dates={core.index.dates}
              selectedDates={selectedDates}
              onPickDate={(date) => setQuery({ ...query, dateMode: 'single', dateFrom: date })}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                <strong className="tnum">{itineraries.length}</strong> trajet
                {itineraries.length > 1 ? 's' : ''} sur{' '}
                <strong className="tnum">{selectedDates.size}</strong> date
                {selectedDates.size > 1 ? 's' : ''}
                {itineraries.length > MAX_SHOWN && ` — ${MAX_SHOWN} premiers affiches`}
              </p>
              <button
                type="button"
                onClick={() => setWatchOpen(true)}
                className="rounded-lg border border-indigo-600 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              >
                M alerter quand un train se libere
              </button>
            </div>

            {itineraries.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Aucun trajet sur cette liaison avec ces criteres.
                {query.maxChanges === 0 && ' Essayez d autoriser une correspondance.'}
              </p>
            ) : (
              <Results
                itineraries={shown}
                index={core.placeIndex}
                dayTotals={core.index.total_counts}
              />
            )}
          </>
        )}
      </div>

      <footer className="mt-10 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <p>
          Donnees{' '}
          <a
            className="underline"
            href="https://ressources.data.sncf.com/explore/dataset/tgvmax/"
            target="_blank"
            rel="noreferrer noopener"
          >
            SNCF Voyageurs, dataset tgvmax
          </a>{' '}
          (licence ODbL), publiees une fois par matin. Instantane du{' '}
          {new Date(core.index.dataset_modified).toLocaleString('fr-FR')}, {core.index.station_count}{' '}
          gares.
        </p>
        <p className="mt-1">
          Une place affichee ici peut avoir ete prise depuis la derniere publication : la
          reservation seule fait foi. Ce site n est ni edite ni approuve par la SNCF.
        </p>
      </footer>

      {watchOpen && (
        <WatchDialog
          query={query}
          index={core.placeIndex}
          matchCount={itineraries.length}
          onClose={() => setWatchOpen(false)}
        />
      )}
    </div>
  )
}
