import { describe, it, expect } from 'vitest'
import config from '../../capacitor.config'

/**
 * THE ONE-LINE PRODUCTION SWITCH, PINNED. Tom's ruling, 2026-09-08: "We also
 * want the Android app to be serving main now right? Now we've tested it."
 * The shell is a window onto the deployment, so the origin in capacitor.config
 * IS what the APK loads — a silent revert to staging would ship a wrap that
 * looks right and serves the wrong code. This fails on the staging default.
 */
describe('the Android shell origin', () => {
  it('is production by default', () => {
    expect(config.server?.url).toBe('https://saysomethingin.app')
  })

  it('never carries a trailing slash, whatever it is pointed at', () => {
    expect(config.server?.url).not.toMatch(/\/$/)
  })
})
