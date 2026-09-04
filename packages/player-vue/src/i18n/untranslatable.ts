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
