/**
 * THE BUILD ROW AND version.json CANNOT FORK. This test fails if
 * `__BUILD_NUMBER__` (what Tom reads in Settings) and the `/version.json`
 * emitter (what `usePwaUpdate` fetches to decide an update is available) ever
 * stop being two references to ONE module-scope binding in `vite.config.js`.
 *
 * The update check compares those two strings. Today they are equal because
 * they are the same expression evaluated once — a fact stated only in a
 * comment. Recompute either side and the banner silently never fires, or fires
 * forever. Nothing in a build, a typecheck or a test noticed that until this
 * file existed.
 *
 * Proven in both directions: the first case reads the REAL config and expects
 * zero findings; the rest fork the two identifiers in each way that has a
 * plausible route into the file and expect it to go RED. A verifier only ever
 * seen green is not a verifier.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  findBuildIdentityForks,
  findDefineExpression,
  findVersionEmitterSource,
} from './scanBuildIdentity'

// vitest runs with the package root as cwd (vitest.config.ts lives there).
const CONFIG = resolve(process.cwd(), 'vite.config.js')
const real = readFileSync(CONFIG, 'utf8')

/** The real config, with one exact substring swapped — a plausible edit. */
function fork(from: string, to: string): string {
  expect(real).toContain(from)
  return real.replace(from, to)
}

describe('the two build identifiers share one source', () => {
  it('the real vite.config.js has no fork', () => {
    // Sanity: we are reading the actual config, not an empty string.
    expect(real).toContain('__BUILD_NUMBER__')
    expect(real).toContain('version.json')

    const findings = findBuildIdentityForks(real)
    expect(findings.map((f) => `[${f.kind}] ${f.why}`)).toEqual([])
  })

  it('reads both sides off the real config as the same binding', () => {
    expect(findDefineExpression(real)).toBe('JSON.stringify(buildNumber)')
    const emitter = findVersionEmitterSource(real)
    expect(emitter?.key).toBe('buildNumber')
    expect(emitter?.value).toBe('buildNumber')
  })

  it('stays green when the emitter carries EXTRA properties beside the id', () => {
    // version.json emits `buildTime` alongside `buildNumber` so a bundled
    // native shell can tell "newer" from merely "different". The scanner's
    // business is the id the reader compares, not the shape of the object it
    // travels in — an object with more in it is not a fork.
    const widened = fork(
      'source: JSON.stringify({ buildNumber, buildTime }),',
      'source: JSON.stringify({ buildNumber, buildTime, note: "hello" }),'
    )
    expect(findBuildIdentityForks(widened)).toEqual([])
  })

  it('goes red when the emitter uses a different identifier', () => {
    const forked = fork(
      'source: JSON.stringify({ buildNumber, buildTime }),',
      'source: JSON.stringify({ buildNumber: swSelfUpdate, buildTime }),'
    )
    const findings = findBuildIdentityForks(forked)
    expect(findings.map((f) => f.kind)).toEqual(['forked'])
    expect(findings[0].why).toContain('swSelfUpdate')
  })

  it('goes red when the emitter inlines its own expression', () => {
    const forked = fork(
      'source: JSON.stringify({ buildNumber, buildTime }),',
      'source: JSON.stringify({ buildNumber: Date.now().toString(36), buildTime }),'
    )
    const findings = findBuildIdentityForks(forked)
    expect(findings.map((f) => f.kind)).toEqual(['inline-expression'])
    expect(findings[0].why).toContain("version.json's source is computed inline")
  })

  it('goes red when __BUILD_NUMBER__ is given a different expression', () => {
    const forked = fork(
      '__BUILD_NUMBER__: JSON.stringify(buildNumber),',
      '__BUILD_NUMBER__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || buildTime),'
    )
    const findings = findBuildIdentityForks(forked)
    expect(findings.map((f) => f.kind)).toEqual(['inline-expression'])
    expect(findings[0].why).toContain('__BUILD_NUMBER__ is computed inline')
  })

  it('goes red when the shared name loses its module-scope declaration', () => {
    const forked = fork('const buildNumber = ', 'const buildNumberSource = ')
    const findings = findBuildIdentityForks(forked)
    expect(findings.map((f) => f.kind)).toEqual(['unbound'])
  })

  it("goes red when version.json stops emitting the reader's key", () => {
    const forked = fork(
      'source: JSON.stringify({ buildNumber, buildTime }),',
      'source: JSON.stringify({ build: buildNumber, buildTime }),'
    )
    const findings = findBuildIdentityForks(forked)
    expect(findings.map((f) => f.kind)).toEqual(['emitter-key'])
    expect(findings[0].why).toContain('fetchLatestBuildNumber')
  })

  it('goes red when either consumer disappears entirely', () => {
    const noDefine = findBuildIdentityForks(real.replace('__BUILD_NUMBER__:', 'BUILD_NUMBER_X:'))
    expect(noDefine.map((f) => f.kind)).toEqual(['define-missing'])

    const noEmitter = findBuildIdentityForks(real.replace("fileName: 'version.json',", ''))
    expect(noEmitter.map((f) => f.kind)).toEqual(['emitter-missing'])
  })

  it('ignores the comment lines that name both identifiers in prose', () => {
    // The config's own header comment mentions `__BUILD_NUMBER__` and
    // `/version.json`; if the scanner read those it would find phantom sides.
    const commentsOnly = [
      '// `__BUILD_NUMBER__` and `/version.json` are the two identifiers.',
      ' * fileName: version.json is emitted with source: nonsense',
    ].join('\n')
    expect(findDefineExpression(commentsOnly)).toBeNull()
    expect(findVersionEmitterSource(commentsOnly)).toBeNull()
  })
})
