/**
 * Noms des parametres d URL, partages entre le front et le job d alertes.
 *
 * Centralises ici pour qu un lien fabrique par une notification ouvre
 * exactement la recherche que le site sait relire. Deux listes separees auraient
 * divergees a la premiere modification.
 */
export const URL_PARAM = {
  from: 'de',
  to: 'vers',
  mode: 'quand',
  dateFrom: 'd1',
  dateTo: 'd2',
  hours: 'h',
  changes: 'chgt',
  duration: 'duree',
} as const

export interface DeepLinkTarget {
  /** Slug de la ville de depart, ex. "toulouse-matabiau". */
  fromSlug: string
  toSlug: string
  /** Date visee, au format YYYY-MM-DD. */
  date: string
  maxChanges: 0 | 1 | 2
}

/**
 * Lien vers le site, prerempli sur un trajet precis.
 *
 * Sert de bouton dans les notifications : depuis le telephone, une seule touche
 * amene sur la recherche exacte, sans avoir a resaisir gares et date.
 */
export function itineraryUrl(siteUrl: string, target: DeepLinkTarget): string {
  const base = siteUrl.replace(/\/+$/, '')
  const params = new URLSearchParams()
  params.set(URL_PARAM.from, target.fromSlug)
  params.set(URL_PARAM.to, target.toSlug)
  params.set(URL_PARAM.mode, 'single')
  params.set(URL_PARAM.dateFrom, target.date)
  if (target.maxChanges !== 0) params.set(URL_PARAM.changes, String(target.maxChanges))
  return `${base}/?${params}`
}

/**
 * Recherche SNCF Connect.
 *
 * Le format des liens profonds horaires de SNCF Connect n est pas documente
 * publiquement : en fabriquer un reviendrait a parier sur une URL qui peut
 * casser sans prevenir, et un bouton "Reserver" qui tombe sur une erreur est
 * pire qu un bouton qui ouvre l accueil.
 */
export const SNCF_CONNECT_URL = 'https://www.sncf-connect.com/'
