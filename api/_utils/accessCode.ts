/**
 * Staff access codes — the short, typeable way back in.
 *
 * The design constraint that produced this file, from Tom's ruling
 * (2026-09-02): the code is handed over OUT OF BAND. Pasted into Teams, read
 * off a screen, said out loud across a staffroom, printed on a slip. Our email
 * is exactly the channel it must not need, because at Hwb and Microsoft
 * education tenants our email is the thing that never arrives.
 *
 * So the artefact has to survive a human eye and a human voice, which a
 * ~200-character Supabase `action_link` does not. Everything below is in
 * service of that:
 *
 *   ALPHABET — Crockford base32 minus its two digits that a person still has
 *   to think about. `0` and `1` are gone, and with them the O/0 and I/l/1
 *   collisions that make a printed code a guessing game; `I`, `L`, `O` and `U`
 *   were already absent from Crockford. What remains cannot be misread as
 *   anything else in the set.
 *
 *   LENGTH — 8 characters, shown as two groups of four. 30^8 ≈ 6.6e11
 *   combinations against a 48-hour, single-use, IP-throttled window: guessing
 *   is not a route. Two groups of four is what a person can hold in their head
 *   long enough to type it.
 *
 *   NORMALISATION is forgiving where forgiveness is free — case, spaces,
 *   hyphens, and the excluded lookalikes a well-meaning reader might still
 *   type (`O`→ rejected rather than silently remapped, because there is no
 *   `0` in the alphabet to remap it to; see normaliseAccessCode).
 *
 * The code itself is NEVER stored. Only its sha256 goes to the database, so
 * nobody reading the table — including us — can lift a live credential out of
 * it.
 */

import { createHash, randomInt } from 'crypto'

/**
 * Crockford base32 without `0` and `1`. No character in this set can be
 * confused with another one in it.
 */
export const ACCESS_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

export const ACCESS_CODE_LENGTH = 8

/** Tom's ruling was "a day or two". Two. */
export const ACCESS_CODE_TTL_MS = 48 * 60 * 60 * 1000

/**
 * A fresh code. `randomInt` is the CSPRNG-backed one — `Math.random()` in a
 * credential generator is the bug we are not writing (cf. the join-code
 * hardening, migration 20260822_join_code_csprng_and_grant_lockdown).
 *
 * Rejection is not needed: randomInt(n) is uniform over [0, n) by construction,
 * so a 30-character alphabet carries no modulo bias.
 */
export function generateAccessCode(): string {
  let out = ''
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) {
    out += ACCESS_CODE_ALPHABET[randomInt(ACCESS_CODE_ALPHABET.length)]
  }
  return out
}

/**
 * What a person typed → what we look up, or null if it cannot be a code.
 *
 * Forgives case, spaces, hyphens and any other punctuation a person adds while
 * transcribing. Does NOT forgive a character outside the alphabet: since `0`,
 * `1`, `I`, `L`, `O` and `U` are never generated, a code containing one was
 * mistyped, and silently remapping it would turn a typo into a wrong-code
 * lookup that reports "expired or already used" — a far more confusing answer
 * than "check that code again".
 */
export function normaliseAccessCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (cleaned.length !== ACCESS_CODE_LENGTH) return null
  for (const ch of cleaned) {
    if (!ACCESS_CODE_ALPHABET.includes(ch)) return null
  }
  return cleaned
}

/** The only form that ever reaches the database. */
export function hashAccessCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** `ABCD-EFGH` — how it is shown to the admin and printed on a slip. */
export function formatAccessCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * The whole artefact the admin hands over: a short URL that carries the code,
 * for whoever has a channel that can take a link, and the code on its own for
 * whoever is reading it aloud. `/join` is deliberately the shortest path we
 * could give it.
 */
export function accessCodeUrl(origin: string, code: string): string {
  return `${origin}/join/${formatAccessCode(code)}`
}
