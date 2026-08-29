/**
 * PostgREST filter-expression helpers (SEC25 INPUT-02 / INPUT-06).
 *
 * `.or(...)`, `.filter(...)` and friends take a raw PostgREST filter DSL
 * STRING, not a bound parameter — so a comma in an interpolated value adds a
 * disjunct, a dot changes the operator path, and parens open a group. Any
 * caller-supplied text that reaches one of those calls must therefore be
 * escaped or constrained first. `.eq()`, `.ilike()` etc. bind their value and
 * need none of this.
 *
 * Two shapes, because the two call sites want different things:
 *   - quoteFilterValue()  — keep the value intact (search terms), neutralise
 *     the DSL by double-quoting, which is PostgREST's own escape.
 *   - safeIdToken()       — the comparison must stay a bare token (an id
 *     ratchet), so constrain the charset instead of quoting.
 */

/**
 * Wrap a value in PostgREST's double-quote form so `,` `.` `(` `)` inside it
 * are read as literal characters rather than DSL punctuation. Backslash and
 * double-quote are backslash-escaped, which is what the parser expects.
 */
export function quoteFilterValue(value: string): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Characters that carry no meaning in the filter DSL and cover every real id. */
const UNSAFE_ID_CHARS = /[^A-Za-z0-9_:-]/g

/**
 * Constrain an id-shaped value to DSL-inert characters and a sane length.
 * A legitimate lego/course/learner id passes through unchanged; anything
 * carrying filter punctuation loses it, so the expression keeps exactly the
 * disjuncts the code wrote.
 */
export function safeIdToken(value: unknown, maxLength = 64): string {
  return String(value ?? '').replace(UNSAFE_ID_CHARS, '').slice(0, maxLength)
}

/** Coerce to a finite integer, falling back when the caller sent junk. */
export function safeInteger(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}
