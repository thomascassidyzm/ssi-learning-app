/**
 * Email canonicalisation for IDENTITY — the D4 ruling from
 * docs/identity/india-identity-model-2026-09-03.md as code.
 *
 * Two keys, deliberately different, never interchangeable:
 *
 *   canonicalEmail()      — the EXACT key. The only key that may ever ACT
 *                           (resolve a door onto an account, match against
 *                           learners.verified_emails). lowercase + trim,
 *                           nothing cleverer: a wrong automatic match is the
 *                           irreversible-shaped operation in the system.
 *
 *   emailEquivalenceKey() — the LOOSE key. May only ever SUGGEST ("is this
 *                           also you?" offers, support tooling, abuse keys).
 *                           Folds gmail dots and +tags the same way
 *                           api/_utils/schoolPlatformTrial.ts's
 *                           canonicaliseEmailForBurn does — one inbox is a
 *                           fact about Gmail, not proof of one intended
 *                           account, so it never lands anyone anywhere.
 *
 * Plus the display-layer classification (model §5 rule 2 / D3): an address
 * can NAME an account without ever being SHOWN as "your email". Apple
 * Hide My Email relays are real, forwarding, verified-email-worthy addresses
 * that the person does not recognise; link-auth placeholders are not real
 * addresses at all and must never reach verified_emails
 * (packages/player-vue/src/utils/placeholderEmail.ts is the client twin —
 * keep LINK_AUTH_EMAIL_DOMAIN in sync).
 */

/** Domain Apple mints Hide My Email / Sign in with Apple relays under. */
export const APPLE_RELAY_DOMAIN = 'privaterelay.appleid.com'

/** Placeholder domain for link-auth accounts — see possession-redeem.ts. */
export const LINK_AUTH_EMAIL_DOMAIN = 'invite.saysomethingin.app'

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * The exact identity key: lowercase + trim. Returns '' for anything that is
 * not shaped like an address, so a garbage input can never equal another
 * garbage input and accidentally match.
 */
export function canonicalEmail(email: string | null | undefined): string {
  const trimmed = (email || '').trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return ''
  return trimmed
}

/**
 * The suggestion-only key. Same provider-folding rules as
 * canonicaliseEmailForBurn (drop +tag everywhere; drop local-part dots only
 * on gmail/googlemail where they are genuinely ignored). NEVER use this to
 * resolve, land, alias or merge — offers and evidence only (model D4).
 */
export function emailEquivalenceKey(email: string | null | undefined): string {
  const exact = canonicalEmail(email)
  if (!exact) return ''
  const at = exact.lastIndexOf('@')
  let local = exact.slice(0, at)
  const domain = exact.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, '')
  return local ? `${local}@${domain}` : exact
}

/** An Apple Hide My Email / Sign in with Apple relay address. */
export function isAppleRelayEmail(email: string | null | undefined): boolean {
  const exact = canonicalEmail(email)
  return !!exact && exact.endsWith('@' + APPLE_RELAY_DOMAIN)
}

/** A link-auth placeholder — not a real inbox, never a verified email. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  const exact = canonicalEmail(email)
  return !!exact && exact.endsWith('@' + LINK_AUTH_EMAIL_DOMAIN)
}

export type EmailDisplayClass =
  /** A recognisable address the person typed or proved — show it. */
  | 'displayable'
  /** Real + verified-email-worthy, but the person won't recognise it —
   *  show the door ("Signed in with Apple"), never the address. */
  | 'relay'
  /** Not a real address at all — never display, never verify, never derive
   *  a display name from it. */
  | 'placeholder'
  /** Not an address. */
  | 'invalid'

/**
 * Which layer an address belongs to (model §5 rule 2). Canonical identity
 * and display identity are different layers: relays NAME accounts but are
 * never SHOWN; placeholders do neither.
 */
export function emailDisplayClass(email: string | null | undefined): EmailDisplayClass {
  const exact = canonicalEmail(email)
  if (!exact) return 'invalid'
  if (exact.endsWith('@' + LINK_AUTH_EMAIL_DOMAIN)) return 'placeholder'
  if (exact.endsWith('@' + APPLE_RELAY_DOMAIN)) return 'relay'
  return 'displayable'
}

/** May this address be written to learners.verified_emails? Relays yes
 *  (they are real and proven by the Apple door); placeholders never. */
export function isVerifiedEmailWorthy(email: string | null | undefined): boolean {
  const cls = emailDisplayClass(email)
  return cls === 'displayable' || cls === 'relay'
}
