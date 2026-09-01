import { describe, it, expect } from 'vitest'
import { orderOfflineDownloadTiers } from './offlineDownloadOrder'

describe('orderOfflineDownloadTiers', () => {
  it('emits the tiers in the order they are declared', () => {
    expect(orderOfflineDownloadTiers(['h1'], ['p1', 'p2'], ['c1'], ['a1'])).toEqual(
      ['h1', 'p1', 'p2', 'c1', 'a1'],
    )
  })

  it('dedupes to the EARLIEST tier, so a shared id keeps its highest priority', () => {
    // Pod clips are legitimately enumerated twice — once as pod content, once
    // inside the wider auxiliary bundle. The pod copy must win the position.
    expect(orderOfflineDownloadTiers(['p1'], ['c1'], ['p1', 'a1'])).toEqual(['p1', 'c1', 'a1'])
  })

  it('keeps an interrupted download complete on the earlier tiers', () => {
    const pods = ['p1', 'p2', 'p3']
    const course = Array.from({ length: 100 }, (_, i) => `c${i}`)
    const ordered = orderOfflineDownloadTiers([], pods, course, [])
    // Whatever prefix a disconnect leaves, once it is past the pod tier every
    // pod clip is in it — the whole point of the priority.
    expect(ordered.slice(0, pods.length)).toEqual(pods)
    expect(ordered.indexOf('c0')).toBeGreaterThan(ordered.indexOf('p3'))
  })

  it('handles empty tiers without leaving holes', () => {
    expect(orderOfflineDownloadTiers([], ['c1'], [], ['a1'])).toEqual(['c1', 'a1'])
  })
})
