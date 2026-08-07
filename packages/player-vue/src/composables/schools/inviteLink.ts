/**
 * inviteLink — the ONE place an invite URL is built, and the one place that
 * decides a code is real enough to hand to a human.
 *
 * Why it exists: on production (2026-08-07) a cover teacher's class page
 * rendered `https://saysomethingin.app/redeem/` — the join code was missing
 * because an unrelated view timed out, and the template interpolated the empty
 * string straight into the link. She would have copied that and given it to a
 * class of pupils. A dead invite link is worse than no invite link, because it
 * gets handed out before anyone discovers it goes nowhere.
 *
 * Rule: a link is either COMPLETE or it does not exist. `redeemLink` returns
 * null for anything that isn't a real code, and every caller renders the panel
 * only when it gets a string back.
 */

/** Placeholders our composables use for "no code" — never a real invite code. */
const NON_CODES = new Set(['n/a', 'na', 'none', 'null', 'undefined', '-'])

/**
 * `null` unless `code` is a genuine invite code.
 * Pass `origin` in tests; it defaults to the current page origin.
 */
export function redeemLink(
  code: string | null | undefined,
  origin: string = typeof window === 'undefined' ? '' : window.location.origin,
): string | null {
  const clean = (code ?? '').trim()
  if (!clean) return null
  if (NON_CODES.has(clean.toLowerCase())) return null
  if (!origin) return null
  return `${origin.replace(/\/+$/, '')}/redeem/${clean}`
}

/** The bare code, or null — same honesty rule, for "show the code instead". */
export function displayableCode(code: string | null | undefined): string | null {
  const clean = (code ?? '').trim()
  if (!clean || NON_CODES.has(clean.toLowerCase())) return null
  return clean
}
