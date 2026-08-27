/**
 * Client de l'API Opendatasoft de la SNCF pour le dataset `tgvmax`.
 *
 * Aucune cle d'API : le dataset est public (ODbL). On reste neanmoins econome
 * en requetes, la plateforme appliquant des quotas par adresse IP.
 */

const DATASET = 'tgvmax'
const BASE = `https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/${DATASET}`

const USER_AGENT = 'maxfinder (+https://github.com/, open data ODbL)'

export interface RawRow {
  date: string
  train_no: string
  entity: string
  axe: string
  origine_iata: string
  destination_iata: string
  origine: string
  destination: string
  heure_depart: string
  heure_arrivee: string
  od_happy_card: string
}

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      // 429 et 5xx sont transitoires ; 4xx autres sont definitifs.
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
      }
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText} sur ${url}`), {
          fatal: true,
        })
      }
      return res
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal) throw error
      lastError = error
      if (i < attempts - 1) {
        const waitMs = 2000 * 2 ** i
        console.warn(`  tentative ${i + 1}/${attempts} echouee (${String(error)}), retry dans ${waitMs} ms`)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
  }
  throw lastError
}

export interface DatasetMeta {
  /** Horodatage de derniere modification publie par Opendatasoft. */
  modified: string
  /**
   * Compteur des metadonnees. Attention : il ne coincide pas avec le nombre de
   * lignes reellement interrogeables, il ne sert donc qu'a titre indicatif.
   */
  recordsCount: number | null
}

export async function fetchDatasetMeta(): Promise<DatasetMeta> {
  const res = await fetchWithRetry(BASE)
  const json = (await res.json()) as {
    metas?: { default?: { modified?: string; records_count?: number } }
  }
  const modified = json.metas?.default?.modified
  if (!modified) throw new Error('Champ metas.default.modified absent de la reponse Opendatasoft')
  return { modified, recordsCount: json.metas?.default?.records_count ?? null }
}

/** Nombre de lignes par date, filtre par `where` optionnel. */
export async function fetchCountsByDate(where?: string): Promise<Record<string, number>> {
  const params = new URLSearchParams({
    select: 'date, count(*) as n',
    group_by: 'date',
    order_by: 'date',
    limit: '100',
  })
  if (where) params.set('where', where)

  const res = await fetchWithRetry(`${BASE}/records?${params}`)
  const json = (await res.json()) as { results?: Array<{ date: string | null; n: number }> }
  const counts: Record<string, number> = {}
  for (const row of json.results ?? []) {
    if (!row.date) continue
    // L'agregation renvoie un datetime ISO, on ne garde que la date civile.
    counts[row.date.slice(0, 10)] = row.n
  }
  return counts
}

/**
 * Telecharge en streaming les lignes du dataset au format JSONL.
 *
 * On filtre `od_happy_card="OUI"` cote serveur : cela ramene l'export de ~36 Mo
 * a ~5 Mo, puisque seules 61 000 des 396 000 lignes correspondent a une place
 * effectivement ouverte aux pass MAX.
 */
export async function* streamAvailableRows(): AsyncGenerator<RawRow> {
  const params = new URLSearchParams({
    where: 'od_happy_card="OUI"',
    limit: '-1',
  })
  const res = await fetchWithRetry(`${BASE}/exports/jsonl?${params}`)
  if (!res.body) throw new Error('Reponse sans corps sur l export JSONL')

  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) yield JSON.parse(line) as RawRow
      newline = buffer.indexOf('\n')
    }
  }

  const tail = buffer.trim()
  if (tail) yield JSON.parse(tail) as RawRow
}

export const ODS_DATASET_URL = `https://ressources.data.sncf.com/explore/dataset/${DATASET}/`
