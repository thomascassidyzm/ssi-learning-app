import { describe, it, expect } from 'vitest'
import { buildOfflineDownloadQueue, buildFetchAheadOrder } from './offlineDownloadOrder'

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
const firstIndex = (q: string[], prefix: string) => q.findIndex((id) => id.startsWith(prefix))
const lastIndex = (q: string[], prefix: string) => q.length - 1 - [...q].reverse().findIndex((id) => id.startsWith(prefix))

describe('buildOfflineDownloadQueue — listening first (Tom 2026-09-12, job #379)', () => {
  it('leads with the head, then EVERY pod clip, then the course', () => {
    const q = buildOfflineDownloadQueue({
      head: ['h0', 'h1'],
      priority: ids('p', 5),
      main: ids('c', 20),
      tail: ['t0'],
    })
    expect(q.slice(0, 2)).toEqual(['h0', 'h1'])
    expect(q.slice(2, 7)).toEqual(ids('p', 5))
    expect(q[7]).toBe('c0')
    expect(q[q.length - 1]).toBe('t0')
  })

  it('a stop at ANY point past the head holds every pod before the first course clip', () => {
    // The measured spa_for_eng shape: 3,138 pod clips in a 79,950-clip course.
    const priority = ids('p', 3138)
    const main = ids('c', 79950 - 3138)
    const q = buildOfflineDownloadQueue({ head: ids('h', 60), priority, main, tail: [] })
    expect(lastIndex(q, 'p')).toBeLessThan(firstIndex(q, 'c'))
    // 16,000 clips fetched — Tom's 2026-09-12 figure — carries the whole pod.
    expect(q.slice(0, 16000).filter((id) => id.startsWith('p'))).toHaveLength(priority.length)
  })

  it('dedupes to the EARLIEST position, so a shared id keeps its priority', () => {
    const q = buildOfflineDownloadQueue(
      { head: [], priority: ['p0'], main: ['c0', 'c1'], tail: ['p0', 'a0'] },
    )
    expect(q).toEqual(['p0', 'c0', 'c1', 'a0'])
  })

  it('handles empty tiers without leaving holes', () => {
    expect(buildOfflineDownloadQueue({ head: [], priority: [], main: ['c0'], tail: ['a0'] }))
      .toEqual(['c0', 'a0'])
    expect(buildOfflineDownloadQueue({ head: [], priority: ['p0'], main: [], tail: [] }))
      .toEqual(['p0'])
    expect(buildOfflineDownloadQueue({ head: [], priority: [], main: [], tail: [] })).toEqual([])
  })
})

describe('buildFetchAheadOrder — the automatic path uses the same rule', () => {
  it('head, then every pod, then Layer-1, then the span cycles', () => {
    const q = buildFetchAheadOrder({
      head: ids('h', 3),
      pods: ids('p', 400),
      layer1: ids('l', 4),
      span: ids('c', 300),
    })
    expect(q.slice(0, 3)).toEqual(ids('h', 3))
    expect(lastIndex(q, 'p')).toBeLessThan(firstIndex(q, 'l'))
    expect(lastIndex(q, 'l')).toBeLessThan(firstIndex(q, 'c'))
    // A connection that drops after any number of fetches past the head has
    // been spending on pods, not on cycles the learner cannot reach yet.
    expect(q.slice(3, 403)).toEqual(ids('p', 400))
  })

  it('dedupes a clip shared by a cycle and a pod at its pod position', () => {
    expect(buildFetchAheadOrder({ head: [], pods: ['x'], layer1: [], span: ['c0', 'x'] })).toEqual(['x', 'c0'])
  })
})
