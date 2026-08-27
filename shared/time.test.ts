import { describe, expect, it } from 'vitest'
import {
  MINUTES_PER_DAY,
  dayOffset,
  formatArrival,
  formatDuration,
  formatHm,
  normalizeArrival,
  parseHm,
} from './time'

describe('parseHm', () => {
  it('convertit une heure du dataset en minutes', () => {
    expect(parseHm('06:36')).toBe(396)
    expect(parseHm('00:00')).toBe(0)
    expect(parseHm('23:59')).toBe(1439)
  })

  it('rejette les entrees malformees', () => {
    expect(() => parseHm('6h36')).toThrow()
    expect(() => parseHm('24:00')).toThrow()
    expect(() => parseHm('12:60')).toThrow()
    expect(() => parseHm('')).toThrow()
  })
})

describe('normalizeArrival', () => {
  it('laisse intacte une arrivee le meme jour', () => {
    expect(normalizeArrival(parseHm('06:36'), parseHm('08:54'))).toBe(534)
  })

  it('ajoute une journee quand le train arrive apres minuit', () => {
    // Cas reel du dataset : RENNES -> VANNES, 00:29 -> 01:25 le lendemain de
    // la date publiee est distinct de 23:50 -> 01:25.
    const dep = parseHm('23:50')
    const arr = normalizeArrival(dep, parseHm('01:25'))
    expect(arr).toBe(parseHm('01:25') + MINUTES_PER_DAY)
    expect(arr - dep).toBe(95)
    expect(dayOffset(arr)).toBe(1)
  })

  it('traite le cas limite d une arrivee a la meme minute que le depart', () => {
    expect(normalizeArrival(600, 600)).toBe(600)
  })
})

describe('formatage', () => {
  it('formate les heures et les ramene dans la journee', () => {
    expect(formatHm(396)).toBe('06:36')
    expect(formatHm(1525)).toBe('01:25')
  })

  it('signale explicitement une arrivee le lendemain', () => {
    expect(formatArrival(534)).toBe('08:54')
    expect(formatArrival(1525)).toBe('01:25 +1')
  })

  it('formate les durees', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(136)).toBe('2 h 16')
    expect(formatDuration(120)).toBe('2 h')
  })
})
