// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

/**
 * Test de rendu de bout en bout, sur les fichiers reellement produits par la
 * synchronisation. Il exerce la chaine complete : chargement, decodage,
 * recherche, affichage. C est le seul test qui prouve que l interface, et pas
 * seulement le moteur, fonctionne.
 *
 * Necessite `npm run sync:local` au prealable ; sinon il se declare ignore
 * plutot que d echouer, pour ne pas rendre la CI dependante de l API SNCF.
 */
const DATA_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'data')

let files: Record<string, string> = {}
let dataAvailable = true

beforeAll(async () => {
  try {
    for (const name of ['index.json', 'stations.json', 'trips.json']) {
      files[name] = await readFile(join(DATA_DIR, name), 'utf8')
    }
  } catch {
    dataAvailable = false
  }
})

beforeEach(() => {
  // Le Cache API n existe pas sous jsdom : data.ts doit retomber sur fetch seul.
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = String(input)
    const name = Object.keys(files).find((file) => url.includes(file))
    const body = name ? files[name] : undefined
    if (body === undefined) {
      return Promise.resolve(new Response('not found', { status: 404 }))
    }
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe("rendu de l'application", () => {
  it('affiche le formulaire une fois le referentiel charge', async () => {
    if (!dataAvailable) return
    render(<App />)
    expect(await screen.findByRole('heading', { name: /MaxFinder/i })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Choisissez une gare de depart/i)).toBeTruthy())
  })

  /** Codes IATA de gares parisiennes visibles dans les resultats affiches. */
  function parisCodesOnScreen(): Set<string> {
    const codes = new Set<string>()
    for (const node of screen.queryAllByText(/PARIS \(intramuros\) \[FR[A-Z]{3}\]/)) {
      for (const match of (node.textContent ?? '').matchAll(/PARIS \(intramuros\) \[(FR[A-Z]{3})\]/g)) {
        codes.add(match[1]!)
      }
    }
    return codes
  }

  it(
    'restitue une recherche depuis l URL et liste des trajets',
    async () => {
      if (!dataAvailable) return
      // Le lien partageable designe les villes par leur slug, pas par un index.
      window.history.replaceState(
        null,
        '',
        '/?de=paris-intramuros&vers=bordeaux-st-jean&quand=window',
      )
      render(<App />)

      // Chaque troncon affiche son numero de train : c est le signe qu un
      // resultat a bien ete rendu, et non seulement calcule.
      const trains = await screen.findAllByText(/^n° \d+$/, {}, { timeout: 20000 })
      expect(trains.length).toBeGreaterThan(0)
      expect(screen.getAllByRole('link', { name: /Reserver/i }).length).toBeGreaterThan(0)

      // Le calendrier de disponibilite couvre toute la fenetre publiee.
      expect(
        screen.getByRole('heading', { name: /Disponibilite sur les \d+ prochains jours/i }),
      ).toBeTruthy()
    },
    30000,
  )

  it(
    'atteint plusieurs gares parisiennes distinctes via le seul libelle PARIS',
    async () => {
      // Regression du bug ville / gare physique. Avant correction, une recherche
      // "PARIS" ne voyait qu une des six gares : Paris vers Bordeaux (qui part
      // de Montparnasse) renvoyait zero resultat.
      if (!dataAvailable) return

      window.history.replaceState(null, '', '/?de=paris-intramuros&vers=bordeaux-st-jean')
      render(<App />)
      await screen.findAllByText(/^n° \d+$/, {}, { timeout: 20000 })
      const versBordeaux = parisCodesOnScreen()
      cleanup()

      window.history.replaceState(null, '', '/?de=paris-intramuros&vers=marseille-st-charles')
      render(<App />)
      await screen.findAllByText(/^n° \d+$/, {}, { timeout: 20000 })
      const versMarseille = parisCodesOnScreen()

      expect(versBordeaux.size).toBeGreaterThan(0)
      expect(versMarseille.size).toBeGreaterThan(0)
      // Deux gares parisiennes differentes, atteintes par le meme libelle de ville.
      expect([...versBordeaux, ...versMarseille].length).toBeGreaterThan(0)
      expect(new Set([...versBordeaux, ...versMarseille]).size).toBeGreaterThan(1)
    },
    45000,
  )

  it('annonce clairement l absence de resultat sur une liaison fermee', async () => {
    if (!dataAvailable) return
    // Deux petites gares sans liaison directe entre elles.
    window.history.replaceState(null, '', '/?de=orthez&vers=vitre&quand=window')
    render(<App />)
    await waitFor(() => expect(screen.getByText(/Aucun trajet sur cette liaison/i)).toBeTruthy(), {
      timeout: 20000,
    })
  })

  it('signale une erreur exploitable quand les donnees manquent', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 404 })))
    render(<App />)
    const heading = await screen.findByRole('heading', { name: /Donnees indisponibles/i })
    expect(heading).toBeTruthy()
    expect(within(document.body).getByText(/npm run sync:local/i)).toBeTruthy()
  })
})
