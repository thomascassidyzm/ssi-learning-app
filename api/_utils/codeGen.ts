/**
 * Shared code generation utility
 *
 * Generates ABC-123 format codes (3 consonants + hyphen + 3 digits).
 * Used by both invite codes and entitlement codes.
 */

import { randomBytes, randomInt } from 'crypto'

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
