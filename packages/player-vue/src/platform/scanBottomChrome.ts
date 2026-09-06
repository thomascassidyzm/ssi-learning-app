/**
 * scanBottomChrome — a pure scanner that finds bottom-anchored chrome
 * positioning itself against anything other than the ONE shell rule.
 *
 * WHY THIS EXISTS. Deborah, the first external Android tester, 2026-09-05:
 * "I do not like that the bottom controls are so close to my phone controls."
 * The bottom pill row anchored itself at `max(inset / 2, 12px)` — the iOS
 * convention, where the home indicator is inert. Android's navigation bar is a
 * LIVE control surface, so half an inset put the row inside it: measured at a
 * 48px three-button inset, the row's bottom edge sat 24px INSIDE the bar.
 *
 * The fix was one token. What keeps it fixed is this scanner: the moment a
 * second bottom offset is written by hand — a bare `env(safe-area-inset-bottom)`,
 * a halved inset, a naked pixel constant — the estate has two rules that must
 * agree, and one of them will be wrong on somebody's handset.
 *
 * THE RULE. Bottom-anchored chrome reads `var(--shell-inset-bottom)` (the raw
 * measured inset) or `var(--shell-nav-clearance)` (how far the floating bottom
 * chrome sits above the viewport). Only `styles/design-tokens.css` and
 * `platform/shellSafeArea.ts` may DEFINE those. Nothing else computes them.
 *
 * Like scanPlatformDoors, this is a pure function separate from its test so the
 * test can feed it synthetic broken content and assert it goes RED. A detector
 * only ever seen green is not a detector.
 *
 * SCOPE, deliberately. This governs the POSITION of bottom-anchored chrome —
 * the `bottom` offset, in CSS or written into an inline style — plus the halved
 * -inset idiom anywhere at all, because that idiom IS the defect. It does not
 * police `padding-bottom` on scroll containers: that is content clearance, it
 * already uses the full inset everywhere in this tree, and it cannot put a
 * control inside the navigation bar.
 */

export interface ChromePattern {
  name: string
  re: RegExp
  /** Why this is a second rule, shown when the test fails. */
  why: string
}

/**
 * A line is compliant — and skipped entirely — if it already derives from the
 * shell tokens. That is what lets `var(--shell-nav-clearance, <old rule>)`
 * keep a fallback: the token is consulted first, so the fallback is a safety
 * net rather than a competing rule.
 */
const DERIVES_FROM_SHELL = /var\(\s*--shell-(inset-bottom|nav-clearance|nav-floor)\b/

export const CHROME_PATTERNS: ChromePattern[] = [
  {
    name: 'halved-inset',
    // The actual defect: the iOS half-inset convention, applied to Android.
    re: /env\(\s*safe-area-inset-bottom[^)]*\)\s*\/\s*2/,
    why: "half an inset is the iOS home-indicator convention; Android's nav bar is a live control surface — read var(--shell-nav-clearance)",
  },
  {
    name: 'raw-bottom-inset',
    // Any positioning/sizing property computed from the raw env() bottom inset.
    re: /(?<![-\w])(bottom|inset-block-end)\s*:[^;]*env\(\s*safe-area-inset-bottom/,
    why: 'derive from var(--shell-inset-bottom) — the only source that also reports on an Android WebView whose insets Capacitor has already consumed',
  },
  {
    name: 'js-bottom-inset',
    // The same thing written from JS/TS into an inline style object.
    re: /(?<![-\w])bottom\s*:\s*['"`][^'"`]*env\(\s*safe-area-inset-bottom/,
    why: 'derive from var(--shell-inset-bottom) rather than writing env() into an inline style',
  },
  {
    name: 'shell-token-redefinition',
    re: /--shell-(inset-bottom|nav-clearance)\s*:/,
    why: 'these are defined once, in styles/design-tokens.css; the Android override lives there too',
  },
]

export interface ChromeHit {
  path: string
  line: number
  pattern: string
  why: string
  text: string
}

export interface ScanFile {
  path: string
  content: string
}

/** Lines that are obviously prose, not code, for these purposes. */
function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')
}

/**
 * Find every hand-written bottom offset in the supplied files. Callers exclude
 * the definition sites (design-tokens.css, platform/) before calling.
 */
export function findBottomChromeOffsets(files: ScanFile[]): ChromeHit[] {
  const hits: ChromeHit[] = []
  for (const file of files) {
    const lines = file.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (isCommentLine(line)) continue
      const derives = DERIVES_FROM_SHELL.test(line)
      for (const p of CHROME_PATTERNS) {
        // A line that already reads the shell tokens is compliant — except for
        // a redefinition, which reads them precisely in order to restate them.
        if (derives && p.name !== 'shell-token-redefinition') continue
        if (p.re.test(line)) {
          hits.push({ path: file.path, line: i + 1, pattern: p.name, why: p.why, text: line.trim() })
        }
      }
    }
  }
  return hits
}
