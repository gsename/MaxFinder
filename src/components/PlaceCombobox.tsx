import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { searchPlaces } from '../../shared/places'
import type { PlaceIndex } from '../../shared/places'

interface Props {
  label: string
  value: number | null
  onChange: (id: number | null) => void
  index: PlaceIndex
  placeholder?: string
}

/**
 * Champ de gare avec autocompletion.
 *
 * Ecrit a la main plutot qu avec <datalist> : celui-ci ne permet ni de trier par
 * pertinence, ni d ignorer les accents, alors que le dataset SNCF ecrit "NIMES"
 * la ou l utilisateur tape "Nîmes".
 */
export function PlaceCombobox({ label, value, onChange, index, placeholder }: Props) {
  const listId = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedName = value !== null ? index.places[value]?.name ?? '' : ''

  // Quand la selection change de l exterieur (URL partagee, bouton d inversion),
  // le champ doit refleter le nouveau libelle.
  useEffect(() => {
    setText(selectedName)
  }, [selectedName])

  const matches = useMemo(() => {
    if (!open) return []
    return searchPlaces(index, text === selectedName ? '' : text, 10)
  }, [index, open, text, selectedName])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setText(selectedName)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, selectedName])

  const commit = (id: number) => {
    onChange(id)
    setText(index.places[id]!.name)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setHighlight(0)
        return
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((h) => (matches.length === 0 ? 0 : (h + delta + matches.length) % matches.length))
    } else if (event.key === 'Enter') {
      const pick = matches[highlight]
      if (open && pick !== undefined) {
        event.preventDefault()
        commit(pick)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setText(selectedName)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </label>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
          setHighlight(0)
          if (event.target.value.trim() === '') onChange(null)
        }}
        onFocus={() => {
          setOpen(true)
          setHighlight(0)
        }}
        onKeyDown={onKeyDown}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
      />
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {matches.map((id, i) => (
            <li key={id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                onPointerEnter={() => setHighlight(i)}
                onClick={() => commit(id)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  i === highlight
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                {index.places[id]!.name}
                {index.places[id]!.multiStation && (
                  <span
                    className={`ml-2 text-xs ${
                      i === highlight ? 'text-indigo-100' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {index.places[id]!.stations.length} gares
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
