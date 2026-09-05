/**
 * Visibility and capability must be the SAME answer, from the SAME declaration.
 *
 * #509 replaced fourteen ad-hoc payment checks with one seam. What it did not
 * finish is the other half of the same idea: several surfaces still decide
 * whether to SHOW an institutional/seat-purchase affordance from the build
 * constant `INSTITUTIONAL_PURCHASE_IN_BUILD`, while whether that affordance can
 * actually DO anything comes from `institutionalPurchaseAvailable()` — which is
 * the build constant AND the runtime shell.
 *
 * Those two disagree in exactly the case the native shell uses:
 * a WEB build loaded inside a WebView, with
 * `window.__SSI_PLATFORM__ = { shell: 'webview' }` injected at boot
 * (platform/capabilities.ts documents this as a first-class path). The build
 * constant is true, so the panel renders; the capability is false. A tutor
 * clicks Subscribe and reaches Paddle — an outside payment route for digital
 * goods, which is a hard store rejection.
 *
 * So: the build constant is for CODE ELISION only — dropping routes and lazy
 * imports out of the artifact — and every rendering decision asks the
 * predicate. This test pins that split by scanning the source, because the
 * failure mode is a NEW surface written the old way, which no per-component
 * test can see.
 *
 * Found by an outside review of #509/#511, 2026-09-05.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

/**
 * The only legitimate readers of the raw build constant: places whose whole
 * purpose is to make code ABSENT from the artifact. A ternary that picks
 * between a lazy import and `null`, and the route arrays. Everything else —
 * every `v-if`, every computed, every disabled state — asks the predicate.
 */
const ELISION_SITES = new Set([
  'platform/paymentRoute.ts',
  'platform/scanPlatformDoors.ts',
  'router/index.ts',
  'containers/SchoolsContainer.vue',
  'containers/TeachContainer.vue',
  'views/admin/NodeHomeView.vue',
  'views/schools/SettingsView.vue',
  'views/teach/TeachDashboard.vue',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry)) out.push(full)
  }
  return out
}

// Production source only: a test file naming the old shape (this one does, in
// its own comments) is documenting the defect, not committing it.
const files = walk(SRC)
  .map((f) => ({ rel: f.slice(SRC.length + 1), text: readFileSync(f, 'utf8') }))
  .filter((f) => !f.rel.endsWith('.test.ts'))

describe('the build constant is for code elision, never for visibility', () => {
  it('is read only by files whose job is to remove code from the artifact', () => {
    const offenders = files
      .filter((f) => f.text.includes('INSTITUTIONAL_PURCHASE_IN_BUILD'))
      .map((f) => f.rel)
      .filter((rel) => !ELISION_SITES.has(rel))
    expect(offenders, 'ask institutionalPurchaseAvailable() instead').toEqual([])
  })

  it('never reaches a template — a v-if on it cannot see the runtime shell', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (!f.rel.endsWith('.vue')) continue
      const template = f.text.slice(f.text.indexOf('<template'))
      if (template.includes('INSTITUTIONAL_PURCHASE_IN_BUILD')) offenders.push(f.rel)
    }
    expect(offenders).toEqual([])
  })

  it('is not aliased into a plain const that a template then renders', () => {
    // `const seatPurchaseAvailable = INSTITUTIONAL_PURCHASE_IN_BUILD` is the
    // same defect wearing a runtime-sounding name.
    const offenders = files
      // `= INSTITUTIONAL_PURCHASE_IN_BUILD\n  ? lazyImport : null` is the
      // legitimate elision ternary; a bare assignment is the alias.
      .filter((f) => /=\s*INSTITUTIONAL_PURCHASE_IN_BUILD(?!\s*\?)/.test(f.text))
      .map((f) => f.rel)
    expect(offenders, 'derive it from institutionalPurchaseAvailable()').toEqual([])
  })
})

describe('every Paddle checkout opener asks the seam first', () => {
  it('has a capability guard in the same file as each Checkout.open()', () => {
    const offenders = files
      .filter((f) => f.text.includes('paddle.Checkout.open('))
      .filter(
        (f) =>
          !/canTakePayment\(\)|institutionalPurchaseAvailable\(\)|paddleBillingAvailable\(\)/.test(
            f.text
          )
      )
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })
})
