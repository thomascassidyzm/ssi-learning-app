import { describe, it, expect } from 'vitest'
import { buildOfflineDownloadQueue, PRIORITY_EVERY_NTH } from './offlineDownloadOrder'

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe('buildOfflineDownloadQueue', () => {
  it('leads with the head tier, then the course — pods are NOT a prefix', () => {
    const q = buildOfflineDownloadQueue({
      head: ['h0', 'h1'],
      priority: ids('p', 5),
      main: ids('c', 20),
      tail: [],
    })
    expect(q.slice(0, 2)).toEqual(['h0', 'h1'])
    // Tom, 2026-09-01: "Not first. But prioritised." The first slot after the
    // head is course content, so an early stop always leaves something to play.
    expect(q[2]).toBe('c0')
  })

  it('weaves one priority id every Nth slot', () => {
    const q = buildOfflineDownloadQueue(
      { head: [], priority: ids('p', 3), main: ids('c', 20), tail: [] },
      4,
    )
    expect(q.slice(0, 12)).toEqual([
      'c0', 'c1', 'c2', 'p0',
      'c3', 'c4', 'c5', 'p1',
      'c6', 'c7', 'c8', 'p2',
    ])
  })

  it('over-represents pods without starving the course at a 25% stop', () => {
    // The measured spa_for_eng shape: 3,138 pod clips in a 79,950-clip course.
    const priority = ids('p', 3138)
    const main = ids('c', 79950 - 3138)
    const q = buildOfflineDownloadQueue({ head: [], priority, main, tail: [] })
    const quarter = q.slice(0, Math.floor(q.length * 0.25))
    const pods = quarter.filter((id) => id.startsWith('p')).length
    const course = quarter.length - pods

    // A disproportionately large share of the pods…
    expect(pods / priority.length).toBeGreaterThan(0.75)
    // …and still roughly a quarter of the course ahead of them.
    expect(course / main.length).toBeGreaterThan(0.2)
    // Far above the ~4% natural share a plain learner-order queue would give.
    expect(pods / quarter.length).toBeGreaterThan(0.1)
  })

  it('finishes every pod for a learner who takes a third or more', () => {
    const priority = ids('p', 3138)
    const main = ids('c', 79950 - 3138)
    const q = buildOfflineDownloadQueue({ head: [], priority, main, tail: [] })
    const third = q.slice(0, Math.floor(q.length / 3))
    expect(third.filter((id) => id.startsWith('p')).length).toBe(priority.length)
  })

  it('drains whichever stream outlives the other, losing nothing', () => {
    const q = buildOfflineDownloadQueue(
      { head: [], priority: ids('p', 10), main: ids('c', 3), tail: ['t0'] },
      4,
    )
    expect(q.filter((id) => id.startsWith('p'))).toHaveLength(10)
    expect(q.filter((id) => id.startsWith('c'))).toHaveLength(3)
    expect(q[q.length - 1]).toBe('t0')
  })

  it('dedupes to the EARLIEST position, so a shared id keeps its priority', () => {
    // Pod clips are legitimately enumerated twice — once as promoted listening,
    // once inside the wider auxiliary bundle. The promoted copy must win.
    const q = buildOfflineDownloadQueue(
      { head: [], priority: ['p0'], main: ['c0', 'c1'], tail: ['p0', 'a0'] },
      2,
    )
    expect(q).toEqual(['c0', 'p0', 'c1', 'a0'])
  })

  it('handles empty tiers without leaving holes', () => {
    expect(buildOfflineDownloadQueue({ head: [], priority: [], main: ['c0'], tail: ['a0'] }))
      .toEqual(['c0', 'a0'])
    expect(buildOfflineDownloadQueue({ head: [], priority: ['p0'], main: [], tail: [] }))
      .toEqual(['p0'])
    expect(buildOfflineDownloadQueue({ head: [], priority: [], main: [], tail: [] })).toEqual([])
  })

  it('never lets a degenerate rate collapse the weave into a prefix', () => {
    const q = buildOfflineDownloadQueue(
      { head: [], priority: ids('p', 4), main: ids('c', 4), tail: [] },
      0,
    )
    expect(q[0]).toBe('c0')
    expect(PRIORITY_EVERY_NTH).toBeGreaterThan(1)
  })
})
