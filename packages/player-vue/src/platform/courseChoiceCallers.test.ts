/**
 * EVERY WRITE OF THE REMEMBERED COURSE SAYS WHERE IT CAME FROM, and the boot
 * fallback does not prewarm a course nobody asked for.
 *
 * These two live in App.vue's boot path and in four launch surfaces, and both
 * are the kind of thing that comes back the moment somebody adds a fifth
 * writer with a `localStorage.setItem` they copied from the file next door.
 * So they are asserted against the real source rather than described in a
 * comment — derived, not censused: a writer added next month is measured the
 * day it lands. (Job #596, off the audit at /d/e06f51fc.)
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { describe, expect, it } from 'vitest'

// vitest runs with the package root as cwd (vitest.config.ts lives there).
const SRC = resolve(process.cwd(), 'src')

/** Every source file that ships to a browser — tests and probes excluded. */
function shippedFiles(dir = SRC, out: { rel: string; text: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      shippedFiles(abs, out)
      continue
    }
    if (!/\.(ts|js|vue)$/.test(entry)) continue
    if (/\.test\.ts$|\.spec\.ts$/.test(entry)) continue
    out.push({ rel: relative(SRC, abs), text: readFileSync(abs, 'utf8') })
  }
  return out
}

describe('the remembered course is only ever written through courseChoice', () => {
  it('no shipped file writes ssi-last-course directly', () => {
    const offenders = shippedFiles()
      .filter((f) => f.rel !== join('platform', 'courseChoice.ts'))
      .filter((f) => /localStorage\.setItem\(\s*(['"]ssi-last-course['"]|LAST_COURSE_KEY)/.test(f.text))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('the scan goes red on a direct write, so it is a verifier and not decoration', () => {
    const synthetic = "localStorage.setItem('ssi-last-course', code)"
    expect(/localStorage\.setItem\(\s*(['"]ssi-last-course['"]|LAST_COURSE_KEY)/.test(synthetic)).toBe(true)
  })
})

describe("App.vue's boot fallback", () => {
  const app = readFileSync(join(SRC, 'App.vue'), 'utf8')

  it("stamps the auto-assigned default as 'default', not as a choice", () => {
    expect(app).toMatch(/selectionOrigin = 'default'/)
    expect(app).toMatch(/rememberCourse\(defaultCourse\.course_code, selectionOrigin\)/)
  })

  it('does not prewarm audio for a course it assigned itself', () => {
    // The prewarm at the end of the boot resolution must sit behind the gate.
    const gated = /if \(selectionOrigin !== 'default'\) \{\s*\n\s*void prewarmInstantCaches\(defaultCourse\.course_code\)/
    expect(app).toMatch(gated)
  })

  it('only warms the bundle for a destination the visitor pointed at', () => {
    expect(app).toMatch(/rememberedCourseWasAutoAssigned\(\) \? null : readRememberedCourse\(\)\.code/)
  })
})
