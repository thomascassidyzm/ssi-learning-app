# Interface locale files

One JSON file per interface language, keyed by ISO 639-3 code. `eng.json` is both the
source of truth for the key set and the runtime fallback: `t()` looks up the active
locale, then English, then returns the key itself.

Parity with `eng.json` is CI-enforced by `../composables/useI18n.localeParity.test.ts` —
every locale must carry every UI key English carries, with no orphans, no blank strings,
and no type mismatches. Add a key to `eng.json` and the next CI run names it in every
other file until it is translated.

## The brand wordmark stays in English — always

**`brand.say`, `brand.something` and `brand.in` are NOT translated. Not in any locale,
not ever.** Together they render the "Say Something in" wordmark in the player header.

It is the brand name, not a phrase. "Say Something in Welsh" is what the product is
called, in the same way that a company keeps its name when it opens an office abroad —
translating it produces a different product name in every market and no recognisable
brand in any of them.

This is a deliberate convention, ruled by Tom on 2026-08-26. Sixteen locales had
translated it in good faith before the ruling — Celtic, Romance, South Asian and misc —
and were reverted. Translators reading a locale file will reasonably assume every string
is theirs to translate, so the convention is also machine-enforced: the parity test
asserts these three keys hold their exact English values in every file. Re-translating
them is a red CI run, not a silent regression.

If the wordmark itself ever changes, change it in `eng.json` and in the test's expected
values together — those are the only two places it lives.
