/**
 * ONE BOTTOM RULE. This test fails if any bottom-anchored chrome positions
 * itself by hand instead of deriving from the shell tokens.
 *
 * It is the standing guard on Deborah's defect (2026-09-05, first external
 * Android tester: "I do not like that the bottom controls are so close to my
 * phone controls"). The row anchored itself at half the inset — the iOS
 * convention — which on a 48px three-button navigation bar left it 24px INSIDE
 * the bar. A second hand-written offset anywhere reintroduces exactly that.
 *
 * Proven in both directions: the first case scans the real source tree and
 * expects zero hits; the second feeds the scanner synthetic content — including
 * the pre-fix rule verbatim — and expects it to go RED.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { findBottomChromeOffsets, type ScanFile } from './scanBottomChrome'

// vitest runs with the package root as cwd (vitest.config.ts lives there).
const SRC = resolve(process.cwd(), 'src')

/**
 * The definition sites. `design-tokens.css` declares the tokens and the Android
 * override; `platform/` holds shellSafeArea.ts, which measures the insets and
 * sets the floor. Everything else derives.
 */
function isExempt(rel: string): boolean {
  return (
    rel.startsWith('platform/') ||
    rel === 'styles/design-tokens.css' ||
    rel.endsWith('.test.ts') ||
    rel.startsWith('test/') ||
    rel.includes('__tests__/')
  )
}

function collect(dir: string, out: ScanFile[] = []): ScanFile[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'locales') continue
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      collect(abs, out)
      continue
    }
    if (!/\.(ts|js|vue|css)$/.test(entry)) continue
    const rel = relative(SRC, abs)
    if (isExempt(rel)) continue
    out.push({ path: rel, content: readFileSync(abs, 'utf8') })
  }
  return out
}

describe('one bottom-chrome rule', () => {
  it('finds no hand-written bottom offsets outside the token definition', () => {
    const files = collect(SRC)
    // Sanity: the walk actually found the app, not an empty directory.
    expect(files.length).toBeGreaterThan(300)

    const hits = findBottomChromeOffsets(files)
    const report = hits.map((h) => `${h.path}:${h.line}  [${h.pattern}] ${h.text}\n    → ${h.why}`)
    expect(report).toEqual([])
  })

  it('goes red on the pre-fix rule and its relatives (the detector works)', () => {
    const synthetic: ScanFile[] = [
      // The rule that shipped to Deborah, verbatim from BottomNav.vue on dev.
      { path: 'components/BottomNav.vue', content: '  bottom: max(calc(env(safe-area-inset-bottom, 0px) / 2), 12px);\n' },
      // And from LearningPlayer.vue on dev.
      { path: 'components/LearningPlayer.vue', content: '  bottom: max(calc(env(safe-area-inset-bottom, 0px) / 2 + 82px), 94px);\n' },
      // A full-inset offset is still a second rule: it is wrong in Capacitor's
      // posture, where env() reports zero and the plugin property carries it.
      { path: 'components/Fab.vue', content: '  bottom: calc(24px + env(safe-area-inset-bottom, 0px));\n' },
      // The same thing written from JS into an inline style.
      { path: 'walkthrough/overlayPlacement.ts', content: "    bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',\n" },
      // A second definition of the token itself.
      { path: 'components/Rogue.vue', content: '  --shell-nav-clearance: 12px;\n' },
    ]
    const hits = findBottomChromeOffsets(synthetic)
    expect(hits.map((h) => h.pattern).sort()).toEqual([
      'halved-inset',
      'halved-inset',
      'js-bottom-inset',
      'raw-bottom-inset',
      'raw-bottom-inset',
      'raw-bottom-inset',
      'raw-bottom-inset',
      'shell-token-redefinition',
    ])
  })

  it('accepts chrome that derives from the shell tokens, fallback and all', () => {
    const hits = findBottomChromeOffsets([
      { path: 'components/BottomNav.vue', content: '  bottom: var(--shell-nav-clearance, max(calc(env(safe-area-inset-bottom, 0px) / 2), 12px));\n' },
      { path: 'missions/MissionCard.vue', content: '  bottom: calc(16px + var(--shell-inset-bottom));\n' },
      { path: 'walkthrough/overlayPlacement.ts', content: "    bottom: 'calc(24px + var(--shell-inset-bottom))',\n" },
    ])
    expect(hits).toEqual([])
  })

  it('leaves scroll-container content padding alone — it is not the position rule', () => {
    const hits = findBottomChromeOffsets([
      { path: 'components/BrowseScreen.vue', content: '  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));\n' },
    ])
    expect(hits).toEqual([])
  })
})
