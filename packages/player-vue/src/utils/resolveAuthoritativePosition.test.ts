/**
 * resolveAuthoritativePosition — the position authority ruling
 * (docs/pwa-lifecycle-design.md §2.3). Enumerates the live data states
 * per the design's mandate before this was wired into resolveStartLegoId
 * (the 5f4a8b1d lesson: sweeps/guards fail on the rows you didn't picture).
 */

import { describe, it, expect } from 'vitest'
import { resolveAuthoritativePosition } from './resolveAuthoritativePosition'

describe('resolveAuthoritativePosition', () => {
  it('both null — genuinely fresh learner, no position anywhere', () => {
    expect(resolveAuthoritativePosition(null, null)).toEqual({ legoId: null, source: 'none' })
    expect(
      resolveAuthoritativePosition(
        { legoId: null, lastUpdated: null },
        { cursorLegoId: null, lastPracticedAt: null },
      ),
      // Different from resolveAuthoritativePosition(null, null): an
      // enrollment row WAS consulted here, it just has nothing to say.
    ).toEqual({ legoId: null, source: 'server' })
  })

  it('null cursor + fresh local — nothing on the server to compare against, local wins', () => {
    expect(
      resolveAuthoritativePosition(
        { legoId: 'S0010L01', lastUpdated: 1_000 },
        { cursorLegoId: null, lastPracticedAt: null },
      ),
    ).toEqual({ legoId: 'S0010L01', source: 'local' })
  })

  it('fresh cursor + no local — nothing cached on this device, server wins', () => {
    expect(
      resolveAuthoritativePosition(
        null,
        { cursorLegoId: 'S0010L01', lastPracticedAt: 1_000 },
      ),
    ).toEqual({ legoId: 'S0010L01', source: 'server' })
  })

  it('fresh cursor + stale local — server wins (local behind)', () => {
    expect(
      resolveAuthoritativePosition(
        { legoId: 'S0002L01', lastUpdated: 1_000 },
        { cursorLegoId: 'S0010L01', lastPracticedAt: 2_000 },
      ),
    ).toEqual({ legoId: 'S0010L01', source: 'server' })
  })

  it('local strictly fresher than server — local wins (offline continuation)', () => {
    expect(
      resolveAuthoritativePosition(
        { legoId: 'S0012L01', lastUpdated: 5_000 },
        { cursorLegoId: 'S0010L01', lastPracticedAt: 2_000 },
      ),
    ).toEqual({ legoId: 'S0012L01', source: 'local' })
  })

  it('exact tie — server wins (not strictly fresher)', () => {
    expect(
      resolveAuthoritativePosition(
        { legoId: 'S0010L01', lastUpdated: 2_000 },
        { cursorLegoId: 'S0010L01', lastPracticedAt: 2_000 },
      ),
    ).toEqual({ legoId: 'S0010L01', source: 'server' })
  })

  it('null last_practiced_at with a real cursor — server counts as maximally fresh, wins', () => {
    expect(
      resolveAuthoritativePosition(
        { legoId: 'S0002L01', lastUpdated: 999_999_999 },
        { cursorLegoId: 'S0010L01', lastPracticedAt: null },
      ),
    ).toEqual({ legoId: 'S0010L01', source: 'server' })
  })

  it('local with no lastUpdated timestamp never beats a stamped server row', () => {
    expect(
      resolveAuthoritativePosition(
        { legoId: 'S0002L01', lastUpdated: null },
        { cursorLegoId: 'S0010L01', lastPracticedAt: 1_000 },
      ),
    ).toEqual({ legoId: 'S0010L01', source: 'server' })
  })

  it('guest / no enrollment row consulted — local wins outright (fail-to-local)', () => {
    expect(
      resolveAuthoritativePosition({ legoId: 'S0005L01', lastUpdated: 1_000 }, null),
    ).toEqual({ legoId: 'S0005L01', source: 'local' })
  })

  it('guest with nothing cached either — none', () => {
    expect(resolveAuthoritativePosition({ legoId: null, lastUpdated: null }, null)).toEqual({
      legoId: null,
      source: 'none',
    })
  })

  it('brand-new enrollment row (never practiced under this account) does not override carried-over guest progress', () => {
    // A guest played locally, then signed up: migrateGuestProgress()
    // leaves the local position key untouched and creates a fresh
    // enrollment row (cursor null, never stamped — genuinely distinct
    // from a reset, which always stamps last_practiced_at post-fix).
    // The local cache is the only real signal and must win.
    expect(
      resolveAuthoritativePosition(
        { legoId: 'S0004L02', lastUpdated: 12_000 },
        { cursorLegoId: null, lastPracticedAt: null },
      ),
    ).toEqual({ legoId: 'S0004L02', source: 'local' })
  })

  describe('T10 — reset stays reset', () => {
    it('reset on this device: local key survives the reset but the server was stamped fresh — server wins', () => {
      // Reset happened at t=10_000 (stamps last_practiced_at to "now" and
      // nulls the cursor); the stale local save from BEFORE the reset is
      // still sitting at t=5_000 because something (a race, a missed
      // clear) left it behind.
      expect(
        resolveAuthoritativePosition(
          { legoId: 'S0030L02', lastUpdated: 5_000 },
          { cursorLegoId: null, lastPracticedAt: 10_000 },
        ),
      ).toEqual({ legoId: null, source: 'server' })
    })

    it('reset with the local key actually cleared (the shipped fix) — both null, fresh start', () => {
      expect(
        resolveAuthoritativePosition(
          { legoId: null, lastUpdated: null },
          { cursorLegoId: null, lastPracticedAt: 10_000 },
        ),
      ).toEqual({ legoId: null, source: 'server' })
    })
  })

  describe('cross-device', () => {
    it('device A played, then reset happens on device B — device A adopts the reset', () => {
      // Device A's local cache still holds its own last play (t=8_000);
      // device B's reset stamped the server to t=20_000, strictly newer.
      expect(
        resolveAuthoritativePosition(
          { legoId: 'S0040L01', lastUpdated: 8_000 },
          { cursorLegoId: null, lastPracticedAt: 20_000 },
        ),
      ).toEqual({ legoId: null, source: 'server' })
    })

    it('phone plays ahead of tablet — tablet follows the phone on next resume', () => {
      // Tablet's stale local cache (last played there at t=1_000) loses to
      // the phone's more recent server writes (t=9_000).
      expect(
        resolveAuthoritativePosition(
          { legoId: 'S0006L01', lastUpdated: 1_000 },
          { cursorLegoId: 'S0020L03', lastPracticedAt: 9_000 },
        ),
      ).toEqual({ legoId: 'S0020L03', source: 'server' })
    })

    it('played offline on this device ahead of the last sync — local wins, offline unharmed', () => {
      expect(
        resolveAuthoritativePosition(
          { legoId: 'S0021L01', lastUpdated: 9_500 },
          { cursorLegoId: 'S0020L03', lastPracticedAt: 9_000 },
        ),
      ).toEqual({ legoId: 'S0021L01', source: 'local' })
    })
  })
})
