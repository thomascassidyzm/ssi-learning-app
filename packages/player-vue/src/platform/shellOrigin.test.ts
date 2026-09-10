/**
 * THE SHELL MUST NOT LAND ON PRODUCTION BY ACCIDENT. Tom's ruling, 2026-09-10:
 * production is for live learners, and testing there is about fixing a live
 * problem, never about comparing builds or platforms — so an APK that points
 * at production because somebody forgot to set a variable is always wrong.
 *
 * This pins the two halves of that: an unset SSI_SHELL_ORIGIN yields staging,
 * and an explicit production setting is still obeyed exactly. It also pins the
 * single-source rule — scripts/build-android-apk.sh must READ the default out
 * of capacitor.config.ts rather than keep a second copy of it, because a
 * second copy is the thing that would quietly go stale and print a lie.
 *
 * This REPLACES the pin written on 2026-09-08, which asserted the opposite —
 * "is production by default" — under the ruling that made the shell a window
 * onto main. That ruling is not being reversed: the shell still points at a
 * live deployment, and production is still one word away. What changed is
 * which way the default FAILS when nobody says anything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Vitest runs with cwd at the package root, which is where both of these live.
const CONFIG_PATH = resolve(process.cwd(), 'capacitor.config.ts')
const SCRIPT_PATH = resolve(process.cwd(), 'scripts/build-android-apk.sh')

const STAGING = 'https://staging.saysomethingin.app'
const PRODUCTION = 'https://saysomethingin.app'

/**
 * Re-evaluate capacitor.config.ts under whatever SSI_SHELL_ORIGIN is set right
 * now. The fallback is resolved at module scope, so the module cache has to be
 * dropped between cases or every case would see the first one's answer.
 */
async function loadShellOrigin(): Promise<string> {
  vi.resetModules()
  const mod = await import('../../capacitor.config')
  return (mod.default as { server?: { url?: string } }).server?.url ?? ''
}

describe('the android shell origin default', () => {
  const before = process.env.SSI_SHELL_ORIGIN

  beforeEach(() => { delete process.env.SSI_SHELL_ORIGIN })
  afterEach(() => {
    if (before === undefined) delete process.env.SSI_SHELL_ORIGIN
    else process.env.SSI_SHELL_ORIGIN = before
  })

  it('points at STAGING when nobody set SSI_SHELL_ORIGIN', async () => {
    expect(await loadShellOrigin()).toBe(STAGING)
  })

  it('never lands on production without being asked', async () => {
    expect(await loadShellOrigin()).not.toBe(PRODUCTION)
  })

  it('obeys an explicit production setting exactly', async () => {
    process.env.SSI_SHELL_ORIGIN = PRODUCTION
    expect(await loadShellOrigin()).toBe(PRODUCTION)
  })

  it('never carries a trailing slash, whatever it is pointed at', async () => {
    process.env.SSI_SHELL_ORIGIN = `${PRODUCTION}/`
    expect(await loadShellOrigin()).toBe(PRODUCTION)
  })

  it('keeps the default in ONE place — the build script reads the config, it does not copy it', () => {
    const config = readFileSync(CONFIG_PATH, 'utf8')
    const script = readFileSync(SCRIPT_PATH, 'utf8')

    expect(config).toContain(`const SHELL_DEFAULT_ORIGIN = '${STAGING}'`)

    // The script derives its default from that constant.
    expect(script).toContain('capacitor.config.ts')
    expect(script).toMatch(/SHELL_DEFAULT_ORIGIN="\$\(sed/)

    // And it keeps no fallback of its own. `${SSI_SHELL_ORIGIN:-https://...}`
    // is exactly the second copy this rule exists to forbid: it is what made
    // the script capable of building a production APK while the config said
    // staging.
    expect(script).not.toMatch(/SSI_SHELL_ORIGIN:-https/)
  })
})
