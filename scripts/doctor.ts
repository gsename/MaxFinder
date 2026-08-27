/**
 * Diagnostic de la chaine d alerte, en ligne de commande.
 *
 *   NTFY_TOPIC=mon-topic npm run doctor
 *
 * Verifie, dans l ordre : la configuration ntfy, la livraison reelle d un
 * message (publication PUIS relecture, ce qui prouve l acheminement et pas
 * seulement l absence d erreur), la validite de watches.yml, la presence des
 * donnees, et ce que chaque regle declencherait.
 *
 * Repond a la question "pourquoi je ne recois rien ?", dont les causes les plus
 * frequentes ne sont pas des pannes : aucune regle active, ou aucune place
 * disponible sur les liaisons surveillees.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { todayInParis } from '../shared/dates'
import { buildPlaceIndex } from '../shared/places'
import { decodeDayTrips } from '../shared/search'
import type { DataIndex, Station, Trip, TripsFile } from '../shared/types'
import { datesForWatch, matchWatch } from '../shared/watch'
import { ntfyConfigFromEnv, type NtfyConfig } from './notify-ntfy'
import { loadWatches, WatchesError } from './watches'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'public', 'data')
const WATCHES = join(ROOT, 'watches.yml')

const OK = 'OK   '
const KO = 'ECHEC'
const WARN = 'ALERTE'

const todo: string[] = []
let failed = false

function line(mark: string, text: string): void {
  console.log(`  ${mark.padEnd(6)} ${text}`)
  if (mark === KO) failed = true
}

/** Masque un secret : les logs d Actions sont publics sur un depot public. */
function masked(value: string): string {
  return `${value.length} caracteres, se termine par "${value.slice(-3)}"`
}

async function checkNtfy(config: NtfyConfig | null): Promise<void> {
  console.log('\n1. Configuration ntfy')
  if (!config) {
    line(KO, 'NTFY_TOPIC absent de l environnement : aucune alerte ne peut partir.')
    todo.push(
      'En local  : NTFY_TOPIC="votre-topic" npm run doctor\n' +
        '    Sur GitHub : Settings > Secrets and variables > Actions > New repository secret',
    )
    return
  }
  line(OK, `topic present (${masked(config.topic)})`)
  line(OK, `serveur ${config.server}${config.token ? ' (jeton fourni)' : ''}`)

  console.log('\n2. Livraison reelle d un message')
  const marker = `maxfinder-doctor-${Date.now().toString(36)}`
  try {
    const res = await fetch(`${config.server}/${config.topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        Title: 'MaxFinder - diagnostic',
        Priority: '3',
        Tags: 'stethoscope',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: `Diagnostic MaxFinder. Marqueur : ${marker}`,
    })
    if (!res.ok) {
      line(KO, `publication refusee : HTTP ${res.status} ${res.statusText} — ${await res.text()}`)
      return
    }
    line(OK, 'message publie')
  } catch (error) {
    line(KO, `impossible de joindre ${config.server} : ${String(error)}`)
    todo.push('Verifiez votre acces reseau sortant vers ntfy.sh (proxy d entreprise ?).')
    return
  }

  // Relecture : c est elle qui prouve l acheminement. Un POST accepte ne dit
  // rien de ce que le serveur a reellement enregistre.
  //
  // Le message n apparait pas instantanement dans le cache : interroger le
  // serveur dans la milliseconde qui suit la publication le rate. On reessaie
  // donc quelques fois avant de conclure.
  try {
    let messages: Array<{ event?: string; message?: string; title?: string }> = []
    let found: { title?: string } | undefined
    for (let attempt = 0; attempt < 6 && !found; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800))
      const res = await fetch(`${config.server}/${config.topic}/json?poll=1`, {
        headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
      })
      messages = (await res.text())
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { event?: string; message?: string; title?: string })
        .filter((m) => m.event === 'message')
      found = messages.find((m) => m.message?.includes(marker))
    }
    if (found) {
      line(OK, `message relu sur le serveur, titre "${found.title}"`)
      line(OK, `${messages.length} message(s) en cache sur ce topic`)
      console.log(
        `\n     La chaine technique fonctionne. Si votre telephone ne sonne pas, c est\n` +
          `     l abonnement qui manque : ouvrez l application ntfy et abonnez-vous a ce\n` +
          `     topic exact, ou testez dans un navigateur sur ${config.server}/${config.topic}`,
      )
    } else {
      line(WARN, 'message publie mais introuvable a la relecture (cache desactive ?)')
    }
  } catch (error) {
    line(WARN, `relecture impossible : ${String(error)}`)
  }
}

async function main(): Promise<number> {
  console.log('='.repeat(72))
  console.log('Diagnostic MaxFinder')
  console.log('='.repeat(72))

  await checkNtfy(ntfyConfigFromEnv())

  console.log('\n3. Regles de surveillance (watches.yml)')
  let watches
  try {
    watches = await loadWatches(WATCHES)
  } catch (error) {
    if (error instanceof WatchesError) {
      line(KO, 'watches.yml invalide :')
      console.log(
        error.message
          .split('\n')
          .map((l) => `         ${l}`)
          .join('\n'),
      )
      todo.push('Corrigez watches.yml, puis relancez npm run doctor.')
      return report()
    }
    throw error
  }

  const actives = watches.filter((w) => w.enabled)
  line(OK, `${watches.length} regle(s), syntaxe et schema valides`)
  if (actives.length === 0) {
    line(KO, 'aucune regle active : meme une synchronisation parfaite n enverra rien.')
    todo.push('Passez au moins une regle a "enabled: true" dans watches.yml.')
  } else {
    line(OK, `${actives.length} regle(s) active(s)`)
  }

  console.log('\n4. Donnees locales')
  let index: DataIndex
  let stations: Station[]
  let tripsFile: TripsFile
  try {
    index = JSON.parse(await readFile(join(DATA_DIR, 'index.json'), 'utf8')) as DataIndex
    stations = JSON.parse(await readFile(join(DATA_DIR, 'stations.json'), 'utf8')) as Station[]
    tripsFile = JSON.parse(await readFile(join(DATA_DIR, 'trips.json'), 'utf8')) as TripsFile
  } catch {
    line(WARN, `absentes de ${DATA_DIR} : impossible de previsualiser les correspondances.`)
    todo.push('npm run sync:local  pour telecharger les donnees.')
    return report()
  }
  line(OK, `instantane du ${index.dataset_modified}`)
  line(OK, `${index.dates.length} dates, ${index.station_count} gares`)

  if (actives.length === 0) return report()

  console.log('\n5. Ce que chaque regle active declencherait')
  const days = new Map<string, Trip[]>()
  for (const [date, tuples] of Object.entries(tripsFile.days)) days.set(date, decodeDayTrips(tuples))
  const placeIndex = buildPlaceIndex(stations)
  const today = todayInParis()

  let totalMatches = 0
  for (const rule of actives) {
    const result = matchWatch(rule, days, placeIndex, today)
    const dates = datesForWatch(rule, index.dates, today)
    totalMatches += result.itineraries.length

    for (const item of result.unresolved) {
      const hint = item.candidates.length ? ` Proches : ${item.candidates.join(', ')}.` : ''
      line(KO, `"${rule.name}" : gare "${item.input}" introuvable.${hint}`)
      todo.push(`Corrigez le nom de gare "${item.input}" dans watches.yml.`)
    }
    if (dates.length === 0) {
      line(KO, `"${rule.name}" : aucune date surveillee, elle ne declenchera jamais.`)
      todo.push(`Revoyez le bloc "dates" de la regle "${rule.name}".`)
      continue
    }
    const mark = result.itineraries.length > 0 ? OK : WARN
    line(
      mark,
      `"${rule.name}" : ${dates.length} date(s) surveillee(s), ` +
        `${result.itineraries.length} trajet(s) correspondent`,
    )
  }

  if (totalMatches === 0) {
    console.log(
      '\n     Aucune place disponible aujourd hui sur les liaisons surveillees. Ce n est\n' +
        '     pas une panne : c est le cas normal d une alerte, qui existe justement pour\n' +
        '     vous prevenir quand cela changera.',
    )
  }

  return report()
}

function report(): number {
  console.log(`\n${'='.repeat(72)}`)
  if (todo.length === 0) {
    console.log('Tout est en place.')
  } else {
    console.log('A faire :')
    for (const item of todo) console.log(`  - ${item}`)
  }
  console.log('='.repeat(72))
  return failed ? 1 : 0
}

main().then((code) => process.exit(code))
