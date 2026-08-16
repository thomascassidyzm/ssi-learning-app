/**
 * lastKnownIdentity — the signed-in learner the app remembers when it cannot
 * ask the server who they are.
 *
 * Tom's ruling, 2026-08-15, is already quoted at the top of networkGate.ts:
 *
 *   "The heuristic is that the app should always play whatever it has. It
 *    should never allow a weak Internet connection to block the learner. …
 *    Play what you have. Verify access as and when you can. Never as a gate."
 *
 * That ruling governs IDENTITY exactly as it governs audio. He found the gap
 * himself the same evening: signed in, airplane mode, the course plays and the
 * header still shows his account — and the guest-only "Save Progress" nudge
 * appears, because `getSession()` could not complete and useAuth declared a
 * definitive guest. A failed handshake is not evidence of a signed-out person.
 * It is evidence of no network.
 *
 * So: the last identity the server DID confirm is written here, and it is what
 * the UI reflects until the network can confirm or correct it. Verification
 * happens as and when it can, never as a gate.
 *
 * The one direction that would be worse than the bug is a signed-OUT person
 * seeing a stale identity, so this record is cleared eagerly and completely on
 * every definitive sign-out: the explicit signOut(), the SIGNED_OUT event, and
 * the revoked-session teardown in recoverDeadSession. A revoked session is a
 * real sign-out; a timeout is not. useAuth already draws that line and this
 * follows it.
 */

import type { LearnerRecord } from '@ssi/core'

const STORAGE_KEY = 'ssi-last-known-identity'

/** Bump when the stored shape changes — an older record is dropped, not read. */
const SCHEMA_VERSION = 1

export interface LastKnownIdentity {
  /** The learner row the player and account UI actually read. */
  learner: LearnerRecord
  /** Supabase Auth user id (learners.user_id) — kept explicitly for clarity. */
  authUserId: string | null
  /** What the account UI shows; may be absent for a link-auth placeholder. */
  email: string | null
  /** Roles, so router guards and useResolvedSession behave offline too. */
  platformRole: string | null
  educationalRole: string | null
  /** When the server last confirmed this. Reported, never used as an expiry. */
  savedAt: number
}

interface StoredIdentity extends Omit<LastKnownIdentity, 'learner'> {
  v: number
  learner: Omit<LearnerRecord, 'created_at' | 'updated_at'> & {
    created_at: string
    updated_at: string
  }
}

/**
 * Persist the identity the server has just confirmed.
 *
 * Deliberately not an expiring cache. There is no honest TTL for "who is this
 * person" — a learner who has been offline for a fortnight is still the same
 * learner, and expiring the record would just reintroduce the bug on a delay.
 * It is cleared by sign-out, not by time.
 */
export function writeLastKnownIdentity(input: {
  learner: LearnerRecord
  authUserId: string | null
  email: string | null
  platformRole: string | null
  educationalRole: string | null
}): void {
  try {
    const stored: StoredIdentity = {
      v: SCHEMA_VERSION,
      learner: {
        ...input.learner,
        created_at: toIso(input.learner.created_at),
        updated_at: toIso(input.learner.updated_at),
      },
      authUserId: input.authUserId,
      email: input.email,
      platformRole: input.platformRole,
      educationalRole: input.educationalRole,
      savedAt: Date.now(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    /* storage blocked or quota-full — the app degrades to today's behaviour */
  }
}

/** The last confirmed identity, or null if there has never been one. */
export function readLastKnownIdentity(): LastKnownIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredIdentity
    // A record without a real learner id is useless to every consumer —
    // learnerId, the progress writes, the account UI — so treat it as absent
    // rather than hand back half an identity.
    if (parsed?.v !== SCHEMA_VERSION || !parsed.learner?.id || !parsed.learner?.user_id) {
      return null
    }
    return {
      learner: {
        ...parsed.learner,
        created_at: new Date(parsed.learner.created_at),
        updated_at: new Date(parsed.learner.updated_at),
      },
      authUserId: parsed.authUserId ?? parsed.learner.user_id,
      email: parsed.email ?? null,
      platformRole: parsed.platformRole ?? null,
      educationalRole: parsed.educationalRole ?? null,
      savedAt: parsed.savedAt ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * Forget the remembered identity. Called on every definitive sign-out —
 * alongside purgeSupabaseAuthStorage(), never instead of it.
 */
export function clearLastKnownIdentity(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage blocked — nothing to clear */
  }
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  // Supabase hands back ISO strings; toLearnerRecord normally wraps them in a
  // Date, but a caller that skipped that must not poison the record.
  return new Date(value).toISOString()
}
