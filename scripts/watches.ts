import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { WEEKDAY_KEYS } from '../shared/dates'
import { DEFAULT_SEARCH_OPTIONS } from '../shared/search'
import { parseHm } from '../shared/time'
import type { WatchRule } from '../shared/watch'

const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, 'format attendu HH:MM')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format attendu YYYY-MM-DD')

const stationList = z.union([z.string(), z.array(z.string()).min(1)]).transform((v) =>
  (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean),
)

const datesSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    relative_days: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
    weekdays: z.array(z.enum(WEEKDAY_KEYS)).optional(),
  })
  .strict()
  .refine((d) => !d.relative_days || d.relative_days[0] <= d.relative_days[1], {
    message: 'relative_days doit etre [debut, fin] avec debut <= fin',
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, { message: 'dates.from doit preceder dates.to' })

const defaultsSchema = z
  .object({
    min_connection_minutes: z.number().int().min(0).max(600).optional(),
    city_transfer_connection_minutes: z.number().int().min(0).max(600).optional(),
    max_connection_wait_minutes: z.number().int().min(10).max(1440).optional(),
    max_changes: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    priority: z.number().int().min(1).max(5).optional(),
  })
  .strict()

const watchSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    from: stationList,
    to: stationList,
    dates: datesSchema.optional(),
    depart_between: z.tuple([hhmm, hhmm]).optional(),
    arrive_before: hhmm.optional(),
    max_duration_minutes: z.number().int().min(10).max(2000).optional(),
    max_changes: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    min_connection_minutes: z.number().int().min(0).max(600).optional(),
    city_transfer_connection_minutes: z.number().int().min(0).max(600).optional(),
    max_connection_wait_minutes: z.number().int().min(10).max(1440).optional(),
    priority: z.number().int().min(1).max(5).optional(),
  })
  .strict()

const fileSchema = z
  .object({
    defaults: defaultsSchema.optional(),
    watches: z.array(watchSchema).default([]),
  })
  .strict()

export type WatchesFile = z.infer<typeof fileSchema>

/** Erreur portant un message deja formate pour la sortie console. */
export class WatchesError extends Error {}

export function normalizeWatches(file: WatchesFile): WatchRule[] {
  const d = file.defaults ?? {}
  const names = new Set<string>()

  return file.watches.map((w, i) => {
    if (names.has(w.name)) {
      throw new WatchesError(
        `Deux alertes portent le nom "${w.name}". Le nom sert de cle d etat, il doit etre unique.`,
      )
    }
    names.add(w.name)

    const departBetween = w.depart_between
      ? ([parseHm(w.depart_between[0]), parseHm(w.depart_between[1])] as [number, number])
      : undefined
    if (departBetween && departBetween[0] > departBetween[1]) {
      throw new WatchesError(
        `Alerte "${w.name}" (#${i + 1}) : depart_between doit aller du plus tot au plus tard.`,
      )
    }

    const rule: WatchRule = {
      name: w.name,
      enabled: w.enabled ?? true,
      from: w.from,
      to: w.to,
      dateFrom: w.dates?.from,
      dateTo: w.dates?.to,
      relativeDays: w.dates?.relative_days,
      weekdays: w.dates?.weekdays,
      departBetween,
      arriveBefore: w.arrive_before ? parseHm(w.arrive_before) : undefined,
      maxDurationMinutes: w.max_duration_minutes,
      maxChanges: w.max_changes ?? d.max_changes ?? 0,
      minConnection:
        w.min_connection_minutes ?? d.min_connection_minutes ?? DEFAULT_SEARCH_OPTIONS.minConnection,
      cityTransferConnection:
        w.city_transfer_connection_minutes ??
        d.city_transfer_connection_minutes ??
        DEFAULT_SEARCH_OPTIONS.cityTransferConnection,
      maxConnectionWait:
        w.max_connection_wait_minutes ??
        d.max_connection_wait_minutes ??
        DEFAULT_SEARCH_OPTIONS.maxConnectionWait,
      priority: w.priority ?? d.priority ?? 4,
    }

    // Une regle sans borne de dates surveillerait toute la fenetre glissante :
    // c'est rarement l'intention, mais c'est legitime, donc on l'autorise.
    return rule
  })
}

export async function loadWatches(path: string): Promise<WatchRule[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return []
    throw error
  }

  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (error) {
    throw new WatchesError(`${path} n est pas un YAML valide :\n  ${(error as Error).message}`)
  }
  if (raw === null || raw === undefined) return []

  const parsed = fileSchema.safeParse(raw)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n')
    throw new WatchesError(`${path} ne respecte pas le schema attendu :\n${details}`)
  }

  return normalizeWatches(parsed.data)
}
