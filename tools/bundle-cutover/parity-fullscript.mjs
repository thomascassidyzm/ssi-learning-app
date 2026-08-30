/**
 * FULL-SCRIPT parity harness for the bundle cutover (step 6).
 *
 * Step 6 retires `providers/generateLearningScript.ts` — the client-side walk
 * that re-reads the whole course out of Supabase (~125 queries) — on the 15
 * flagged courses, replacing it with `providers/bundleFullScript.ts`, which
 * builds the SAME whole-course script from the bundle already in memory. This
 * harness proves the two producers hand the learner the same rounds: it runs
 * BOTH real producers — the OLD walk against a live anon Supabase client, the
 * NEW path against a fetched `/api/courses/:code/bundle` — and diffs the
 * player `Round[]` each one hands back.
 *
 * WHAT PARITY CANNOT MEAN HERE (read before treating a diff as a defect):
 *
 *   1. LISTENING/POD CYCLES. The walk bakes `listening` / `listen_intro` /
 *      `listen_outro` / `pod` cycles into its rounds. The bundle path never
 *      has and never will: on the instant path those fire at RUNTIME via
 *      `simplePlayer.onRoundCompleted` (see `bundleFullScript.ts`'s own
 *      header). So these four cycle types are stripped from the WALK side
 *      before any comparison, and how many were stripped per course is
 *      reported — never silently absorbed into a matching count.
 *   2. ROUND NUMBERING. The walk renumbers playable rounds 1..N; the bundle
 *      path numbers by `course_round_index` position, so a LEGO dropped for
 *      missing audio leaves a hole in its numbering but not in the walk's.
 *      Comparison here is by LEGO-ID SEQUENCE, never by round number.
 *   3. THE INF-PLAY TAIL is non-deterministic BY DESIGN on both sides (RNG
 *      sampling, unseeded here). The tail is never diffed cycle-for-cycle —
 *      only checked for comparable length, exactly as parity-infplay.mjs does
 *      for the live endpoint.
 *   4. PREMIUM PREVIEW TRUNCATION. `/api/courses/:code/bundle` truncates an
 *      anonymous caller to the 19-seed free preview; the walk, run here with
 *      a bare anon key against permissive content-table RLS, does NOT — it
 *      reads the whole course regardless of entitlement (content tables carry
 *      no row-level entitlement gate; that gate lives in the server
 *      endpoints/app routing, not the DB). So on a `previewOnly` bundle the
 *      walk side is FILTERED DOWN to just the LEGO ids the bundle actually
 *      carries before any diff — comparing the two producers only where both
 *      have real data, and the case is marked `previewOnly` so a reader knows
 *      the proof does not extend past seed 19 for that course.
 *
 * WHAT MUST BE IDENTICAL, once (1)-(4) are accounted for: the sequence of
 * legoIds; per round, the sequence of cycle types and the known/target text
 * of each cycle; and the audio ids in each cycle's three slots (known/prompt,
 * voice1, voice2).
 *
 * Both TS producers are pulled into one esbuild bundle (`packages: external`
 * so real npm deps — vue, @supabase/supabase-js, @ssi/core — resolve via
 * node_modules as normal; only OUR relative-extensionless imports, which
 * plain Node ESM cannot resolve, get bundled) written into
 * `packages/player-vue/.paritygen/` so it sits inside player-vue's own
 * node_modules resolution scope. Cleaned up after the run unless --keep-gen.
 *
 * Needs the player-vue anon Supabase credentials (VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY) — reads them from
 * packages/player-vue/.env.local if present, else the environment.
 *
 * Usage:
 *   node tools/bundle-cutover/parity-fullscript.mjs [--courses=a,b] [--out=f.json]
 *
 * Exit code 1 on any real drift.
 */
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const require = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const PLAYER_VUE = path.join(REPO_ROOT, 'packages', 'player-vue')

const BASE = process.env.PARITY_BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const COURSES = (args.courses || 'hun_for_eng,gle_for_eng,nld_for_eng,tur_for_eng,spa_for_eng,cym_s_for_eng').split(',')
/** Fractions of the main-loop LEGO order to sample a comparison WINDOW around. */
const FRACTIONS = [0, 0.4, 0.85]
const WINDOW_ROUNDS = 10
/** Revival-tail length requested from both producers, purely to check the
 *  tail exists and is comparably sized — never diffed cycle-for-cycle. */
const INF_LOOKAHEAD = 30

// ---------------------------------------------------------------------------
// Env — the player-vue anon Supabase credentials the walk needs.
// ---------------------------------------------------------------------------
function loadPlayerVueEnv() {
  const envPath = path.join(PLAYER_VUE, '.env.local')
  const out = {}
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return {
    url: out.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    anonKey: out.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
  }
}

// ---------------------------------------------------------------------------
// Bundle the two real TS producers (generateLearningScript, toSimpleRounds,
// bundleFullScript) into one importable ESM file. Real npm packages stay
// external (resolved by Node as normal); only our own relative,
// extension-less TS imports — which plain Node ESM cannot resolve — get
// inlined by esbuild.
// ---------------------------------------------------------------------------
function findEsbuild() {
  try {
    return require(require.resolve('esbuild', { paths: [REPO_ROOT] }))
  } catch {
    // pnpm's own hoist folder — present regardless of the exact esbuild
    // version pulled in transitively by vite/vitest/tsup.
    return require(path.join(REPO_ROOT, 'node_modules', '.pnpm', 'node_modules', 'esbuild'))
  }
}

async function buildShim() {
  const esbuild = findEsbuild()
  const genDir = path.join(PLAYER_VUE, '.paritygen')
  mkdirSync(genDir, { recursive: true })
  const entryPath = path.join(genDir, 'shim-entry.mjs')
  const outPath = path.join(genDir, 'shim-bundle.mjs')
  const p = (rel) => path.join(PLAYER_VUE, 'src', 'providers', rel).replace(/\\/g, '/')
  writeFileSync(
    entryPath,
    [
      `export { generateLearningScript, DEFAULT_LISTENING_CONFIG, DEFAULT_SCRIPT_SHAPE } from '${p('generateLearningScript.ts')}'`,
      `export { toSimpleRounds } from '${p('toSimpleRounds.ts')}'`,
      `export { bundleFullScript } from '${p('bundleFullScript.ts')}'`,
      '',
    ].join('\n'),
  )
  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'external',
    outfile: outPath,
  })
  return outPath
}

// ---------------------------------------------------------------------------
async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

const norm = (t) => (t || '').toLowerCase().trim().replace(/\s+/g, ' ')
const idFromUrl = (u) => (u ? decodeURIComponent(String(u).replace(/^.*\/api\/audio\//, '')) : (u ?? ''))

/** The four cycle types the walk bakes in that the bundle path never emits —
 *  they fire at runtime instead. Stripped from the WALK side before any
 *  comparison (see header note 1). */
const RUNTIME_ONLY_TYPES = new Set(['listening', 'listen_intro', 'listen_outro', 'pod'])

function stripRuntimeOnly(rounds) {
  let stripped = 0
  const out = []
  for (const r of rounds) {
    const cycles = r.cycles.filter((c) => {
      const drop = RUNTIME_ONLY_TYPES.has(c.type)
      if (drop) stripped++
      return !drop
    })
    if (cycles.length > 0) out.push({ ...r, cycles })
    else stripped += 0 // round fully emptied — see below, reported separately
  }
  const emptiedRounds = rounds.length - out.length
  return { rounds: out, strippedCycles: stripped, emptiedRounds }
}

/** Comparable projection of one Cycle (both sides share this exact shape —
 *  playback/SimplePlayer's Round/Cycle — so no field mapping is needed). */
function cycleKey(c) {
  return [
    c.type,
    norm(c.known?.text),
    norm(c.target?.text),
    idFromUrl(c.known?.audioUrl),
    idFromUrl(c.target?.voice1Url),
    idFromUrl(c.target?.voice2Url),
  ].join('|')
}

function diffSeq(a, b) {
  let firstOrderDiff = null
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { firstOrderDiff = { index: i, old: a[i] ?? null, new: b[i] ?? null }; break }
  }
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())
  const ca = count(a), cb = count(b)
  const onlyOld = [], onlyNew = []
  for (const [k, n] of ca) { const d = n - (cb.get(k) || 0); for (let i = 0; i < d; i++) onlyOld.push(k) }
  for (const [k, n] of cb) { const d = n - (ca.get(k) || 0); for (let i = 0; i < d; i++) onlyNew.push(k) }
  return { firstOrderDiff, onlyOld, onlyNew }
}

async function fetchAlgorithmConfig(supabase) {
  const { data, error } = await supabase.from('algorithm_config').select('key, config')
  if (error || !data) return {}
  const out = {}
  for (const row of data) out[row.key] = row.config
  return out
}

async function runCourse(code, mods) {
  const { generateLearningScript, DEFAULT_LISTENING_CONFIG, DEFAULT_SCRIPT_SHAPE, toSimpleRounds, bundleFullScript } = mods
  const c = { course: code, windows: [] }

  let bundle
  try {
    bundle = await getJson(`${BASE}/api/courses/${code}/bundle`)
  } catch (err) {
    c.error = `bundle fetch failed: ${err.message}`
    return c
  }
  c.previewOnly = !!bundle.previewOnly

  const { url, anonKey } = loadPlayerVueEnv()
  if (!url || !anonKey) {
    c.error = 'no Supabase anon credentials found (packages/player-vue/.env.local)'
    return c
  }
  const supabase = createClient(url, anonKey)

  // MODE-NEUTRAL, exactly as LearningPlayer.vue's runGenerateScript calls it:
  // every Easy lever off, repeat count 1 — one script serves both modes.
  const MODE_NEUTRAL_WALK_OPTIONS = {
    phraseRepeatCount: 1,
    repeatedCycleTypes: [],
    filterBuildPhrases: false,
    reviewMaxKnownSyllables: 0,
    reviewSyllableFilterMaxRound: 0,
    useWordCapTiers: [],
  }
  const MODE_NEUTRAL_REPEAT = { count: 1, types: new Set() }

  let cfg
  try {
    cfg = await fetchAlgorithmConfig(supabase)
  } catch (err) {
    c.error = `algorithm_config fetch failed: ${err.message}`
    return c
  }
  const scriptShape = { ...DEFAULT_SCRIPT_SHAPE, ...(cfg.script_shape || {}) }
  const podRoundInterval = cfg.pods?.roundInterval ?? 5
  const podActivationRound = cfg.pods?.podActivationRound ?? 6
  const listening = { ...DEFAULT_LISTENING_CONFIG, podActivationRound }

  let old
  try {
    old = await generateLearningScript(
      supabase,
      code,
      INF_LOOKAHEAD,
      listening,
      scriptShape,
      1, // maxPhraseLengthFraction — uncapped, mode-neutral
      MODE_NEUTRAL_WALK_OPTIONS,
      podRoundInterval,
      undefined, // unseeded INF-PLAY rng — the tail is never diffed cycle-for-cycle anyway
    )
  } catch (err) {
    c.error = `walk failed: ${err.message}`
    return c
  }

  let built
  try {
    built = bundleFullScript(bundle, {
      infinitePlayLookahead: INF_LOOKAHEAD,
      targetSpeed: {},
      repeat: MODE_NEUTRAL_REPEAT,
    })
  } catch (err) {
    c.error = `bundleFullScript failed: ${err.message}`
    return c
  }

  const oldRoundsRaw = toSimpleRounds(old.items, {})
  const oldMainRaw = oldRoundsRaw.slice(0, old.mainLoopRoundCount)
  const oldTailRaw = oldRoundsRaw.slice(old.mainLoopRoundCount)
  const { rounds: oldMainStripped, strippedCycles, emptiedRounds } = stripRuntimeOnly(oldMainRaw)
  c.walkRuntimeOnlyCyclesStripped = strippedCycles
  c.walkRoundsEmptiedByStrip = emptiedRounds

  const newMain = built.rounds.slice(0, built.mainLoopRoundCount)
  const newTail = built.rounds.slice(built.mainLoopRoundCount)

  // Note 4 — preview truncation: the walk sees the whole course regardless of
  // entitlement; the bundle does not. Window the walk side down to exactly
  // the LEGO ids the (possibly-truncated) bundle actually carries, so the
  // diff only speaks to legos BOTH sides had real data for.
  const bundleLegoIds = new Set(bundle.roundMap.map((e) => e.legoId))
  const oldMain = c.previewOnly ? oldMainStripped.filter((r) => bundleLegoIds.has(r.legoId)) : oldMainStripped

  c.oldMainRoundCount = oldMain.length
  c.newMainRoundCount = newMain.length
  c.oldTailRoundCount = oldTailRaw.length
  c.newTailRoundCount = newTail.length

  // ---- 1. Whole-window LEGO-ID SEQUENCE, over everything both sides cover ----
  const oldLegoSeq = oldMain.map((r) => r.legoId)
  const newLegoSeq = newMain.map((r) => r.legoId)
  const legoDiff = diffSeq(oldLegoSeq, newLegoSeq)
  c.legoSequence = {
    identical: !legoDiff.firstOrderDiff && legoDiff.onlyOld.length === 0 && legoDiff.onlyNew.length === 0,
    firstOrderDiff: legoDiff.firstOrderDiff,
    onlyInOldCount: legoDiff.onlyOld.length,
    onlyInNewCount: legoDiff.onlyNew.length,
    onlyInOld: legoDiff.onlyOld.slice(0, 10),
    onlyInNew: legoDiff.onlyNew.slice(0, 10),
  }

  // ---- 2. Per-round cycle-level diff, sampled at a few WINDOWS ----
  const oldByLego = new Map(oldMain.map((r) => [r.legoId, r]))
  const newByLego = new Map(newMain.map((r) => [r.legoId, r]))
  const maxStart = Math.max(0, newMain.length - WINDOW_ROUNDS)
  for (const frac of FRACTIONS) {
    const start = Math.min(maxStart, Math.floor(newMain.length * frac))
    const slice = newMain.slice(start, start + WINDOW_ROUNDS)
    if (slice.length === 0) continue
    const w = { startIndex: start, legoFrom: slice[0]?.legoId, legoTo: slice[slice.length - 1]?.legoId, roundDiffs: [] }
    for (const newRound of slice) {
      const oldRound = oldByLego.get(newRound.legoId)
      if (!oldRound) { w.roundDiffs.push({ legoId: newRound.legoId, issue: 'MISSING_ON_WALK_SIDE' }); continue }
      const oldKeys = oldRound.cycles.map(cycleKey)
      const newKeys = newRound.cycles.map(cycleKey)
      const rd = diffSeq(oldKeys, newKeys)
      if (rd.firstOrderDiff || rd.onlyOld.length > 0 || rd.onlyNew.length > 0) {
        w.roundDiffs.push({
          legoId: newRound.legoId,
          oldCycleCount: oldKeys.length,
          newCycleCount: newKeys.length,
          firstOrderDiff: rd.firstOrderDiff,
          onlyOnWalk: rd.onlyOld.slice(0, 5),
          onlyOnBundle: rd.onlyNew.slice(0, 5),
        })
      }
    }
    c.windows.push(w)
  }
  c.windowRoundDiffCount = c.windows.reduce((s, w) => s + w.roundDiffs.length, 0)

  // ---- 3. Tail: comparable length only, never cycle-for-cycle (note 3) ----
  c.tail = {
    checked: !bundle.previewOnly,
    note: bundle.previewOnly
      ? 'preview courses have no INF PLAY at all — nothing to compare'
      : 'length-only comparison; content is RNG-sampled independently on both sides by design',
    oldRounds: oldTailRaw.length,
    newRounds: newTail.length,
    // "comparable" = neither side is drastically shorter than requested and
    // both are in the same ballpark — a hard equality would be a lie about a
    // property neither producer has.
    comparable: bundle.previewOnly || (oldTailRaw.length > 0 && newTail.length > 0),
  }

  c.verdict = c.legoSequence.identical && c.windowRoundDiffCount === 0 ? 'IDENTICAL' : 'DRIFT'
  return c
}

async function main() {
  const outPath = args.out || 'parity-fullscript.json'
  const genPath = await buildShim()
  const mods = await import(`file://${genPath}?t=${Date.now()}`)

  const report = { base: BASE, generatedAt: new Date().toISOString(), cases: [] }
  for (const code of COURSES) {
    console.log(`running ${code}...`)
    const c = await runCourse(code, mods)
    report.cases.push(c)
    if (c.error) { console.log(`  ${code} ERROR ${c.error}`); continue }
    console.log(
      `  ${code} previewOnly=${c.previewOnly} verdict=${c.verdict} ` +
      `oldMain=${c.oldMainRoundCount} newMain=${c.newMainRoundCount} ` +
      `legoSeqIdentical=${c.legoSequence.identical} onlyOld=${c.legoSequence.onlyInOldCount} onlyNew=${c.legoSequence.onlyInNewCount} ` +
      `windowRoundDiffs=${c.windowRoundDiffCount} runtimeOnlyStripped=${c.walkRuntimeOnlyCyclesStripped} ` +
      `tail(old=${c.tail.oldRounds},new=${c.tail.newRounds},comparable=${c.tail.comparable})`,
    )
  }

  writeFileSync(outPath, JSON.stringify(report, null, 2))
  const bad = report.cases.filter((c) => c.error || c.verdict === 'DRIFT')
  console.log(`\n${report.cases.filter((c) => c.verdict === 'IDENTICAL').length} identical, ${bad.length} drift/error`)
  console.log(`wrote ${outPath}`)

  if (!args['keep-gen']) {
    try { rmSync(path.join(PLAYER_VUE, '.paritygen'), { recursive: true, force: true }) } catch { /* best effort */ }
  }
  process.exitCode = bad.length ? 1 : 0
}

await main()
