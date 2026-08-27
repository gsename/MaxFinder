import { useEffect, useMemo, useRef, useState } from 'react'
import { WEEKDAY_KEYS, weekdayLabel } from '../../shared/dates'
import type { PlaceIndex } from '../../shared/places'
import type { SearchQuery } from '../lib/query'
import { draftFromQuery, watchesEditUrl, watchToYaml } from '../lib/watch-yaml'

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
              {matchCount} trajet{matchCount > 1 ? 's' : ''} correspondrait
              {matchCount > 1 ? 'ent' : ''} a cette regle aujourd hui.
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

        <div className="mt-4 space-y-3">
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
              Jours surveilles
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

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.useWindow}
              onChange={(event) => setDraft({ ...draft, useWindow: event.target.checked })}
              className="mt-0.5"
            />
            <span>
              Surveiller en continu la fenetre glissante de 31 jours
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Decochez pour figer l alerte sur les dates choisies. Attention : une alerte sur une
                date fixe s eteint des que cette date quitte la fenetre publiee par la SNCF.
              </span>
            </span>
          </label>

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
