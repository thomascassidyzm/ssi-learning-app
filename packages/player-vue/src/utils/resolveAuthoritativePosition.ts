/**
 * resolveAuthoritativePosition — the position authority ruling
 * (docs/pwa-lifecycle-design.md §2.3, 2026-07-09).
 *
 * For a signed-in learner, `course_enrollments` is THE authority for
 * position; `ssi_learning_position_<course>` (localStorage) is a device
 * CACHE of the same fact, trusted only when it is strictly fresher than
 * the server's `last_practiced_at`. This is what dissolves the
 * resurrection bug: reset nulled the DB cursor but left the local key
 * behind, so local-first resume + the forward-only ratchet re-wrote the
 * old position into the DB hours later. Under this rule reset instead
 * STAMPS `last_practiced_at` to "now" (see SettingsScreen.vue confirmReset)
 * so the server always wins the comparison post-reset — the resurrection
 * closes without a special case here.
 *
 * `enrollment === null` means no server row was consulted at all (guest,
 * fetch timed out, fetch errored, offline) — local is the only signal
 * available and wins by default. This is fail-to-local, not fail-open:
 * it preserves exactly the behaviour offline/guest resume already had
 * before this ruling.
 */

export interface LocalPositionSnapshot {
  /** The LEGO id saved to localStorage, or null if nothing usable is cached. */
  legoId: string | null
  /** Epoch ms the local save was last touched by real practice; null if unknown/untouched. */
  lastUpdated: number | null
}

export interface EnrollmentPositionSnapshot {
  /** `course_enrollments.last_completed_lego_id` — the server cursor. */
  cursorLegoId: string | null
  /** `course_enrollments.last_practiced_at`, as epoch ms; null if never stamped. */
  lastPracticedAt: number | null
}

export type PositionSource = 'server' | 'local' | 'none'

export interface AuthoritativePosition {
  legoId: string | null
  source: PositionSource
}

export function resolveAuthoritativePosition(
  local: LocalPositionSnapshot | null,
  enrollment: EnrollmentPositionSnapshot | null,
): AuthoritativePosition {
  const hasLocal = !!local?.legoId

  // No server row consulted — guest, offline, timed-out fetch, or a
  // learner with no enrollment row yet. Local is the only source; fail
  // to it exactly as resume always has when there was nothing to compare.
  if (!enrollment) {
    return hasLocal ? { legoId: local!.legoId, source: 'local' } : { legoId: null, source: 'none' }
  }

  // Nothing cached on this device — whatever the server says stands,
  // even a null cursor (no local fallback to consider).
  if (!hasLocal) {
    return { legoId: enrollment.cursorLegoId, source: 'server' }
  }

  // Has this enrollment row EVER been written to by a real event (a
  // cursor write, or a reset's freshness stamp)? A reset nulls the
  // cursor but stamps last_practiced_at to "now" — that IS a real
  // signal ("you were reset") and must not be confused with a row that
  // has simply never been touched (a brand-new signup, e.g. a guest who
  // just created an account — their local key still holds the real
  // carried-over guest progress and nothing server-side has any
  // standing to override it yet).
  const hasServerSignal = enrollment.cursorLegoId !== null || enrollment.lastPracticedAt !== null
  if (!hasServerSignal) {
    return { legoId: local!.legoId, source: 'local' }
  }

  // Both have a real signal — local wins ONLY when strictly fresher than
  // the server's last-practice stamp. A null server timestamp alongside
  // a real cursor counts as "server is maximally fresh" (protects an
  // unstamped-but-real cursor from ever losing to a stale local guess).
  const localTs = local!.lastUpdated
  const serverTs = enrollment.lastPracticedAt
  if (localTs !== null && serverTs !== null && localTs > serverTs) {
    return { legoId: local!.legoId, source: 'local' }
  }
  return { legoId: enrollment.cursorLegoId, source: 'server' }
}
