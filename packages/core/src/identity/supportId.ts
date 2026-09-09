/**
 * supportId — the short thing a learner can read out to support.
 *
 * The problem it solves (Tom, 2026-09-09): sign-in is a code to an email
 * address and there are no passwords, so a learner who cannot remember which
 * address they used is stuck, and support cannot tell who they are either.
 * If they can open the app, the app already knows — this is the shortest
 * sayable name for the account it already holds.
 *
 * WHAT IT IS. The first 40 bits of the learner's own id, written in Crockford
 * base32: eight characters, shown as two groups of four. Crockford's alphabet
 * has no I, L, O or U, so nothing in it can be misheard as anything else in
 * it, and its decoder forgives the two mistakes people still make out loud —
 * O read back as 0, I or L read back as 1.
 *
 * WHAT IT IS NOT. It is not a credential and it authorises nothing. No route,
 * no policy and no check anywhere reads it to decide what somebody may do; it
 * is a NAME for an account, in exactly the way an email address is. It is
 * derived rather than stored, so there is no new column, no backfill and
 * nothing to keep in step — and because it is a straight prefix of the id,
 * support can turn it back into a range and look the account up directly
 * rather than scanning every learner to find a match.
 *
 * Forty bits is one in a thousand billion. Two accounts sharing a code is
 * possible and harmless: the lookup hands support both, and they ask.
 */

/** Crockford base32 — no I, L, O or U, so no two symbols sound alike. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** How much of the id the code carries: 10 hex digits = 40 bits = 8 symbols. */
const HEX_DIGITS = 10
const CODE_LENGTH = 8

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The support identifier for a learner id, e.g. "7HQ2-9KFB".
 * Returns null for anything that is not a uuid, so a caller never renders a
 * confident-looking code derived from a placeholder or an empty string.
 */
export function supportIdForLearnerId(learnerId: string | null | undefined): string | null {
  if (!learnerId || !UUID_RE.test(learnerId)) return null
  const hex = learnerId.replace(/-/g, '').slice(0, HEX_DIGITS)
  let bits = BigInt('0x' + hex)
  const out: string[] = []
  for (let i = 0; i < CODE_LENGTH; i++) {
    out.unshift(ALPHABET[Number(bits & 31n)])
    bits >>= 5n
  }
  return out.join('').slice(0, 4) + '-' + out.join('').slice(4)
}

/**
 * Undo the above, as far as it goes: a support code back to the hex prefix of
 * the learner id it came from, or null if the code is not one of ours.
 *
 * Forgiving on input because the code arrives by ear or by copy-paste —
 * lower case, spaces, the hyphen missing, and the classic O-for-0 and
 * I-or-L-for-1 mishearings all resolve to the same account.
 */
export function learnerIdPrefixFromSupportId(code: string | null | undefined): string | null {
  if (!code) return null
  const cleaned = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (cleaned.length !== CODE_LENGTH) return null
  let bits = 0n
  for (const ch of cleaned) {
    const value = ALPHABET.indexOf(ch)
    if (value < 0) return null
    bits = (bits << 5n) | BigInt(value)
  }
  return bits.toString(16).padStart(HEX_DIGITS, '0')
}

/**
 * The inclusive uuid range every learner id with that prefix falls in, so a
 * lookup is an indexed range read rather than a scan-and-compute over every
 * account. Null when the code is not one of ours.
 */
export function learnerIdRangeFromSupportId(
  code: string | null | undefined,
): { low: string; high: string } | null {
  const prefix = learnerIdPrefixFromSupportId(code)
  if (!prefix) return null
  const build = (fill: string) => {
    const hex = prefix + fill.repeat(32 - HEX_DIGITS)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return { low: build('0'), high: build('f') }
}
