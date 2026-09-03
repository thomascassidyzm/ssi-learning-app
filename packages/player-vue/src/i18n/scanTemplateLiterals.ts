/**
 * Template-literal scanner — the engine behind the "no bare English in a
 * learner-facing template" gate (`noBareEnglish.test.ts`).
 *
 * WHY THIS EXISTS: on 2026-09-02 Tom opened "English for Hindi speakers" on his
 * phone and read English chrome on the settings and progress screens. The keys
 * were there; nobody had wired them. A sweep fixes that once. This scanner is
 * what stops it regrowing — it fails the build the moment a learner-facing
 * template gains user-visible text that isn't a t() call.
 *
 * It is deliberately a dumb text scanner, not a real Vue parser: no dependency,
 * no AST, runs in milliseconds, and every false positive it can produce is
 * cheap to silence with an allowlist entry that carries its reason. A real
 * parser would be Better but neither Simpler nor Cheaper for this job.
 */

/** Attributes whose values reach a human's eyes or ears. */
const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'alt', 'aria-label', 'aria-placeholder', 'aria-description']

export interface BareLiteral {
  /** 1-indexed line within the file. */
  line: number
  /** The offending text, trimmed. */
  text: string
  /** 'text' for a template text node, or the attribute name. */
  kind: string
}

/** Strip a paired block (e.g. <script>…</script>) but keep line numbering intact. */
function blankBlock(src: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
  return src.replace(re, (m) => m.replace(/[^\n]/g, ' '))
}

/** Replace a matched region with spaces so offsets — and therefore lines — survive. */
function blankOut(src: string, re: RegExp): string {
  return src.replace(re, (m) => m.replace(/[^\n]/g, ' '))
}

/**
 * Text that is not language: punctuation, digits, units, arrows, emoji,
 * single letters (bullets, initials), and mustache-only nodes. Anything here
 * is untranslatable by nature — there is nothing for a translator to do with
 * "→" or "%" — so it is skipped structurally rather than allowlisted.
 */
function isNonWord(text: string): boolean {
  if (!/[A-Za-z]/.test(text)) return true
  // Needs at least one run of two or more letters to count as a word.
  if (!/[A-Za-z]{2}/.test(text)) return true
  return false
}

/**
 * Find user-visible text in a .vue single-file component's <template> that is
 * not produced by a t(...) call.
 */
export function scanTemplateLiterals(source: string): BareLiteral[] {
  const tplStart = source.search(/<template[^>]*>/)
  if (tplStart === -1) return []

  // Work on the whole file with <script> and <style> blanked, so line numbers
  // reported to a human match the file they will open.
  let src = blankBlock(source, 'script')
  src = blankBlock(src, 'style')
  // Blank everything before the first <template> too.
  src = src.slice(0, tplStart).replace(/[^\n]/g, ' ') + src.slice(tplStart)
  // HTML comments are not shipped to anyone.
  src = blankOut(src, /<!--[\s\S]*?-->/g)
  // Inline SVG carries path data and the odd <text> used as an icon glyph; its
  // prose, where there is any, is caught by the aria-label rule instead.
  src = blankOut(src, /<svg[\s\S]*?<\/svg>/gi)
  // <pre>/<code> is literal by definition.
  src = blankOut(src, /<pre[\s\S]*?<\/pre>/gi)
  // Mustache interpolations are expressions, and they wrap across lines — blank
  // them here, before any line-based work, or a multi-line ternary reads as a
  // dozen bare literals. Whatever text is LEFT beside a mustache is still
  // flagged: "{{ n }} days left" is exactly the defect this gate exists for.
  src = blankOut(src, /\{\{[\s\S]*?\}\}/g)

  const out: BareLiteral[] = []
  const lineOf = (idx: number) => src.slice(0, idx).split('\n').length

  // --- 1. Translatable attributes with a plain (unbound) string value ------
  for (const attr of TRANSLATABLE_ATTRS) {
    const re = new RegExp(`(?<![:\\w-])${attr}\\s*=\\s*"([^"]*)"`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const text = m[1].trim()
      if (!text || isNonWord(text)) continue
      out.push({ line: lineOf(m.index), text, kind: attr })
    }
    // Bound values (:title="...") are expressions: flag only when the whole
    // expression is a quoted string literal with no t() in it.
    const reBound = new RegExp(`[:@]?${attr}\\s*=\\s*"\\s*'([^']*)'\\s*"`, 'g')
    while ((m = reBound.exec(src))) {
      const text = m[1].trim()
      if (!text || isNonWord(text)) continue
      out.push({ line: lineOf(m.index), text, kind: `:${attr}` })
    }
  }

  // --- 2. Text nodes -------------------------------------------------------
  // Blank tag bodies so only the text between tags is left.
  // Quote-aware tag matcher: an attribute value can legitimately contain '>'
  // (arrow functions, comparisons), so a naive /<[^>]*>/ swallows real text.
  const stripped = blankOut(src, /<\/?[A-Za-z!][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g)
  const nodeRe = /[^\s][^\n]*/g
  let m: RegExpExecArray | null
  while ((m = nodeRe.exec(stripped))) {
    let text = m[0].trim()
    text = text.replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/\s+/g, ' ').trim()
    if (!text || isNonWord(text)) continue
    out.push({ line: lineOf(m.index), text, kind: 'text' })
  }

  return out.sort((a, b) => a.line - b.line)
}
