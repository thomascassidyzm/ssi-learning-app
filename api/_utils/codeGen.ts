/**
 * Shared code generation utility
 *
 * Generates ABC-123 format codes (3 consonants + hyphen + 3 digits).
 * Used by both invite codes and entitlement codes.
 */

import { createHash, randomBytes, randomInt } from 'crypto'

// Consonants only, excluding I and O (confusable with 1 and 0)
const CODE_CONSONANTS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateCode(): string {
  // Uses the CSPRNG crypto.randomInt (not a predictable PRNG): these codes gate
  // elevated educational_role grants (teacher/school_admin/govt_admin) into a
  // school/group on redemption, so their minting must not be predictable from
  // observed samples. randomInt is uniform over [0, n) and cryptographically
  // secure. Format is unchanged (ABC-123).
  let letters = ''
  for (let i = 0; i < 3; i++) {
    letters += CODE_CONSONANTS[randomInt(CODE_CONSONANTS.length)]
  }
  let digits = ''
  for (let i = 0; i < 3; i++) {
    digits += randomInt(10).toString()
  }
  return `${letters}-${digits}`
}

/**
 * 128-bit random, URL-safe share code (board_snapshots.share_code) — the
 * try-link capability-by-unguessability model: not sequential, not derived
 * from any label, unguessable by construction.
 */
export function generateShareCode(): string {
  return randomBytes(16)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * SEC25-X-03 / ADMIN-ENT-03 — the keyspace split.
 *
 * ABC-123 is 24^3 x 10^3 = 13,824,000, i.e. ~23.7 bits. That is the right
 * trade for a code a teacher reads aloud to a room of children: it is short
 * enough to say, and the thing it grants is membership of one class. It is the
 * WRONG trade for a code that grants staff or platform authority, because
 * api/code/redeem.ts turns a correct guess straight into a role — and nobody
 * has ever read an `ssi_admin` code off a whiteboard.
 *
 * So the set below is exactly "code types that grant authority over other
 * people's accounts or data":
 *   ssi_admin, god   — full platform privilege (`learners.platform_role`)
 *   govt_admin       — tenant-level administrative authority across schools
 *   school_admin, school_admin_join — administrative authority over one school
 *   teacher          — roster and progress access to a class of children
 * Deliberately NOT included: `student`, `tester`, and the class join codes
 * minted in the database by `public.generate_join_code()` — those are the
 * read-aloud population, and shortening them is the whole point of the format.
 */
export const PRIVILEGED_CODE_TYPES = new Set([
  'ssi_admin',
  'god',
  'govt_admin',
  'school_admin',
  'school_admin_join',
  'teacher',
])

/**
 * True for a code value drawn from the 128-bit keyspace rather than the
 * human-typeable one. Deliberately shape-based (there is no column recording
 * which minter produced a row): an ABC-123 code is exactly 7 characters in a
 * fixed pattern, and a base64url 128-bit code is 22 characters from a wider
 * alphabet, so the two can never be confused.
 */
export function isStrongCodeFormat(code: string): boolean {
  return !/^[A-Z]{3}-[0-9]{3}$/.test(code.trim().toUpperCase())
}

/**
 * The one minter every invite-code call site should use. Privileged types get
 * 128 bits; everything else keeps the human-typeable ABC-123 format.
 */
export function generateCodeForType(codeType: string): string {
  return PRIVILEGED_CODE_TYPES.has(codeType) ? generateShareCode() : generateCode()
}

/**
 * AUTH-CORE-09 — a log-safe stand-in for a code value.
 *
 * An invite code is a bearer credential: api/auth/possession-redeem.ts turns
 * one into a session with no other proof, so a code sitting in stdout is a
 * credential sitting in whatever reads stdout (Vercel's log drain, anyone with
 * project log access, any downstream aggregator). The operational reason those
 * console.log lines exist is correlation — "is THIS the code that keeps
 * failing?" — which a stable digest serves exactly as well as the value.
 *
 * Truncated sha256, so the same code always renders the same token and no
 * token can be walked back to a code.
 */
export function redactCode(code: unknown): string {
  if (typeof code !== 'string' || !code) return 'code#none'
  return `code#${createHash('sha256').update(code).digest('hex').slice(0, 8)}`
}
