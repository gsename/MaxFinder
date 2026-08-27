import { formatDateLabel } from '../../shared/dates'
import { placeNameOf, stationLabel, type PlaceIndex } from '../../shared/places'
import { formatArrival, formatDuration, formatHm } from '../../shared/time'
import type { Itinerary } from '../../shared/types'
import { SNCF_CONNECT_URL } from '../lib/query'

interface Props {
  itineraries: Itinerary[]
  index: PlaceIndex
  /** Nombre total de trajets TGVmax publies ce jour-la, toutes liaisons confondues. */
  dayTotals: Record<string, number>
}

function ChangesBadge({ changes }: { changes: number }) {
  if (changes === 0) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
        direct
      </span>
    )
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
      {changes} changement{changes > 1 ? 's' : ''}
    </span>
  )
}

function ItineraryCard({ itinerary, index }: { itinerary: Itinerary; index: PlaceIndex }) {
  const first = itinerary.legs[0]!
  const last = itinerary.legs[itinerary.legs.length - 1]!

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-lg font-semibold tnum">
          {formatHm(itinerary.dep)}
          <span className="mx-1.5 text-slate-400">→</span>
          {formatArrival(itinerary.arr)}
        </p>
        <p className="text-sm text-slate-500 tnum dark:text-slate-400">
          {formatDuration(itinerary.duration)}
        </p>
        <ChangesBadge changes={itinerary.changes} />
        <a
          href={SNCF_CONNECT_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          Reserver
        </a>
      </div>

      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
        {placeNameOf(index, first.origin)} <span className="text-slate-400">→</span>{' '}
        {placeNameOf(index, last.dest)}
      </p>

      <ol className="mt-2 space-y-1">
        {itinerary.legs.map((leg, i) => {
          const previous = i > 0 ? itinerary.legs[i - 1]! : null
          // Une correspondance qui repart d une autre gare physique impose de
          // traverser la ville : c est l information la plus utile a afficher.
          const isTransfer = previous !== null && previous.dest !== leg.origin
          return (
            <li key={`${leg.trainNo}-${leg.dep}-${i}`}>
              {previous && (
                <p
                  className={`text-xs ${
                    isTransfer
                      ? 'font-medium text-amber-700 dark:text-amber-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {isTransfer
                    ? `Transfert dans ${placeNameOf(index, previous.dest)} : ${stationLabel(index, previous.dest)} vers ${stationLabel(index, leg.origin)}`
                    : `Correspondance a ${stationLabel(index, leg.origin)}`}
                  <span className="tnum"> — {formatDuration(leg.dep - previous.arr)}</span>
                </p>
              )}
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="tnum">
                  {formatHm(leg.dep)}–{formatArrival(leg.arr)}
                </span>
                <span className="text-slate-700 dark:text-slate-300">
                  {stationLabel(index, leg.origin)} → {stationLabel(index, leg.dest)}
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.7rem] dark:bg-slate-800">
                  n° {leg.trainNo}
                </span>
              </p>
            </li>
          )
        })}
      </ol>

      {itinerary.hasCityTransfer && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Ce trajet change de gare au sein d une meme ville. Le dataset SNCF ne publie que le code
          de la gare, pas son nom : verifiez de quelle gare part le second train avant de reserver.
        </p>
      )}
    </li>
  )
}

export function Results({ itineraries, index, dayTotals }: Props) {
  const byDate = new Map<string, Itinerary[]>()
  for (const itinerary of itineraries) {
    const bucket = byDate.get(itinerary.date)
    if (bucket) bucket.push(itinerary)
    else byDate.set(itinerary.date, [itinerary])
  }

  return (
    <div className="space-y-6">
      {[...byDate.entries()].map(([date, items]) => (
        <section key={date}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-1.5 dark:border-slate-800">
            <h3 className="font-semibold capitalize">{formatDateLabel(date)}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {items.length} trajet{items.length > 1 ? 's' : ''} sur cette liaison
              {dayTotals[date] !== undefined && (
                <> · {dayTotals[date]!.toLocaleString('fr-FR')} trajets TGVmax ce jour, tout reseau</>
              )}
            </p>
          </div>
          <ol className="mt-2 space-y-2">
            {items.map((itinerary) => (
              <ItineraryCard key={itinerary.key} itinerary={itinerary} index={index} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
