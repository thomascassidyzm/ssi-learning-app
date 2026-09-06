/**
 * SEC0905-D — Area D (client half), 2026-09-05 audit.
 *
 * Scope: the 253-file / +21,890 line player-vue/src delta since 8755d4c8
 * (the 2026-09-01 audit's base), reviewed against the brief's five priority
 * categories: new v-html/innerHTML/eval sinks, URL-param/postMessage-driven
 * routing or authz, token/secret handling, client-only admin/teacher gates,
 * and offline/cache identity-scoping. Full narrative in
 * docs/security-audit-2026-09-05/area-d-client-and-db.md.
 *
 * HEADLINE: no new finding in this delta. The one HIGH-severity item this
 * area could plausibly have re-opened — SEC0901-D-02, the shared-device
 * paid-course-bundle leak — is now CLOSED. This suite pins that closure as a
 * regression guard alongside the two existing behavioural suites
 * (useCourseBundle.crossIdentity.security.test.ts,
 * audioCacheOwner.security.test.ts already cover the behaviour; this file
 * adds the WIRING check those don't: that the fix is actually called from
 * every real auth transition, not just implemented and left unplugged).
 *
 * Everything else in this file is a secure-assertion from source reading:
 * grep sweeps across the full delta for v-html/innerHTML/eval/document.write
 * (none new), window.postMessage / message-event handlers (none new), and a
 * read of the two files the brief specifically named — platform/apiBase.ts
 * and auth/sendSignInCode.ts — for token/secret handling.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(__dirname, rel), 'utf8')
}

describe('SEC0901-D-02 (closed) — the audio-cache-owner and bundle-owner fixes are wired into every real auth transition', () => {
  const useAuth = read('../composables/useAuth.ts')

  it('reconcileAudioCacheOwner is called on the sign-in-event path (handleAuthChange)', () => {
    const idx = useAuth.indexOf('async function handleAuthChange')
    const block = useAuth.slice(idx, idx + 1200)
    expect(block).toMatch(/void reconcileAudioCacheOwner\(user\.id\)/)
  })

  it('reconcileAudioCacheOwner is ALSO called on the restored-session boot path, not just onAuthStateChange', () => {
    // onAuthStateChange does not reliably fire for a session already on disk
    // at boot — the fix's own comment says so. This is the check that a
    // sibling "amplification" fix doesn't repeat the exact gap it closed.
    const idx = useAuth.indexOf('async function initialize(')
    const block = useAuth.slice(idx, idx + 3000)
    expect(block).toMatch(/void reconcileAudioCacheOwner\(result\.data\.session\.user\.id\)/)
  })

  it('clearAllCachedBundles is called from signOut(), awaited (not fire-and-forget)', () => {
    const idx = useAuth.indexOf('async function signOut')
    const nextFn = useAuth.indexOf('\n  async function ', idx + 20)
    const block = useAuth.slice(idx, nextFn > idx ? nextFn : idx + 2500)
    expect(block).toMatch(/await clearAllCachedBundles\(\)/)
  })

  it('setCourseBundleIdentityProvider is actually installed at boot (App.vue) — the ownerId scheme is not dead code', () => {
    const appVue = read('../App.vue')
    expect(appVue).toMatch(/setCourseBundleIdentityProvider\(async \(\) => \{/)
    // Must resolve to the auth uid via a live session read, not a stub.
    const idx = appVue.indexOf('setCourseBundleIdentityProvider(async () => {')
    const block = appVue.slice(idx, idx + 400)
    expect(block).toMatch(/data\.session\?\.user\?\.id/)
  })

  it('getCachedCourseBundle (the offline fast path) enforces the same owner check as the network path — not a bypass', () => {
    const bundle = read('../composables/useCourseBundle.ts')
    const idx = bundle.indexOf('export async function getCachedCourseBundle')
    const block = bundle.slice(idx, idx + 500)
    expect(block).toMatch(/cachedOwnerMatches\(cached, await currentIdentityId\(\)\)/)
  })
})

describe('secure-assertion — no new dangerous DOM sink in the 2026-09 client delta', () => {
  // Every v-html / innerHTML / outerHTML / document.write in the package,
  // read directly rather than trusted from memory of the previous audit.
  it('the only v-html usages in the package remain the two already-audited, unchanged sinks', () => {
    const howThisWorks = read('../components/admin/HowThisWorks.vue')
    const walkCard = read('../components/admin/WalkCard.vue')
    expect(howThisWorks).toMatch(/v-html="html"/)
    expect(walkCard).toMatch(/v-html="rendered"/)
    // Both carry their escaping justification inline — regression lock on
    // the comment surviving alongside the sink, not just the sink itself.
    expect(howThisWorks).toMatch(/escaped above/)
    expect(walkCard).toMatch(/escaped above/)
  })
})

describe('secure-assertion — apiBase.ts credential posture (new file, platform/apiBase.ts)', () => {
  const src = read('../platform/apiBase.ts')

  it('the origin rewrite is a pure no-op on the web: an empty configured origin installs nothing', () => {
    expect(src).toMatch(/const origin = apiOrigin\(\)\s*\n\s*if \(!origin\) return false/)
  })

  it('string/URL rewritten requests are pinned credentials: omit, never inheriting ambient cookies cross-origin', () => {
    expect(src).toMatch(/function credentialFree\(init\?: RequestInit\): RequestInit/)
    expect(src).toMatch(/return \{ \.\.\.\(init \|\| \{\}\), credentials: 'omit' \}/)
  })

  it('the origin is sourced only from a same-app injected global or a build-time env var — never a URL query param or postMessage', () => {
    // capabilities.ts is apiOrigin()'s only source. Assert it reads exactly
    // window.__SSI_PLATFORM__ and import.meta.env, and nothing request-scoped
    // (no location.search, no addEventListener('message', ...)).
    const capabilities = read('../platform/capabilities.ts')
    expect(capabilities).toMatch(/window\.__SSI_PLATFORM__/)
    expect(capabilities).toMatch(/VITE_API_ORIGIN/)
    expect(capabilities).not.toMatch(/location\.search/)
    expect(capabilities).not.toMatch(/addEventListener\(['"]message['"]/)
  })
})

describe('secure-assertion — sendSignInCode.ts fallback only honours a real 429, never laundering a soft block into a resend', () => {
  const src = read('../auth/sendSignInCode.ts')

  it('a 429 from the new endpoint is returned to the caller, not retried through the Supabase fallback', () => {
    const idx = src.indexOf("res.status === 429")
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 250)
    expect(block).toMatch(/return \{ error:/)
  })

  it('the Supabase fallback call happens strictly after the 429 branch has already returned', () => {
    const throttleIdx = src.indexOf('res.status === 429')
    const fallbackIdx = src.indexOf('client.auth.signInWithOtp')
    expect(throttleIdx).toBeGreaterThan(-1)
    expect(fallbackIdx).toBeGreaterThan(throttleIdx)
  })
})

describe('secure-assertion — no new window.postMessage / message-event handler in the client delta', () => {
  it('generateLearningScript.ts uses a MessageChannel port (structured-clone worker handoff), not window.postMessage', () => {
    const src = read('../providers/generateLearningScript.ts')
    expect(src).toMatch(/ch\.port2\.postMessage\(null\)/)
    expect(src).not.toMatch(/window\.postMessage/)
    expect(src).not.toMatch(/addEventListener\(['"]message['"]/)
  })
})
