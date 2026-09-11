import { describe, it, expect } from 'vitest'
import { tallyWorking } from './working'

const now = Date.parse('2026-09-10T20:00:00Z')
const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString()
const ev = (learner: string, type: 'audio_play' | 'audio_failed', build: string, device: string, hoursAgo: number) =>
  ({ learner_id: learner, event_type: type, client_version: build, device_type: device, ip_country: 'GB', occurred_at: at(hoursAgo) })

// Question 7's arithmetic, proven without a database: the failure rate is
// failures over plays plus failures, people are distinct, and the current
// build is the one most people played on in the last day.
describe('is the app working right now', () => {
  it('counts the failure rate over real plays, by day, build and device, people distinct', () => {
    const t = tallyWorking([
      ev('a', 'audio_play', 'v1', 'mobile', 2),
      ev('a', 'audio_play', 'v1', 'mobile', 3),
      ev('a', 'audio_failed', 'v1', 'mobile', 4),
      ev('b', 'audio_play', 'v2', 'desktop', 30),
      { learner_id: 'b', event_type: 'tap_pause', client_version: 'v2', device_type: 'desktop', ip_country: 'GB', occurred_at: at(1) },
    ], now)
    expect(t.people).toBe(2)
    expect(t.overall).toEqual({ plays: 3, failures: 1, people: 2, rate: 0.25 })
    expect(t.byBuild.map((b) => b.build)).toEqual(['v1', 'v2'])
    expect(t.byBuild[0].rate).toBeCloseTo(1 / 3, 3)
    expect(t.byDevice.find((d) => d.device === 'desktop')?.rate).toBe(0)
    expect(t.byDay).toHaveLength(2)
  })

  it('names the build most people were on in the last day, and null when nobody played', () => {
    expect(tallyWorking([
      ev('a', 'audio_play', 'old', 'mobile', 40),
      ev('b', 'audio_play', 'new', 'mobile', 2),
      ev('c', 'audio_play', 'new', 'mobile', 5),
    ], now).currentBuild).toBe('new')
    expect(tallyWorking([], now).currentBuild).toBeNull()
    expect(tallyWorking([], now).overall.rate).toBeNull()
  })
})
