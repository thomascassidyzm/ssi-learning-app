/**
 * SEC0912T-E — TENTH security audit (2026-09-12), Area E: paid course content
 * delivery, the per-file audio proxy, and edge caching.
 *
 *   api/courses/[code]/{bundle,cycles,infplay-cycles,round-map,sectors}.ts
 *   api/audio/[audioId].ts, api/courses/available.ts, api/sw-config.ts
 *   api/_utils/{courseAccess,courseBoundary,audioAccess,entitlementVary,courseVoicePace}.ts
 *
 * Write-up: docs/security-audit-2026-09-12-tenth/area-e-content-delivery.md
 *
 * Findings and tests only. Nothing here changes behaviour, and NO LIVE
 * DATABASE WAS READ, no network was touched, no child process was spawned.
 * Every assertion is over repo source text, plus two pure helpers imported
 * from api/_utils/audioAccess.ts (module load needs SUPABASE_URL set; it
 * constructs an S3 client object but sends nothing).
 *
 * Prior coverage NOT re-reported here (read first, still true on this tree):
 *   - edgeCacheKeying.security.test.ts   — cycles.ts anon+universal public branch;
 *                                          bundle.ts always `private`.
 *   - entitlementVary.security.test.ts   — #676 `Vary: Authorization` on the three
 *                                          entitlement-personalised handlers.
 *   - roundMap.security.test.ts          — round-map ungated by design; 503 body fixed.
 *   - sec0901-a (SEC0901-A-06)           — anon-key fallback still live in
 *                                          cycles/bundle/infplay-cycles.
 *   - sec0905-c (SEC0905-C-01/-02)       — sectors.ts has no entitlement gate and
 *                                          leaks error.message.
 *   - 08-25 remediation-notes INPUT-01   — audio/[audioId].ts is fail-OPEN on
 *                                          premium past-preview audio unless
 *                                          ENTITLEMENT_ENFORCE=strict.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEC0912T-E-01 (MEDIUM) — FULL-COURSE WORK BEFORE THE ENTITLEMENT DECISION,
 *   reachable anonymously, never absorbed by the edge.
 *   infplay-cycles.ts reads EVERY main-loop lego (limit 5000) and EVERY use
 *   phrase (limit 10000) of the course in a Promise.all, and only THEN calls
 *   resolveServerCourseAccess — so an anonymous GET on a premium course does
 *   the whole read to return a 403. bundle.ts does the same nine reads —
 *   including the paged full-course phrase scan and the `course_voice_pace`
 *   RPC, which its own header measures at 8-20s on a cold buffer — before it
 *   decides the caller is preview-only and slices to 19 seeds in memory. The
 *   2.5s race in courseVoicePace.ts does NOT cancel the RPC (no abortSignal),
 *   so the derivation keeps running on the shared DB after the response has
 *   shipped without it. Both responses are `private` / `no-cache`, so Vercel's
 *   edge never absorbs a repeat; every anonymous hit is an origin hit, and
 *   there is no throttle. Concrete consequence: an unauthenticated caller
 *   turns N cheap GETs into N full-course scans + N pace derivations against
 *   the one database every learner shares (statement_timeout 8s on
 *   `authenticator`). CHARACTERIZATION: goes red when the gate moves ahead of
 *   the content reads (or the reads carry a seed ceiling for preview callers)
 *   and when the pace RPC is abortable.
 *
 * SEC0912T-E-02 (LOW) — bundle.ts's 503 body still hands an anonymous caller
 *   the operator remedy ("run materialised-view refresh"). This is the exact
 *   SEC25-X-01 shape that was FIXED on round-map.ts on 2026-08-25, recurring
 *   on the sibling that replaced it. Reachable before any gate.
 *   CHARACTERIZATION: goes red when the body becomes a fixed caller-safe string.
 *
 * SEC0912T-E-03 (LOW, LATENT) — sectors.ts answers `public, s-maxage=300` with
 *   no `Vary: Authorization`. That is only safe today because the endpoint has
 *   no entitlement gate at all (SEC0905-C-01, still open). The day C-01 is fixed
 *   by adding resolveServerCourseAccess WITHOUT changing the header, the edge
 *   serves the first entitled caller's anchor text to every anonymous caller
 *   for five minutes — the #676 defect re-created on a new file. TRIPWIRE:
 *   passes vacuously today; goes red on the wrong fix, stays green on the right
 *   one.
 *
 * Also here, as SECURE ASSERTIONS on what this audit checked and cleared: the
 * audio proxy's id validation and key provenance, its error-path cache
 * headers, the CLAUDE.md "1-year cache" claim as it actually stands, every
 * caller-supplied param on the five course endpoints, bundle.ts's preview
 * slice, sw-config.ts's payload, and the column-level lock that keeps the
 * `platform_role = 'tester'` shortcut in checkCourseAccess out of a learner's
 * own hands.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

const bundle = read('api/courses/[code]/bundle.ts')
const cycles = read('api/courses/[code]/cycles.ts')
const infplay = read('api/courses/[code]/infplay-cycles.ts')
const roundMap = read('api/courses/[code]/round-map.ts')
const sectors = read('api/courses/[code]/sectors.ts')
const audioProxy = read('api/audio/[audioId].ts')
const available = read('api/courses/available.ts')
const swConfig = read('api/sw-config.ts')
const courseAccess = read('api/_utils/courseAccess.ts')
const audioAccess = read('api/_utils/audioAccess.ts')
const voicePace = read('api/_utils/courseVoicePace.ts')
const pricingAccess = read('packages/core/src/pricing/access.ts')
const schema = read('supabase/schema.sql')

// ═══════════════════════════════════════════════════════════════════════════
// SEC0912T-E-01 — full-course work before the entitlement decision
// ═══════════════════════════════════════════════════════════════════════════
describe('SEC0912T-E-01 [CHARACTERIZATION] — infplay-cycles.ts reads the whole course, then decides entitlement', () => {
  it('the full lego + phrase reads sit inside a Promise.all that precedes resolveServerCourseAccess', () => {
    const readsAt = infplay.indexOf(".from('course_practice_phrases')")
    const legoReadAt = infplay.indexOf(".from('course_legos')")
    const gateAt = infplay.indexOf('resolveServerCourseAccess(req, supabase')
    expect(readsAt).toBeGreaterThan(-1)
    expect(legoReadAt).toBeGreaterThan(-1)
    expect(gateAt).toBeGreaterThan(-1)
    // Goes red when the gate moves ahead of the reads.
    expect(gateAt).toBeGreaterThan(readsAt)
    expect(gateAt).toBeGreaterThan(legoReadAt)
  })

  it('those reads are course-wide (10000 / 5000 caps, no seed ceiling), and the deny that follows them is a hard 403', () => {
    expect(infplay).toContain('.limit(10000)')
    expect(infplay).toContain('.limit(5000)')
    // No per-caller ceiling on either read — an anonymous caller pays for all of it.
    expect(infplay).not.toMatch(/\.lte\('seed_number'/)
    // ...and then is told no. The 403 is `no-store`, so it can never be absorbed
    // by any cache either: every anonymous probe is a full origin read.
    expect(infplay).toMatch(/if \(!access\.canAccess\) \{\s*\n\s*res\.setHeader\('Cache-Control', 'no-store'\)\s*\n\s*res\.status\(403\)/)
  })

  it('the success body is private/no-cache, so the edge never absorbs a repeat call', () => {
    expect(infplay).toContain("res.setHeader('Cache-Control', 'private, max-age=0, no-cache')")
  })
})

describe('SEC0912T-E-01 [CHARACTERIZATION] — bundle.ts does its nine reads and the pace RPC before slicing to preview', () => {
  it('the paged full-course phrase scan and the voice-pace RPC both run before resolveServerCourseAccess', () => {
    const phrasesAt = bundle.indexOf('fetchAllBundlePhrases(supabase, code)')
    const paceAt = bundle.indexOf('fetchCourseVoicePace(supabase, code)')
    const legosAt = bundle.indexOf(".from('course_legos')")
    const gateAt = bundle.indexOf('resolveServerCourseAccess(req, supabase')
    for (const [name, at] of [['phrases', phrasesAt], ['pace', paceAt], ['legos', legosAt], ['gate', gateAt]] as const) {
      expect(at, `${name} must be present`).toBeGreaterThan(-1)
    }
    // Goes red when the gate is resolved first (it needs only the one `courses`
    // row it already fetches) and the content reads are ceilinged for preview.
    expect(gateAt).toBeGreaterThan(phrasesAt)
    expect(gateAt).toBeGreaterThan(paceAt)
    expect(gateAt).toBeGreaterThan(legosAt)
  })

  it('the slice to previewMaxSeed happens in memory AFTER the full read, not in the query', () => {
    expect(bundle).toMatch(/const scopedLegoRows = previewOnly\s*\n\s*\? legoRows\.filter\(\(row\) => row\.seed_number <= previewMaxSeed\)/)
    expect(bundle).toMatch(/const scopedPhraseRows = previewOnly\s*\n\s*\? phraseRows\.filter\(\(row\) => row\.seed_number <= previewMaxSeed\)/)
    expect(bundle).not.toMatch(/\.lte\('seed_number'/)
  })

  it('the 2.5s pace race does not cancel the RPC: no abortSignal, and the file itself measures 8-20s cold', () => {
    expect(voicePace).toContain('export const VOICE_PACE_TIMEOUT_MS = 2500')
    expect(voicePace).toMatch(/Promise\.race\(\[rpc, timeout\]\)/)
    // supabase-js exposes `.abortSignal(signal)` on a query builder; nothing
    // here uses it, so the derivation keeps running server-side after the race
    // is lost. Goes red when the RPC becomes abortable.
    expect(voicePace).not.toMatch(/abortSignal|AbortController/)
    expect(voicePace).toMatch(/cold-buffer run has been measured at 8-20s/)
  })

  it('bundle.ts has no throttle and no auth precondition on the main path — anonymous callers reach every read', () => {
    expect(bundle).not.toMatch(/codeAttemptThrottle|rateLimit|throttle/i)
    // The only thing between the URL and the nine reads is the course-code regex.
    const codeCheckAt = bundle.indexOf('COURSE_CODE_RE.test(code)')
    const promiseAllAt = bundle.indexOf('// 9 queries in parallel')
    expect(codeCheckAt).toBeGreaterThan(-1)
    expect(promiseAllAt).toBeGreaterThan(codeCheckAt)
    expect(bundle.slice(codeCheckAt, promiseAllAt)).not.toMatch(/verifyAuthToken|resolveServerCourseAccess/)
  })

  it('CONTROL: cycles.ts bounds its window RPC by the clamped limit — the same class, handled', () => {
    // The sibling that gets this right: the RPC window is limit+2, limit ≤ 50,
    // so an anonymous probe costs a bounded read, not the course.
    expect(cycles).toContain('const MAX_LIMIT = 50')
    expect(cycles).toContain('const ROUND_FETCH = Math.min(limit + 2, MAX_LIMIT + 2)')
    expect(cycles).toContain('p_round_limit: ROUND_FETCH')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SEC0912T-E-02 — the SEC25-X-01 503 shape, recurring on bundle.ts
// ═══════════════════════════════════════════════════════════════════════════
describe('SEC0912T-E-02 [CHARACTERIZATION] — bundle.ts 503 body carries the operator remedy', () => {
  it('the body names the remedy; the fixed sibling (round-map) keeps it in console.error', () => {
    // Goes red when bundle adopts round-map's fixed shape.
    expect(bundle).toMatch(/res\.status\(503\)\.json\(\{\s*\n?\s*error: `Course \$\{code\} has no round-index entries \(run materialised-view refresh\)`/)
    expect(roundMap).toContain("res.status(503).json({ error: 'Course temporarily unavailable' })")
  })

  it('it is reachable before any entitlement decision', () => {
    const at503 = bundle.indexOf('has no round-index entries')
    const gateAt = bundle.indexOf('resolveServerCourseAccess(req, supabase')
    expect(at503).toBeGreaterThan(-1)
    expect(gateAt).toBeGreaterThan(at503)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SEC0912T-E-04 — the empty-body 502 ships with a one-year immutable cache
// ═══════════════════════════════════════════════════════════════════════════
// Raised by the cross-family verification of this area (GPT-6 Astra, job
// #451·G) and confirmed here against the source. The area cleared "every
// non-200 path that PRECEDES the bytes is no-store" — accurate as written, and
// the write-up then generalised it to "every error path", which is not. The
// success headers are set at :164, BEFORE the body is checked at :201, so an
// empty S3 body returns 502 carrying `public, max-age=31536000, immutable`.
// The CDN is spared (both CDN headers are no-store) but the learner's own
// browser pins that failure for a year: the clip is dead for them until they
// clear storage. Availability, not disclosure.
// CHARACTERIZATION: goes red when the 502 resets Cache-Control, or when the
// success headers move below the body check.
describe('SEC0912T-E-04 — the empty-body 502 inherits the success cache headers', () => {
  it('the one-year immutable header is set before the body is checked', () => {
    const immutable = audioProxy.indexOf("res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')")
    const emptyBody = audioProxy.indexOf("res.status(502).json({ error: 'Empty body from S3' })")
    expect(immutable).toBeGreaterThan(-1)
    expect(emptyBody).toBeGreaterThan(-1)
    expect(emptyBody).toBeGreaterThan(immutable)
  })

  it('nothing between them resets it', () => {
    const immutable = audioProxy.indexOf("res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')")
    const emptyBody = audioProxy.indexOf("res.status(502).json({ error: 'Empty body from S3' })")
    const between = audioProxy.slice(immutable + 10, emptyBody)
    expect(between).not.toContain("setHeader('Cache-Control'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SEC0912T-E-03 — sectors.ts: public edge cache is safe only while ungated
// ═══════════════════════════════════════════════════════════════════════════
describe('SEC0912T-E-03 [TRIPWIRE] — sectors.ts must not become gated-and-public', () => {
  const gated = /resolveServerCourseAccess|verifyAuthToken|getAuthUserId/.test(sectors)
  const publicCached = /Cache-Control',\s*'public, max-age=300, s-maxage=300'/.test(sectors)
  const varies = /setEntitlementVary|Vary/.test(sectors)

  it('today: no gate, public s-maxage, no Vary (the SEC0905-C-01 state, characterised)', () => {
    expect(gated).toBe(false)
    expect(publicCached).toBe(true)
    expect(varies).toBe(false)
  })

  // NARROWED 2026-09-12 after job #451 pointed out the overclaim: this pair of
  // assertions cannot distinguish a CORRECT gate-and-recache fix from a broken
  // gate-only one — the first `it` requires `gated === false`, so ANY gate
  // turns it red. That is acceptable for a characterization test (red means
  // "read me"), but it is not the selective tripwire the write-up described,
  // and the gate sniff recognises only three function names.
  it('invariant: if a gate is ever added, the body must stop being publicly edge-cacheable and must Vary on Authorization', () => {
    // Vacuous today. The moment someone fixes C-01 by adding a gate and leaves
    // the header alone, this is the assertion that goes red — before the edge
    // serves one caller's entitled anchors to the next.
    if (gated) {
      expect(publicCached, 'a gated sectors.ts must not answer public+s-maxage').toBe(false)
      expect(varies, 'a gated sectors.ts must set Vary: Authorization').toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CHECKED AND CLEARED — secure assertions
// ═══════════════════════════════════════════════════════════════════════════
describe('CLEARED — api/audio/[audioId].ts: id validation, key provenance, cache headers', () => {
  it('audioId is regex-validated (uuid or uuid.vN) before any DB or S3 call, and traversal shapes are refused', async () => {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
    const { isValidAudioId, parseAudioRef } = await import('../_utils/audioAccess')
    for (const bad of [
      '../../etc/passwd',
      'mastered/anything.mp3',
      '2222aaaa-2222-2222-2222-222222222222/../x',
      '2222aaaa-2222-2222-2222-222222222222.v0',
      '2222aaaa-2222-2222-2222-222222222222.v123456',
      "2222aaaa-2222-2222-2222-222222222222'--",
      '',
    ]) {
      expect(isValidAudioId(bad), `must reject ${JSON.stringify(bad)}`).toBe(false)
      expect(parseAudioRef(bad)).toBeNull()
    }
    expect(isValidAudioId('2222aaaa-2222-2222-2222-222222222222')).toBe(true)
    expect(isValidAudioId('2222aaaa-2222-2222-2222-222222222222.v2')).toBe(true)
    // The regex is anchored at both ends.
    expect(audioAccess).toMatch(/const AUDIO_REF_REGEX = \/\^\(\[0-9a-f\]\{8\}-.*\)\(\?:\\\.v\(\[1-9\]\[0-9\]\{0,4\}\)\)\?\$\/i/)
  })

  it('the handler validates before it looks anything up, and the S3 key comes from the DB row, never from the request', () => {
    const validateAt = audioProxy.indexOf('if (!isValidAudioId(audioId))')
    const lookupAt = audioProxy.indexOf('lookupAudioRecord(supabase, audioId)')
    expect(validateAt).toBeGreaterThan(-1)
    expect(lookupAt).toBeGreaterThan(validateAt)
    expect(audioProxy).toContain('Key: sample.s3_key')
    expect(audioProxy).not.toMatch(/Key:\s*(req|audioId|query)/)
    // The lookups are bound-parameter `.eq('id', …)` calls on the bare uuid.
    expect(audioAccess).toMatch(/\.from\('course_audio'\)[\s\S]{0,200}\.eq\('id', audioId\)/)
    expect(audioAccess).toMatch(/\.from\('shared_audio'\)[\s\S]{0,120}\.eq\('id', audioId\)/)
  })

  it('every non-200 path that precedes the bytes is no-store; the bytes are browser-immutable but CDN no-store', () => {
    // CLAUDE.md says "streams audio from S3 with 1-year cache headers". As
    // verified against the code: the 1-year header is real but BROWSER-only;
    // both CDN headers are `no-store`, and the body is buffered whole
    // (transformToByteArray → res.send), not streamed.
    expect(audioProxy).toContain("res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')")
    expect(audioProxy).toContain("res.setHeader('Vercel-CDN-Cache-Control', 'no-store')")
    expect(audioProxy).toContain("res.setHeader('CDN-Cache-Control', 'no-store')")
    for (const status of ['404', '403', '500']) {
      const at = audioProxy.indexOf(`res.status(${status}).json(`)
      expect(at, `status ${status} present`).toBeGreaterThan(-1)
      expect(audioProxy.slice(Math.max(0, at - 120), at)).toContain("'no-store'")
    }
    expect(audioProxy).toMatch(/transformToByteArray[\s\S]*res\.send\(buffer\)/)
  })

  it('the entitlement gate is the shared resolver, and its fail-open default is the already-tracked INPUT-01 residual', () => {
    expect(audioProxy).toContain('resolveAudioEntitlement(req, fromCourseAudio')
    expect(audioAccess).toContain("export const ENTITLEMENT_STRICT = (process.env.ENTITLEMENT_ENFORCE || '').trim().toLowerCase() === 'strict'")
    expect(audioAccess).toMatch(/if \(ENTITLEMENT_STRICT\) \{\s*\n\s*return \{ allowed: false, gated: true \}/)
    // Not re-reported: see 08-25 remediation-notes.md and 09-01 area-d.
  })
})

describe('CLEARED — caller-supplied params on the five course endpoints', () => {
  it('[code] is regex-gated on bundle/cycles/infplay/round-map; sectors relies on the bound .eq() parameter', () => {
    for (const [name, s] of [['bundle', bundle], ['cycles', cycles], ['infplay', infplay], ['round-map', roundMap]] as const) {
      expect(s, `${name} declares COURSE_CODE_RE`).toMatch(/const COURSE_CODE_RE = \/\^\[a-z0-9_\]\+\$\//)
      expect(s, `${name} tests it`).toContain('COURSE_CODE_RE.test(code)')
    }
    // sectors.ts does not regex the code. It reaches only `.eq('base_course_code', …)`
    // and `.eq('course_code', …)` — bound PostgREST parameters, not a filter
    // string — so this is a consistency gap, not an injection. Recorded, not filed.
    expect(sectors).not.toContain('COURSE_CODE_RE')
    expect(sectors).toContain(".eq('base_course_code', baseCourseCode)")
    expect(sectors).not.toContain('.or(')
  })

  it('cycles.ts: `from` is SNNNNLNN-anchored, `limit` clamps to 50, and the one .or() filter string is built from parseInt output only', () => {
    expect(cycles).toMatch(/const LEGO_ID_RE = \/\^S\\d\{4\}L\\d\{2\}\$\//)
    expect(cycles).toContain('LEGO_ID_RE.test(from)')
    expect(cycles).toMatch(/limit = Math\.min\(parsed, MAX_LIMIT\)/)
    // The pairFilter interpolates `${seedNumber}` / `${legoIndex}` — keys that
    // were built as `${entry.seedNumber}:${entry.legoIndex}` from parseLegoId,
    // whose regex admits only \d{4} / \d{2} and whose output is parseInt'd.
    expect(cycles).toContain('return `and(seed_number.eq.${seedNumber},lego_index.eq.${legoIndex})`')
    expect(cycles).toContain('neededKeys.add(`${entry.seedNumber}:${entry.legoIndex}`)')
    expect(cycles).toMatch(/function parseLegoId\(legoId: string\)[\s\S]{0,120}\/\^S\(\\d\{4\}\)L\(\\d\{2\}\)\$\//)
  })

  it('infplay-cycles.ts: `limit` clamps to 15; `from_round` is parseInt ≥ 1 and only indexes an in-memory array', () => {
    expect(infplay).toContain('const MAX_LIMIT = 15')
    expect(infplay).toMatch(/limit = Math\.min\(n, MAX_LIMIT\)/)
    expect(infplay).toMatch(/if \(!Number\.isNaN\(n\) && n >= 1\) fromRound = n/)
    // Unbounded above, but it never reaches a query: it offsets `legoRows[…]`
    // reads, which simply return undefined past the end. Recorded, not filed.
    expect(infplay).not.toMatch(/fromRound[^\n]*\.(eq|gte|lte|range)\(/)
  })

  it('bundle.ts: the only other param is `?head=1`, and the head probe reads two constants and nothing gated', () => {
    expect(bundle).toContain("const isHeadProbe = req.query.head === '1'")
    const headBlock = bundle.slice(bundle.indexOf('if (isHeadProbe) {'), bundle.indexOf('// 9 queries in parallel'))
    expect(headBlock).toContain("select('content_version')")
    expect(headBlock).toContain("select('version')")
    expect(headBlock).not.toMatch(/known_text|target_text|audio_id/)
  })
})

describe('CLEARED — bundle.ts preview slice covers every content array', () => {
  it('legos, phrases, roundMap, seeds and pods are all scoped for a preview caller', () => {
    expect(bundle).toContain('const scopedRoundRows = previewOnly')
    // seeds derive from scopedRoundRows, so they inherit the ceiling.
    expect(bundle).toMatch(/for \(const r of scopedRoundRows\) \{[\s\S]{0,400}seedRowByNumber\.get\(r\.seed_number\)/)
    // pods are premium-only: an empty array on the preview slice.
    expect(bundle).toMatch(/const podRows: PodRow\[\] = previewOnly\s*\n\s*\? \[\]/)
    expect(bundle).toContain('mainLoopCount: scopedRoundRows.length')
    expect(bundle).toContain('if (previewOnly) bundle.previewOnly = true')
  })
})

describe('CLEARED — api/sw-config.ts and api/courses/available.ts', () => {
  it('sw-config serves three SW_* env values and nothing else — no keys, hosts or endpoints', () => {
    const envRefs = [...swConfig.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])
    expect(envRefs.sort()).toEqual(['SW_FORCE_UPDATE', 'SW_KILL_SWITCH', 'SW_MESSAGE'])
    expect(swConfig).toContain('res.status(200).json({ killSwitch, forceUpdate, message })')
    expect(swConfig).not.toMatch(/SUPABASE|AWS|SECRET|_KEY|createClient/)
  })

  it('available.ts projects catalogue columns only; its error.message leak is the already-known class', () => {
    expect(available).toContain("select('course_code, target_lang, known_lang, pricing_tier, new_app_status, display_name, learner_display_name')")
    expect(available).toContain("in('new_app_status', ['live', 'beta'])")
    expect(available).toContain('public, max-age=300, s-maxage=300')
    // Recurring class (SEC0901-C-03 / SEC0905-C-02), one line, not a finding.
    expect(available).toContain('res.status(500).json({ error: error.message })')
  })
})

describe('CLEARED — the `tester` shortcut in checkCourseAccess cannot be self-granted', () => {
  it("checkCourseAccess grants full paid content on platform_role === 'tester', and courseAccess.ts passes the column through", () => {
    // This is why the column lock below is load-bearing for Area E: every
    // course endpoint and batch-urls hang the paywall on this one branch.
    expect(pricingAccess).toContain("if (platformRole === 'ssi_admin' || platformRole === 'tester')")
    expect(courseAccess).toMatch(/: \(learner\?\.platform_role \?\? null\)/)
  })

  it('schema.sql: `authenticated` holds no UPDATE and no INSERT on platform_role or educational_role (20260811 lock)', () => {
    // Table-level: SELECT, DELETE, MAINTAIN only — no UPDATE, no INSERT.
    expect(schema).toContain('GRANT SELECT,DELETE,MAINTAIN ON TABLE public.learners TO authenticated;')
    expect(schema).not.toMatch(/GRANT [^\n]*\bUPDATE\b[^\n(]*ON TABLE public\.learners TO authenticated/)
    expect(schema).not.toMatch(/GRANT [^\n]*\bINSERT\b[^\n(]*ON TABLE public\.learners TO authenticated/)
    // Column-level: neither role column appears in any grant to authenticated.
    const learnerColumnGrants = [...schema.matchAll(/GRANT ([^\n]*) ON TABLE public\.learners TO authenticated;/g)].map((m) => m[1])
    expect(learnerColumnGrants.length).toBeGreaterThan(0)
    for (const g of learnerColumnGrants) {
      expect(g, `grant "${g}" must not touch a role column`).not.toMatch(/platform_role|educational_role/)
    }
    // And the own-row UPDATE policy still exists, so this is grant-layer, not policy-layer.
    expect(schema).toContain('CREATE POLICY learners_update_own ON public.learners FOR UPDATE TO authenticated')
  })
})
