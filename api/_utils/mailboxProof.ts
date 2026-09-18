/**
 * The one server-side reading of "has this account ever proved its mailbox?"
 *
 * Mirrors packages/player-vue/src/composables/useMailboxPrompt.ts's
 * isMailboxUnproven, written once for the API: an account minted without mail
 * (api/auth/possession-redeem.ts, api/auth/setup-mint.ts) carries
 * user_metadata.onboarded_via='possession', and only a completed code round
 * trip for its own primary address (api/email/verify.ts) sets
 * email_confirmed_manually. email_confirmed_at is NOT evidence — a
 * server-side magic-link mint sets it without anyone receiving anything.
 */
export function isMailboxUnproven(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false
  return metadata.onboarded_via === 'possession' && metadata.email_confirmed_manually !== true
}
