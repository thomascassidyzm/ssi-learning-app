/**
 * The staleness line — pinned copy AND pinned conditions.
 *
 * Rendered rather than string-matched, because the two ways this goes wrong
 * are both conditional, and neither shows up in a locale-file test:
 *
 *   - SILENT WHEN STALE, which is the defect being cured: the APK bundles its
 *     web assets, so nothing else in the app can tell the holder they are
 *     behind.
 *   - LOUD WHEN CURRENT, which is worse than the silence it replaces. This
 *     estate has already shipped a permanent false "Update available" that
 *     tapping could not clear (see SettingsScreen's shaPrefixEq comment).
 *
 * The comparison itself lives in platform/buildStaleness.test.ts. What is
 * asserted here is the SENTENCE: that it names a date rather than a sha, that
 * it names the resolution that actually exists in a bundled shell — installing
 * a new app, never "it comes through as soon as we can reach it", which is the
 * belt panel's self-resolving vocabulary and would be a lie here — and that it
 * is inert text rather than a gate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { appIsStale } from '../composables/useAppStaleness'
import eng from '../locales/eng.json'

const COPY = (eng as Record<string, any>).settings.appBehindLive

beforeEach(() => {
  appIsStale.value = false
})

describe('the staleness sentence', () => {
  it('promises a NEW INSTALL, not a self-resolving wait', () => {
    // A bundled APK's staleness never resolves itself. No reload, no wait, no
    // clearing storage brings new web code in — only a new install does.
    expect(COPY).toContain('install')
    expect(COPY).toContain('popty.app/builds')
    expect(COPY).not.toMatch(/comes through|as soon as|downloading/i)
  })

  it('says WHEN this app is from, and takes a date rather than a sha', () => {
    expect(COPY).toContain('{date}')
    expect(COPY).toMatch(/This app is from \{date\}/)
  })

  it('states the fact plainly — no alarm, no instruction to stop', () => {
    expect(COPY).not.toContain('!')
    expect(COPY).not.toMatch(/error|failed|cannot|must/i)
  })
})

/**
 * And the wiring: the sentence is on screen when the app is behind, and gone
 * when it is not. Mounted for real — a `v-if` that reads the wrong ref is
 * exactly the failure a copy-only test cannot see.
 */
import { mount } from '@vue/test-utils'
import SettingsScreen from './SettingsScreen.vue'

const render = () =>
  mount(SettingsScreen, {
    global: {
      stubs: { Teleport: true, RouterLink: true, teleport: true },
      mocks: { $route: { path: '/' } },
    },
  })

// `__BUILD_TIME__` is a vite `define`, absent under vitest, so the component
// reads it off the global — stub it to a known build date and assert the exact
// sentence a learner would read.
const BUILD_TIME = '2026-09-04T20:31:00.000Z'
const SENTENCE = COPY.replace('{date}', '4 September 2026')

afterEach(() => { vi.unstubAllGlobals() })

describe('the staleness line on screen', () => {
  it('appears when the app is provably behind, naming the date in words', () => {
    vi.stubGlobal('__BUILD_TIME__', BUILD_TIME)
    appIsStale.value = true
    const text = render().text()
    expect(text).toContain(SENTENCE)
    // A date, never a sha — the sha stays one line up on the build row.
    expect(text).toContain('4 September 2026')
  })

  it('is absent when the app is current', () => {
    vi.stubGlobal('__BUILD_TIME__', BUILD_TIME)
    appIsStale.value = false
    expect(render().text()).not.toContain('A newer version is available')
  })
})
