// Link-auth (straight-in) invite accounts are minted against a unique
// placeholder address at this domain — see api/auth/possession-redeem.ts
// (LINK_AUTH_EMAIL_DOMAIN). When a teacher/admin/leader clicks their invite
// link, the link itself is the credential and they're signed straight in with
// no form; a brand-new user has no email to give at that moment, so the
// account carries a placeholder until they add + verify a real one on first
// run (SettingsScreen.vue + api/email/verify.ts).
//
// The placeholder NEVER receives mail and must never surface as the user's
// real email: not in display, not derived into a display name, not written to
// verified_emails. This guard is the single client-side test for that. Keep
// the domain string in sync with the server constant.
export const LINK_AUTH_EMAIL_DOMAIN = 'invite.saysomethingin.app'

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith('@' + LINK_AUTH_EMAIL_DOMAIN)
}
