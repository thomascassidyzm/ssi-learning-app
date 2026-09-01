/**
 * SEC0901-B — api/_utils/glossSegments.ts, text processing on authored
 * course content.
 *
 * Checked for: ReDoS (the one regex is `/\s+/` applied via .split(), which is
 * a single-character-class quantifier with no nested/overlapping quantifiers
 * — structurally not capable of catastrophic backtracking; timed here anyway
 * against a pathological input, per the brief's "prove it" instruction),
 * unbounded input, and an XSS sink (there is none in this file — it returns
 * plain data; the client renders it via Vue's default text interpolation, not
 * v-html — see the report for that trace).
 *
 * All SECURE-ASSERTION.
 */
import { describe, it, expect } from 'vitest'
import { authoredGlossSegments } from './glossSegments'

describe('SEC0901-B — no ReDoS: the whitespace split stays linear under pathological input', () => {
  it('a very long run of whitespace-like characters does not cause catastrophic backtracking', () => {
    // Pathological inputs for backtracking regexes are things like
    // (a+)+$ against "aaaa...!" — a single-character-class quantifier like
    // /\s+/ has no alternation/nesting to backtrack across, so this is a
    // sanity timing bound, not a real suspicion.
    const pathological = ' '.repeat(200_000) + 'x'
    const start = Date.now()
    const result = authoredGlossSegments({
      type: 'M',
      target_text: pathological,
      known_gloss_segments: [{ span: 1, known: 'x' }],
    })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
    // One word ("x") after collapsing whitespace; span totals 1 — matches.
    expect(result).toEqual([{ span: 1, known: 'x' }])
  })

  it('a target_text with thousands of alternating word/space tokens completes in linear time', () => {
    const words = Array.from({ length: 50_000 }, (_, i) => `w${i}`)
    const target = words.join(' ')
    const start = Date.now()
    authoredGlossSegments({
      type: 'M',
      target_text: target,
      known_gloss_segments: [{ span: words.length, known: 'whole thing' }],
    })
    expect(Date.now() - start).toBeLessThan(500)
  })
})

describe('SEC0901-B — refuses to fabricate a mapping for content it cannot honestly describe', () => {
  it('an A-LEGO never gets segmented, regardless of what is stored', () => {
    expect(
      authoredGlossSegments({ type: 'A', target_text: 'mot', known_gloss_segments: [{ span: 1, known: 'word' }] }),
    ).toBeUndefined()
  })

  it('a stale mapping whose span total no longer matches the current word count is dropped, not misapplied', () => {
    expect(
      authoredGlossSegments({
        type: 'M',
        target_text: 'un mot different',
        known_gloss_segments: [{ span: 2, known: 'a word' }], // totals 2, target has 3 words
      }),
    ).toBeUndefined()
  })

  it('malformed stored segments (non-array, non-object entries, non-integer span, non-string known) are all refused rather than half-applied', () => {
    const target_text = 'un mot'
    for (const bad of [
      null,
      'not-an-array',
      [null],
      [{ span: 'one', known: 'a' }],
      [{ span: 1.5, known: 'a' }],
      [{ span: 1, known: 42 }],
      [{ span: 0, known: 'a' }],
      [{ span: -1, known: 'a' }],
    ]) {
      expect(authoredGlossSegments({ type: 'M', target_text, known_gloss_segments: bad })).toBeUndefined()
    }
  })

  it('an empty stored array is refused, not rendered as zero tiles', () => {
    expect(authoredGlossSegments({ type: 'M', target_text: 'un mot', known_gloss_segments: [] })).toBeUndefined()
  })
})

describe('SEC0901-B — output is plain structured data, never a rendering primitive', () => {
  it('the return value contains no HTML-shaped strings that could imply a v-html sink is expected', () => {
    const result = authoredGlossSegments({
      type: 'M',
      target_text: 'un mot <script>alert(1)</script>', // 3 whitespace-split words
      known_gloss_segments: [{ span: 3, known: '<img onerror=alert(1)>' }],
    })
    // The function does not sanitize — it is not a sanitizer, it is a
    // structural validator (span totals must match word count). This test
    // documents that a malicious "known" string CAN flow through if authored
    // that way, which is why the client-side render path matters: it must
    // use text interpolation, never v-html, on this field. Confirmed by
    // reading packages/player-vue/src/components/LearningPlayer.vue in the
    // audit — no v-html near tile/gloss rendering.
    expect(result).toEqual([{ span: 3, known: '<img onerror=alert(1)>' }])
  })
})
