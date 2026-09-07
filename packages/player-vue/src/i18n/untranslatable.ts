/**
 * The allowlist: user-visible strings that are deliberately NOT translated.
 *
 * Every entry needs a reason on the line above it. That rule is the whole
 * point — an allowlist that grows without reasons stops being a judgement and
 * becomes a place to hide defects, and then the gate it guards gets deleted.
 * If you cannot write the reason in one line, the string wants a t() key.
 *
 * Matching is exact on the trimmed, whitespace-collapsed text.
 */
export const UNTRANSLATABLE: readonly string[] = [
  // The wordmark. Already settled: commit 763e35d4, "the wordmark is a name,
  // not a phrase — English in all 22 locales". A name does not get translated.
  'Say Something in',
  'SaySomethingin',
  'SaySomethingIn',
  'SSi',

  // Product tier names built on the brand mark. "SSi Premium" and "SSi
  // Schools" name a thing you buy; translating the noun beside a brand mark
  // invents a different product name in every market, which is the same
  // reasoning as the wordmark two lines up. Keyed in the templates so a
  // locale COULD carry them, and copied verbatim into every locale by
  // tools/i18n/fill.mjs because of this entry.
  'SSi Premium',

  // Registered company name and address. A legal address is an address; it is
  // the same characters in Hindi as in English or the post does not arrive.
  '© 2026 SaySomethingIn Cyf · Glaslyn, Ffordd y Parc, Bangor, Gwynedd LL57 4FE, Wales',

  // Support mailbox — an address, not a phrase.
  'admin@saysomethingin.com',
  'admin@saysomethingin.com .',

  // Placeholder email addresses shown greyed inside empty inputs. Translating
  // the domain would invent a real-looking address that isn't ours.
  'you@example.com',
  'email@example.com',
  'another@example.com',

  // The confirmation word the learner must type to delete an account. The code
  // compares the input against the literal string "DELETE"; translate the
  // placeholder and nobody can ever confirm.
  'DELETE',

  // Shape-of-the-code examples in a code input. They show the FORMAT
  // (letters-digits, four-four); the letters carry no meaning to translate.
  'ABC-123',
  'ABCD-EFGH',

  // IANA timezone identifiers in the school's Localisation picker. They are
  // machine identifiers with a fixed spelling — a school in Tokyo picks
  // "Europe/London" by those exact characters, and a translated one selects
  // nothing.
  'Europe/London',
  'Europe/Paris',
  'Europe/Dublin',
  'America/New York',
  'America/Los Angeles',

  // Database table and cron-job names, shown in <code> on the insights panels
  // so a leader can quote the exact identifier when asking us about a gap.
  // Translate one and the name no longer names anything.
  'insight-discovery',
  'cycle_prosody',
  'player_events',

  // The decibel unit symbol. An SI-style symbol, the same characters in every
  // language — and the number beside it is meaningless if it moves.
  'dB',

  // The text-size control's glyph. "Aa" is a typographic specimen, drawn to be
  // looked at rather than read, and it is the same glyph in every Latin locale.
  'Aa',

  // Developer debug overlay (Settings → Developer → Debug Overlay). Never shown
  // to a learner; read by whoever is debugging, who reads English by definition.
  'Position',
  'Phase:',
  'Round:',
  'Item:',
  'LEGO:',
  'Type:',
  'Audio Durations',
  'Source:',
  'Target1:',
  'Target2:',
  'Timing',
  'Pause:',
  'Mode:',
  'Adaptation:',
  'Last Response',
  'Latency:',
]

const SET = new Set(UNTRANSLATABLE)

export function isUntranslatable(text: string): boolean {
  return SET.has(text.replace(/\s+/g, ' ').trim())
}
