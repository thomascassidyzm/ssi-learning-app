#!/usr/bin/env node
/**
 * Proof, not assertion: build the app twice — once as the web, once as a store
 * shell — and show that institutional/seat purchase is ABSENT from the store
 * artifact rather than hidden inside it.
 *
 * This exists because the first attempt at the build gate did NOT work and the
 * bundle said so. `import.meta.env.VITE_APP_SHELL` looks like a build-time
 * literal but Vite replaces `import.meta.env` with the whole env OBJECT, so the
 * lookup is a property access Rollup cannot fold and every branch survived into
 * the bundle. The fix is the `__INSTITUTIONAL_PURCHASE__` define in
 * vite.config.js. A gate you have only ever seen pass is not a gate — so this
 * checks BOTH builds: the strings must be present on the web and absent in the
 * webview, and it fails either way round.
 *
 *   node e2e/_payment-route-bundle-check.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Strings that only exist on a seat-purchase surface. Each is copy a reviewer
// would see, not an internal identifier, so a rename that keeps the surface
// alive still trips this.
const SEAT_PURCHASE_MARKERS = [
  'per teacher seat',
  'Teacher plan',
  'Subscribe / choose seats',
  'Billing & invoices',
  'schools-upgrade',
  'org-upgrade',
  'teach-upgrade',
  'update-seats',
]

function build(shell) {
  const out = mkdtempSync(join(tmpdir(), `ssi-bundle-${shell}-`))
  execFileSync('npx', ['vite', 'build', '--outDir', out], {
    stdio: 'ignore',
    env: { ...process.env, ...(shell === 'webview' ? { VITE_APP_SHELL: 'webview' } : {}) },
  })
  return out
}

function jsSources(dir) {
  const assets = join(dir, 'assets')
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
}

function present(sources, marker) {
  return sources.some((s) => s.includes(marker))
}

const web = build('web')
const webview = build('webview')
try {
  const webSrc = jsSources(web)
  const nativeSrc = jsSources(webview)
  const failures = []

  for (const m of SEAT_PURCHASE_MARKERS) {
    if (!present(webSrc, m)) {
      failures.push(`WEB build is missing "${m}" — the check is looking for the wrong string`)
    }
    if (present(nativeSrc, m)) {
      failures.push(`WEBVIEW build still contains "${m}" — seat purchase is in the store artifact`)
    }
  }

  if (failures.length) {
    console.error('FAIL\n' + failures.map((f) => '  ' + f).join('\n'))
    process.exit(1)
  }
  console.log(
    `PASS — ${SEAT_PURCHASE_MARKERS.length} seat-purchase markers present on the web, absent in the webview build`
  )
} finally {
  rmSync(web, { recursive: true, force: true })
  rmSync(webview, { recursive: true, force: true })
}
