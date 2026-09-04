/**
 * ONE DOOR. This test fails if platform detection appears anywhere outside
 * `src/platform/`.
 *
 * It is proven in both directions: the first case scans the real source tree
 * and expects zero hits; the second feeds the same scanner synthetic content
 * containing a second door and expects it to go RED. A verifier only ever
 * seen green is not a verifier.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { findPlatformDoors, type ScanFile } from './scanPlatformDoors'

// vitest runs with the package root as cwd (vitest.config.ts lives there).
const SRC = resolve(process.cwd(), 'src')

/** The seam itself, and tests, which legitimately stub platform APIs. */
function isExempt(rel: string): boolean {
  return (
    rel.startsWith('platform/') ||
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
    if (!/\.(ts|js|vue)$/.test(entry)) continue
    const rel = relative(SRC, abs)
    if (isExempt(rel)) continue
    out.push({ path: rel, content: readFileSync(abs, 'utf8') })
  }
  return out
}

describe('one platform door', () => {
  it('finds no platform detection outside src/platform', () => {
    const files = collect(SRC)
    // Sanity: the walk actually found the app, not an empty directory.
    expect(files.length).toBeGreaterThan(300)

    const hits = findPlatformDoors(files)
    const report = hits.map((h) => `${h.path}:${h.line}  [${h.pattern}] ${h.text}\n    → ${h.why}`)
    expect(report).toEqual([])
  })

  it('goes red when a second door is added (the detector works)', () => {
    const synthetic: ScanFile[] = [
      { path: 'components/Whatever.vue', content: 'const native = isNativeShell()\n' },
      { path: 'composables/useThing.ts', content: 'if (window.Capacitor) { doNativeThing() }\n' },
      { path: 'cache/Other.ts', content: 'const est = await navigator.storage.estimate()\n' },
      { path: 'boot.ts', content: "navigator.serviceWorker.register('/sw.js')\n" },
    ]
    const hits = findPlatformDoors(synthetic)
    expect(hits.map((h) => h.pattern).sort()).toEqual([
      'capacitor-global',
      'raw-storage-estimate',
      'shell-predicate',
      'sw-registration',
    ])
  })

  it('does not confuse isNativeScript (writing system) with the native shell', () => {
    const hits = findPlatformDoors([
      { path: 'composables/useScriptMode.ts', content: 'const isNativeScript = ref(false)\nif (isNativeScript.value) render()\n' },
    ])
    expect(hits).toEqual([])
  })
})
