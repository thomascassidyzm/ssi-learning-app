/**
 * The staleness comparison, tested in BOTH directions — a check only ever seen
 * green is not a check. The two failures that matter are opposites:
 *
 *   - a stale APK that says nothing (the defect this cures), and
 *   - a current app that claims it is behind (worse than the silence it
 *     replaces, and already shipped once as the permanent false "Update
 *     available" — see SettingsScreen.vue's shaPrefixEq comment).
 */
import { describe, it, expect } from 'vitest'
import { isProvablyStale, normaliseBuildId, shaPrefixEq } from './buildStaleness'

const EARLIER = '2026-09-04T07:26:00.000Z'
const LATER = '2026-09-04T20:31:00.000Z'

describe('normaliseBuildId', () => {
  it('strips the local- prefix and the -dirty suffix', () => {
    expect(normaliseBuildId('local-1a2b3c4')).toBe('1a2b3c4')
    expect(normaliseBuildId('local-1a2b3c4-dirty')).toBe('1a2b3c4')
    expect(normaliseBuildId('1a2b3c4')).toBe('1a2b3c4')
  })

  it('is empty for a missing id', () => {
    expect(normaliseBuildId(null)).toBe('')
    expect(normaliseBuildId(undefined)).toBe('')
  })
})

describe('shaPrefixEq', () => {
  it('matches the same commit recorded at different lengths', () => {
    expect(shaPrefixEq('1a2b3c4', '1a2b3c45')).toBe(true)
  })

  it('does not match different commits', () => {
    expect(shaPrefixEq('1a2b3c4', '9f8e7d6')).toBe(false)
  })

  it('is false when either side is missing', () => {
    expect(shaPrefixEq('1a2b3c4', null)).toBe(false)
    expect(shaPrefixEq(null, '1a2b3c4')).toBe(false)
  })
})

describe('isProvablyStale — SAYS SO when it can prove it', () => {
  it('fires for a bundled build older than the live one', () => {
    expect(isProvablyStale(
      { buildNumber: 'local-ccbbe2f', buildTime: EARLIER },
      { buildNumber: 'bb0dffd8', buildTime: LATER },
    )).toBe(true)
  })

  it('fires for a deployed build older than the live one', () => {
    expect(isProvablyStale(
      { buildNumber: 'ccbbe2f7', buildTime: EARLIER },
      { buildNumber: 'bb0dffd', buildTime: LATER },
    )).toBe(true)
  })
})

describe('isProvablyStale — STAYS QUIET otherwise', () => {
  it('is quiet on the same commit, local build against its deployment', () => {
    expect(isProvablyStale(
      { buildNumber: 'local-bb0dffd', buildTime: LATER },
      { buildNumber: 'bb0dffd', buildTime: LATER },
    )).toBe(false)
  })

  it('is quiet when a dirty local build matches the live commit', () => {
    expect(isProvablyStale(
      { buildNumber: 'local-bb0dffd-dirty', buildTime: LATER },
      { buildNumber: 'bb0dffd', buildTime: LATER },
    )).toBe(false)
  })

  it('is quiet when the same tree was simply rebuilt later', () => {
    // Identical commit, later timestamp — a rebuild, not a newer version.
    expect(isProvablyStale(
      { buildNumber: 'local-bb0dffd', buildTime: EARLIER },
      { buildNumber: 'bb0dffd', buildTime: LATER },
    )).toBe(false)
  })

  it('is quiet when OUR build is the newer one', () => {
    // The APK cut tonight against this morning's deployment. Telling its
    // holder to go and install an older build is the nastiest false alarm.
    expect(isProvablyStale(
      { buildNumber: 'local-bb0dffd', buildTime: LATER },
      { buildNumber: 'ccbbe2f7', buildTime: EARLIER },
    )).toBe(false)
  })

  it('is quiet when the ids differ but neither timestamp is usable', () => {
    // DIFFERENT IS NOT NEWER — with no clock to compare we know only that the
    // builds disagree, which is not grounds to tell anyone they are behind.
    expect(isProvablyStale(
      { buildNumber: 'local-ccbbe2f', buildTime: EARLIER },
      { buildNumber: 'bb0dffd8', buildTime: null },
    )).toBe(false)
    expect(isProvablyStale(
      { buildNumber: 'local-ccbbe2f', buildTime: 'not a date' },
      { buildNumber: 'bb0dffd8', buildTime: LATER },
    )).toBe(false)
  })

  it('is quiet when the live build could not be read at all', () => {
    // Offline, endpoint down, unparseable answer. The inverse of
    // isDifferentBuild()'s deliberate fail-open.
    expect(isProvablyStale({ buildNumber: 'local-ccbbe2f', buildTime: EARLIER }, null)).toBe(false)
    expect(isProvablyStale({ buildNumber: 'local-ccbbe2f', buildTime: EARLIER }, {})).toBe(false)
  })

  it('is quiet when WE have no build id', () => {
    expect(isProvablyStale({ buildTime: EARLIER }, { buildNumber: 'bb0dffd8', buildTime: LATER })).toBe(false)
  })

  it('is quiet inside the clock tolerance', () => {
    expect(isProvablyStale(
      { buildNumber: 'aaaaaaa', buildTime: '2026-09-04T20:00:00.000Z' },
      { buildNumber: 'bbbbbbb', buildTime: '2026-09-04T20:04:00.000Z' },
    )).toBe(false)
  })
})
