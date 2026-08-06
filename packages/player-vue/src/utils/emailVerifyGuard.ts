// The "already linked" guard in front of the Settings email-OTP send.
//
// Adding a SECOND email to an account must refuse an address that's already
// linked — sending a code there proves nothing and just confuses. But the
// account's OWN primary email is a different operation: it's the
// receive-capability proof for a possession-onboarded account
// (api/auth/possession-redeem.ts), and verified_emails is NOT evidence for
// it — ensureLearnerExists() in useAuth.ts back-fills the session's own
// email into verified_emails on every load, so a possession account's
// primary is ALWAYS in that list before the user ever presses anything.
//
// Applying the guard uniformly therefore made "Verify now" a dead button:
// it could never send a code for the one address it exists to verify. The
// only real proof is a completed OTP round-trip through api/email/verify.ts,
// which sets user_metadata.email_confirmed_manually — the flag that drives
// isPrimaryUnverified below.
export function isAlreadyLinkedEmail(params: {
  email: string
  primaryEmail: string
  verifiedEmails: string[]
  isPrimaryUnverified: boolean
}): boolean {
  const email = params.email.trim().toLowerCase()
  const primary = params.primaryEmail.trim().toLowerCase()

  // Own primary, still unproven → let it through; this send IS the proof.
  if (params.isPrimaryUnverified && email === primary) return false

  return params.verifiedEmails.some((e) => e.trim().toLowerCase() === email)
}
