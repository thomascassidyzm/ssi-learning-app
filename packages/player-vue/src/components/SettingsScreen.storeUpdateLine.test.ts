/**
 * The store-update sentence — pinned copy, for the one thing a tap cannot fix.
 *
 * Since the Android shell became a window onto the deployment (2026-09-08),
 * "your app is out of date" is almost never true: web code arrives on the next
 * launch. The exception is a NATIVE change — a web build that needs a plugin,
 * permission or WebView setting the installed APK does not have — and the only
 * remedy for that is the Play Store. See platform/nativeContract.ts for WHEN
 * this appears; this file pins WHAT IT SAYS, for the same two reasons the
 * staleness sentence next door is pinned: silence when it is true is the defect,
 * and the wrong words when it is true are worse than the silence.
 */
import { describe, it, expect } from 'vitest'
import eng from '../locales/eng.json'

const COPY = (eng as Record<string, any>).settings.needsStoreUpdate

describe('the store-update sentence', () => {
  it('names the resolution that actually exists — the store, not a reload', () => {
    expect(COPY).toMatch(/Play Store/)
    // The self-resolving vocabulary would be a lie: no wait, no reload and no
    // clearing of storage brings a native change into an installed APK.
    expect(COPY).not.toMatch(/comes through|as soon as|reload|tap to update/i)
  })

  it('says the app still works, because it does', () => {
    // Only the part that needs the new native capability is missing. Telling a
    // learner their app is broken when it plays perfectly well is the alarm
    // this estate has already paid for once.
    expect(COPY).toMatch(/keeps working/i)
  })

  it('states the fact plainly — no alarm, no instruction to stop', () => {
    expect(COPY).not.toContain('!')
    expect(COPY).not.toMatch(/error|failed|cannot/i)
  })

  it('carries no parentheses — house rule', () => {
    expect(COPY).not.toMatch(/[()]/)
  })
})
