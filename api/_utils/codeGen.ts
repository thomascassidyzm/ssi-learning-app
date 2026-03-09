/**
 * Shared code generation utility
 *
 * Generates ABC-123 format codes (3 consonants + hyphen + 3 digits).
 * Used by both invite codes and entitlement codes.
 */

// Consonants only, excluding I and O (confusable with 1 and 0)
const CODE_CONSONANTS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateCode(): string {
  let letters = ''
  for (let i = 0; i < 3; i++) {
    letters += CODE_CONSONANTS[Math.floor(Math.random() * CODE_CONSONANTS.length)]
  }
  let digits = ''
  for (let i = 0; i < 3; i++) {
    digits += Math.floor(Math.random() * 10).toString()
  }
  return `${letters}-${digits}`
}
