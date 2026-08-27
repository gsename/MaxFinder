import { formatDateLabel } from '../shared/dates'
import { formatArrival, formatDuration, formatHm } from '../shared/time'
import type { Itinerary, Station } from '../shared/types'
import type { WatchDiff } from './state'

/**
 * Envoi des alertes via ntfy.
 *
 * Le topic arrive par la variable d environnement NTFY_TOPIC, alimentee par un
 * GitHub Secret : le depot etant public, un topic ecrit en clair dans le YAML
 * serait lisible et polluable par n importe qui.
 */
export interface NtfyConfig {
  server: string
  topic: string
  token?: string
}

export function ntfyConfigFromEnv(env = process.env): NtfyConfig | null {
  const topic = env.NTFY_TOPIC?.trim()
  if (!topic) return null
  return {
    server: (env.NTFY_SERVER?.trim() || 'https://ntfy.sh').replace(/\/+$/, ''),
    topic,
    token: env.NTFY_TOKEN?.trim() || undefined,
  }
}

/** En-tetes ntfy : ASCII seulement, d ou l encodage RFC 2047 des titres accentues. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

async function post(
  config: NtfyConfig,
  body: string,
  headers: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${config.server}/${config.topic}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...headers,
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`ntfy a repondu ${res.status} ${res.statusText}: ${await res.text()}`)
  }
}

function describeItinerary(it: Itinerary, stations: Station[]): string {
  const name = (id: number) => stations[id]?.name ?? `#${id}`
  const first = it.legs[0]!
  const last = it.legs[it.legs.length - 1]!
  const head = `${formatDateLabel(it.date)} ${formatHm(it.dep)} - ${formatArrival(it.arr)}  ${name(first.origin)} > ${name(last.dest)}  (${formatDuration(it.duration)})`
  if (it.changes === 0) return `${head}  train ${first.trainNo}`
  const via = it.legs.slice(1).map((leg) => name(leg.origin)).join(', ')
  const trains = it.legs.map((leg) => leg.trainNo).join(' + ')
  return `${head}  ${it.changes} chgt via ${via}  trains ${trains}`
}

/** Nombre d itineraires detailles par notification, au-dela on resume. */
const MAX_DETAILED = 12

export async function notifyWatch(
  config: NtfyConfig,
  diff: WatchDiff,
  stations: Station[],
  siteUrl: string | undefined,
): Promise<void> {
  const count = diff.fresh.length
  if (count === 0) return

  const shown = diff.fresh.slice(0, MAX_DETAILED)
  const lines = shown.map((it) => describeItinerary(it, stations))
  if (count > shown.length) {
    lines.push(`... et ${count - shown.length} autre(s) trajet(s).`)
  }
  lines.push('', `${diff.total} trajet(s) correspondent a cette alerte au total.`)

  const title = `${count} nouveau${count > 1 ? 'x' : ''} TGVmax - ${diff.rule.name}`

  const headers: Record<string, string> = {
    Title: encodeHeader(title),
    Priority: String(diff.rule.priority),
    Tags: 'train,tgvmax',
  }
  if (siteUrl) headers.Click = siteUrl

  await post(config, lines.join('\n'), headers)
}

export async function notifyTest(config: NtfyConfig): Promise<void> {
  await post(config, 'Si vous lisez ceci, les alertes TGVmax sont bien configurees.', {
    Title: encodeHeader('MaxFinder - test de notification'),
    Priority: '3',
    Tags: 'white_check_mark',
  })
}

export async function notifyError(config: NtfyConfig, message: string): Promise<void> {
  await post(config, message.slice(0, 3000), {
    Title: encodeHeader('MaxFinder - echec de synchronisation'),
    Priority: '4',
    Tags: 'warning',
  })
}
