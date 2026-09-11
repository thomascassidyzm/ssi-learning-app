import { describe, it, expect } from 'vitest'
import { tallyWhereAndWhat, K_FLOOR, FIREHOSE_EVENTS } from './where-and-what'

const ev = (learner: string, country: string | null, device: string | null, shell: string | null) =>
  ({ learner_id: learner, ip_country: country, device_type: device, app_shell: shell })

// Question 8's arithmetic, proven without a database: people are distinct in
// the headline and distinct within each cell, a person seen in two places is
// in both cells, and an unstamped shell reads as not recorded, never as web.
describe('where in the world are people using us, and on what', () => {
  it('counts distinct real people by country, with the device and shell split inside each', () => {
    const t = tallyWhereAndWhat([
      ev('a', 'GB', 'mobile', 'web'),
      ev('a', 'GB', 'mobile', 'web'),
      ev('a', 'GB', 'desktop', 'web'),
      ev('b', 'gb', 'mobile', 'webview'),
      ev('c', 'DE', 'tablet', null),
      ev('d', 'DE', 'mobile', null),
      ev('e', null, 'desktop', null),
      ev('f', null, 'desktop', null),
      ev('g', null, 'desktop', null),
      ev('h', 'GB', 'desktop', 'web'),
    ])
    expect(t.people).toBe(8)
    expect(t.countries).toBe(2)
    expect(t.rows.map((r) => r.country)).toEqual(['GB', 'DE', 'unknown'])
    const gb = t.rows[0]
    expect(gb.people).toBe(3)
    expect(gb.byDevice).toEqual({ mobile: 2, tablet: 0, desktop: 2, unknown: 0 })
    expect(gb.byShell).toEqual({ web: 2, webview: 1, unknown: 0 })
    expect(t.devices).toEqual([
      { device: 'mobile', people: 3 },
      { device: 'tablet', people: 1 },
      { device: 'desktop', people: 5 },
    ])
    expect(t.shells).toEqual([
      { shell: 'web', people: 2 },
      { shell: 'webview', people: 1 },
      { shell: 'unknown', people: 5 },
    ])
    // Three people nobody could place still sort below two placed in Germany.
    expect(t.rows[2]).toMatchObject({ country: 'unknown', people: 3 })
    expect(t.tooFewToSay).toBe(false)
  })

  it('says too few to say under the floor, and skips rows with no person on them', () => {
    const t = tallyWhereAndWhat([ev('a', 'GB', 'mobile', 'web'), ev(null as unknown as string, 'GB', 'mobile', 'web')])
    expect(t.people).toBe(1)
    expect(K_FLOOR).toBe(5)
    expect(t.tooFewToSay).toBe(true)
    expect(tallyWhereAndWhat([]).rows).toEqual([])
  })

  it('leaves the per-cycle firehose out of the read, and nothing else', () => {
    expect([...FIREHOSE_EVENTS]).toEqual(['audio_play', 'audio_failed', 'listening_tick', 'cycle_prosody'])
  })
})
