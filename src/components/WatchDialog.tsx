import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDateLabel, WEEKDAY_KEYS, weekdayLabel } from '../../shared/dates'
import type { PlaceIndex } from '../../shared/places'
import type { SearchQuery } from '../lib/query'
import {
  describeScope,
  draftFromQuery,
  exactDates,
  suggestedWeekday,
  watchesEditUrl,
  watchToYaml,
  weekdaysApply,
  type WatchScope,
} from '../lib/watch-yaml'

interface Props {
  query: SearchQuery
  index: PlaceIndex
  matchCount: number
  onClose: () => void
}

/**
 * Panneau de creation d alerte.
 *
 * Le site etant purement statique, il ne peut rien enregistrer : il produit donc
 * le bloc YAML a coller dans `watches.yml`, et le lien direct vers l editeur web
 * GitHub. C est le job planifie qui, ensuite, surveillera la regle.
 */
export function WatchDialog({ query, index, matchCount, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(() => draftFromQuery(query, index))
  const [copied, setCopied] = useState(false)

  const yaml = useMemo(() => watchToYaml(query, draft, index), [query, draft, index])
  const editUrl = watchesEditUrl()
  const dates = exactDates(query)
  const showWeekdays = weekdaysApply(query, draft.scope)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(yaml)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const setScope = (scope: WatchScope) => {
    setDraft((current) => {
      if (scope === current.scope) return current
      // En passant d une date unique a la surveillance continue, le jour de la
      // semaine correspondant est la traduction naturelle du souhait : « le
      // 30 aout » devient « tous les dimanches ». Suggere, jamais impose.
      const suggestion = suggestedWeekday(query)
      const weekdays =
        scope === 'window' && current.weekdays.length === 0 && suggestion
          ? [suggestion]
          : current.weekdays
      return { ...current, scope, weekdays }
    })
  }

  const toggleWeekday = (key: (typeof WEEKDAY_KEYS)[number]) => {
    setDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(key)
        ? current.weekdays.filter((k) => k !== key)
        : [...current.weekdays, key].sort(
            (a, b) => WEEKDAY_KEYS.indexOf(a) - WEEKDAY_KEYS.indexOf(b),
          ),
    }))
  }

  const scopeOptions: Array<{ key: WatchScope; label: string; hint: string }> = [
    {
      key: 'exact',
      label:
        dates.from === dates.to
          ? `Le ${formatDateLabel(dates.from)}`
          : `Du ${formatDateLabel(dates.from)} au ${formatDateLabel(dates.to)}`,
      hint:
        'Exactement les dates de votre recherche. L alerte s eteint d elle-meme une fois la periode passee.',
    },
    {
      key: 'window',
      label: 'En continu, sur 31 jours',
      hint: 'Surveillance permanente de la fenetre publiee par la SNCF, pour un trajet regulier.',
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Creer une alerte"
        tabIndex={-1}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl outline-none sm:rounded-2xl dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Creer une alerte</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Votre recherche trouve actuellement {matchCount} trajet
              {matchCount > 1 ? 's' : ''}.
              {matchCount === 0 && ' Une alerte a zero trajet est le cas normal : elle existe pour vous prevenir quand cela changera.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Nom de l alerte
            </span>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Ce nom sert de cle d etat : deux alertes ne peuvent pas le partager.
            </span>
          </label>

          <fieldset>
            <legend className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Dates a surveiller
            </legend>
            <div className="mt-1 space-y-1.5">
              {scopeOptions.map((option) => (
                <label
                  key={option.key}
                  className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 ${
                    draft.scope === option.key
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="watch-scope"
                    checked={draft.scope === option.key}
                    onChange={() => setScope(option.key)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium capitalize">{option.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {showWeekdays && (
            <fieldset>
              <legend className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                Restreindre a certains jours
              </legend>
              <div className="mt-1 flex flex-wrap gap-1">
                {WEEKDAY_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleWeekday(key)}
                    aria-pressed={draft.weekdays.includes(key)}
                    className={`rounded-lg border px-2.5 py-1 text-xs capitalize ${
                      draft.weekdays.includes(key)
                        ? 'border-indigo-500 bg-indigo-600 text-white'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {weekdayLabel(key).slice(0, 3)}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Aucun jour selectionne = tous les jours.
              </p>
            </fieldset>
          )}

          <label className="block">
            <span className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Priorite de la notification
            </span>
            <select
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value={1}>1 — discret</option>
              <option value={3}>3 — normal</option>
              <option value={4}>4 — elevee</option>
              <option value={5}>5 — urgente</option>
            </select>
          </label>

          <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
            <strong className="font-semibold">Cette alerte surveillera :</strong>{' '}
            {describeScope(query, draft)}
          </p>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">A coller sous « watches: » dans watches.yml</h3>
            <button
              type="button"
              onClick={copy}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {copied ? 'Copie ✓' : 'Copier'}
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
            <code>{yaml}</code>
          </pre>
        </div>

        {editUrl ? (
          <a
            href={editUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Ouvrir watches.yml sur GitHub
          </a>
        ) : (
          <p className="mt-3 rounded-lg bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Le depot n est pas connu de cette page. Definissez <code>VITE_REPO</code> au build pour
            afficher ici un lien direct vers l editeur GitHub.
          </p>
        )}
      </div>
    </div>
  )
}
