import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { todayInParis } from '../shared/dates'
import { buildPlaceIndex } from '../shared/places'
import { decodeDayTrips } from '../shared/search'
import { matchWatch } from '../shared/watch'
import type { Trip } from '../shared/types'
import { buildData } from './build-data'
import { fetchDatasetMeta } from './ods'
import { diffWatch, loadState, saveState, type SyncState } from './state'
import { notifyError, notifyTest, notifyWatch, ntfyConfigFromEnv } from './notify-ntfy'
import { loadWatches, WatchesError } from './watches'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'public', 'data')
const STATE_PATH = join(ROOT, 'state', 'sync-state.json')
const WATCHES_PATH = join(ROOT, 'watches.yml')

interface Flags {
  force: boolean
  notify: boolean
  notifyTest: boolean
  checkWatchesOnly: boolean
  dryRun: boolean
}

function parseFlags(argv: string[]): Flags {
  const has = (name: string) => argv.includes(name)
  return {
    force: has('--force'),
    notify: !has('--no-notify'),
    notifyTest: has('--notify-test'),
    checkWatchesOnly: has('--check-watches'),
    // --dry-run construit les donnees mais n ecrit ni etat ni notification.
    dryRun: has('--dry-run'),
  }
}

/** Expose une sortie au workflow appelant, quand on tourne dans GitHub Actions. */
async function setOutput(name: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  await appendFile(file, `${name}=${value}\n`, 'utf8')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const ntfy = ntfyConfigFromEnv()
  const siteUrl = process.env.SITE_URL?.trim() || undefined

  // Les regles sont validees en premier : une faute de frappe dans le YAML doit
  // faire echouer le run avant tout telechargement.
  let watches
  try {
    watches = await loadWatches(WATCHES_PATH)
  } catch (error) {
    if (error instanceof WatchesError) {
      console.error(`\nwatches.yml invalide\n${error.message}\n`)
      return 1
    }
    throw error
  }
  console.log(`watches.yml : ${watches.length} regle(s), dont ${watches.filter((w) => w.enabled).length} active(s)`)

  if (flags.checkWatchesOnly) {
    console.log('Validation seule demandee, arret ici.')
    return 0
  }

  if (flags.notifyTest) {
    if (!ntfy) {
      console.error('NTFY_TOPIC absent de l environnement : impossible d envoyer le test.')
      return 1
    }
    await notifyTest(ntfy)
    console.log(`Notification de test envoyee sur ${ntfy.server}/${ntfy.topic}`)
    return 0
  }

  const state = await loadState(STATE_PATH)

  // Etape la moins couteuse du run : une requete de metadonnees suffit a savoir
  // si le dataset a bouge depuis la derniere synchronisation.
  const meta = await fetchDatasetMeta()
  console.log(`Dataset modifie le ${meta.modified} (etat local : ${state.dataset_modified ?? 'aucun'})`)

  if (!flags.force && state.dataset_modified === meta.modified) {
    console.log('Dataset inchange : ni reconstruction ni deploiement.')
    await setOutput('changed', 'false')
    await setOutput('reason', 'dataset-unchanged')
    return 0
  }

  console.log('Telechargement et construction des donnees...')
  const build = await buildData(DATA_DIR)
  console.log(
    `  ${build.rowsRead} lignes lues, ${build.rowsSkipped} ignorees, ` +
      `${build.stations.length} gares, ${build.index.dates.length} dates, ${formatBytes(build.bytesWritten)} ecrits`,
  )
  for (const warning of build.warnings) console.warn(`  ATTENTION ${warning}`)

  const placeIndex = buildPlaceIndex(build.stations)
  const today = todayInParis()

  const days = new Map<string, Trip[]>()
  for (const [date, tuples] of build.days) days.set(date, decodeDayTrips(tuples))

  const nextState: SyncState = {
    version: state.version,
    dataset_modified: meta.modified,
    last_run: new Date().toISOString(),
    watches: {},
  }

  let freshTotal = 0
  const problems: string[] = []

  for (const rule of watches) {
    const result = matchWatch(rule, days, placeIndex, today)

    for (const item of result.unresolved) {
      const hint = item.candidates.length
        ? ` Gares proches : ${item.candidates.join(', ')}.`
        : ' Aucune gare approchante dans le dataset.'
      problems.push(`Alerte "${rule.name}" : gare "${item.input}" introuvable.${hint}`)
    }

    if (!rule.enabled) {
      console.log(`  [desactivee] ${rule.name}`)
      // L etat est conserve : reactiver une regle ne doit pas rejouer tout
      // l historique en une salve de notifications.
      const kept = state.watches[rule.name]
      if (kept) nextState.watches[rule.name] = kept
      continue
    }

    const { diff, nextState: watchState } = diffWatch(
      rule,
      result.itineraries,
      state.watches[rule.name],
      today,
    )
    nextState.watches[rule.name] = watchState
    freshTotal += diff.fresh.length

    console.log(
      `  ${rule.name} : ${diff.total} trajet(s) correspondant(s), ` +
        `${diff.fresh.length} nouveau(x), ${diff.goneCount} disparu(s)`,
    )

    if (diff.fresh.length === 0) continue
    if (!flags.notify || flags.dryRun) {
      console.log('    (notification non envoyee : mode local)')
      continue
    }
    if (!ntfy) {
      problems.push(`NTFY_TOPIC absent : ${diff.fresh.length} nouveaute(s) non notifiee(s) pour "${rule.name}".`)
      continue
    }
    await notifyWatch(ntfy, diff, build.stations, siteUrl)
    console.log(`    notification envoyee (${diff.fresh.length} trajet(s))`)
  }

  if (!flags.dryRun) await saveState(STATE_PATH, nextState)

  for (const problem of problems) console.warn(`ATTENTION ${problem}`)

  await setOutput('changed', 'true')
  await setOutput('reason', flags.force ? 'forced' : 'dataset-updated')
  await setOutput('fresh_count', String(freshTotal))
  await setOutput('dataset_modified', meta.modified)

  // Les avertissements de gares introuvables ne font pas echouer le run : le
  // site reste deployable, et le probleme est visible dans les logs.
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch(async (error) => {
    console.error('\nSynchronisation echouee :', error)
    const ntfy = ntfyConfigFromEnv()
    if (ntfy) {
      try {
        await notifyError(ntfy, String(error instanceof Error ? error.stack ?? error.message : error))
      } catch (notifyFailure) {
        console.error('Notification d echec impossible :', notifyFailure)
      }
    }
    process.exit(1)
  })
