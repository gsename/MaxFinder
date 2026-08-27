/** Identifiant local d'une gare = index dans `stations.json` du meme build. */
export type StationId = number

export interface Station {
  /** Nom exact tel que publie par la SNCF, ex. "PARIS (intramuros)". */
  name: string
  /** Code SNCF, ex. "FRPAR". Stable dans le temps, contrairement a StationId. */
  iata: string
  /** Forme normalisee pour la recherche (sans accents, minuscules). */
  norm: string
}

/**
 * Un trajet disponible, encode en tuple pour reduire la taille des fichiers.
 * `[numeroDeTrain, gareDepartId, gareArriveeId, departMinutes, arriveeMinutes]`
 *
 * `arriveeMinutes` est deja normalise : il peut depasser 1440 quand le train
 * arrive apres minuit.
 */
export type TripTuple = [string, StationId, StationId, number, number]

/** Contenu de `trips.json` : tous les trajets disponibles, groupes par date. */
export interface TripsFile {
  days: Record<string, TripTuple[]>
}

export interface Trip {
  trainNo: string
  origin: StationId
  dest: StationId
  /** Minutes depuis minuit, heure locale francaise. */
  dep: number
  /** Minutes depuis minuit ; > 1440 si arrivee le lendemain. */
  arr: number
}

export interface DataIndex {
  /** Date ISO de generation des fichiers. */
  generated_at: string
  /** Champ `modified` des metadonnees Opendatasoft au moment du build. */
  dataset_modified: string
  /** Dates couvertes, triees. */
  dates: string[]
  station_count: number
  /** Nombre de trajets disponibles (OUI) par date. */
  available_counts: Record<string, number>
  /** Nombre total de trajets publies par date, disponibles ou non. */
  total_counts: Record<string, number>
}

export interface Leg {
  trainNo: string
  origin: StationId
  dest: StationId
  dep: number
  arr: number
}

export interface Itinerary {
  date: string
  legs: Leg[]
  /** Depart du premier troncon. */
  dep: number
  /** Arrivee du dernier troncon ; > 1440 si le lendemain. */
  arr: number
  /** Duree porte a porte, en minutes. */
  duration: number
  /** Nombre de changements (0 = direct). */
  changes: number
  /**
   * Cle stable entre deux synchronisations : batie sur les codes IATA, jamais
   * sur les StationId qui, eux, bougent des qu'une gare apparait ou disparait.
   */
  key: string
  /** Vrai si au moins une correspondance implique un transfert entre gares d'une meme ville. */
  hasCityTransfer: boolean
}
