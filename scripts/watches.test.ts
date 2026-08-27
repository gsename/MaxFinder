import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHm } from '../shared/time'
import { loadWatches, WatchesError } from './watches'

async function withYaml(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tgvmax-watches-'))
  const path = join(dir, 'watches.yml')
  await writeFile(path, content, 'utf8')
  return path
}

const VALID = `
defaults:
  max_changes: 1
  min_connection_minutes: 25
  priority: 5
watches:
  - name: "Paris vers Bordeaux"
    from: ["PARIS (intramuros)"]
    to: ["BORDEAUX ST JEAN"]
    dates:
      relative_days: [0, 31]
      weekdays: [fri, sat]
    depart_between: ["16:00", "21:30"]
`

describe('loadWatches', () => {
  it('lit une regle valide et applique les valeurs par defaut', async () => {
    const rules = await loadWatches(await withYaml(VALID))
    expect(rules).toHaveLength(1)
    const rule = rules[0]!
    expect(rule.name).toBe('Paris vers Bordeaux')
    expect(rule.enabled).toBe(true)
    expect(rule.maxChanges).toBe(1)
    expect(rule.minConnection).toBe(25)
    expect(rule.priority).toBe(5)
    expect(rule.weekdays).toEqual(['fri', 'sat'])
    expect(rule.relativeDays).toEqual([0, 31])
    expect(rule.departBetween).toEqual([parseHm('16:00'), parseHm('21:30')])
  })

  it('accepte une gare unique sans crochets', async () => {
    const rules = await loadWatches(
      await withYaml('watches:\n  - name: "X"\n    from: PARIS\n    to: LYON\n'),
    )
    expect(rules[0]!.from).toEqual(['PARIS'])
    expect(rules[0]!.to).toEqual(['LYON'])
  })

  it('renvoie une liste vide si le fichier est absent ou vide', async () => {
    expect(await loadWatches(join(tmpdir(), 'absolument-inexistant.yml'))).toEqual([])
    expect(await loadWatches(await withYaml('# rien\n'))).toEqual([])
  })

  it('rejette une cle inconnue plutot que de l ignorer en silence', async () => {
    // Une faute de frappe comme `depart_beetween` doit echouer bruyamment :
    // sinon l alerte tournerait en ignorant le filtre attendu.
    const path = await withYaml(
      'watches:\n  - name: "X"\n    from: PARIS\n    to: LYON\n    depart_beetween: ["16:00", "21:00"]\n',
    )
    await expect(loadWatches(path)).rejects.toThrow(WatchesError)
  })

  it('rejette un YAML syntaxiquement invalide', async () => {
    await expect(loadWatches(await withYaml('watches: [ unclosed\n'))).rejects.toThrow(WatchesError)
  })

  it('rejette une heure malformee', async () => {
    const path = await withYaml(
      'watches:\n  - name: "X"\n    from: PARIS\n    to: LYON\n    depart_between: ["16h00", "21:00"]\n',
    )
    await expect(loadWatches(path)).rejects.toThrow(WatchesError)
  })

  it('rejette une plage horaire inversee', async () => {
    const path = await withYaml(
      'watches:\n  - name: "X"\n    from: PARIS\n    to: LYON\n    depart_between: ["21:00", "16:00"]\n',
    )
    await expect(loadWatches(path)).rejects.toThrow(/plus tot au plus tard/)
  })

  it('rejette deux alertes de meme nom, le nom servant de cle d etat', async () => {
    const path = await withYaml(
      'watches:\n  - name: "X"\n    from: PARIS\n    to: LYON\n  - name: "X"\n    from: LYON\n    to: PARIS\n',
    )
    await expect(loadWatches(path)).rejects.toThrow(/cle d etat/)
  })

  it('rejette des dates incoherentes', async () => {
    const path = await withYaml(
      'watches:\n  - name: "X"\n    from: PARIS\n    to: LYON\n    dates:\n      from: "2026-09-10"\n      to: "2026-09-01"\n',
    )
    await expect(loadWatches(path)).rejects.toThrow(WatchesError)
  })

  it('rejette un jour de semaine inexistant', async () => {
    const path = await withYaml(
      'watches:\n  - name: "X"\n    from: PARIS\n    to: LYON\n    dates:\n      weekdays: [lundi]\n',
    )
    await expect(loadWatches(path)).rejects.toThrow(WatchesError)
  })

  it('le fichier livre dans le depot est valide', async () => {
    // Garde-fou : une erreur de syntaxe dans l exemple casserait le premier run.
    const rules = await loadWatches(new URL('../watches.yml', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    expect(Array.isArray(rules)).toBe(true)
  })
})
