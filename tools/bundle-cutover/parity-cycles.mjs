/**
 * Golden-master parity harness for the bundle cutover.
 *
 * Design §5 step 3: "for N courses, artifact-id-pinned output diffed against
 * the old path's emission for the same inputs". The old path being retired by
 * the BOOTSTRAP cutover (step 5) is path (b) — the JIT endpoints — so this
 * harness diffs against the LIVE `/api/courses/:code/cycles`, page by page,
 * exactly as `useInstantPlayback` walks it.
 *
 * Two modes, both read-only, both against the deployed dev alias — no DB
 * credentials, no app boot, no test suite:
 *
 *   generator  (default) — @ssi/core generateScript over the bundle
 *   --wire              — providers/bundleToBackendCycles, i.e. the exact
 *                         payload the cutover feeds useInstantPlayback
 *
 * Usage:
 *   node tools/bundle-cutover/parity-cycles.mjs [--wire] [--courses=a,b] [--out=f.json]
 *   (--wire needs node ≥22 for TypeScript stripping)
 *
 * Exit code 1 if any case is DRIFT. SUPERSET_SEED_PHASE_ONLY is a PASS: the
 * generator schedules reviews at the SEED-PHASE offsets (≥144) that cycles.ts
 * documents as a deliberate gap versus the walk, so extra cycles at exactly
 * those offsets are the generator being ahead, never being different.
 *
 * That tier is judged by the OFFSET, not by the cycle's id. When the parent
 * seed has no target audio — 205 of cym_s_for_eng's 332 seeds — both the walk
 * and the generator fall back to an ordinary use-phrase review rather than
 * emit an empty one, so a legitimate seed-phase-tier extra can arrive without
 * a `_seedrep` id. Matching on the id alone called that DRIFT until
 * 2026-08-29.
 *
 * NO_AUDIO is neither: both sides emitted nothing playable, so the case proves
 * nothing about the generator and the course must not be flagged on it. It was
 * a silent 0-vs-0 "IDENTICAL" until 2026-08-29, which is how fin_for_eng — a
 * 1,394-round course with no audio rendered at all — passed vacuously.
 *
 * WHAT IS COMPARED: the cycles the PLAYER would actually keep. Both paths feed
 * `backendCyclesToRounds`, whose `toPlayerCycle` drops any cycle missing the
 * audio it needs (intro: both target voices; everything else: known + both
 * voices), and drops the round outright when that leaves it empty. The old
 * endpoint emits those unplayable cycles onto the wire and lets the client bin
 * them; the generator declines to build them in the first place. Diffing raw
 * wire output therefore reports a difference the learner can never hear — so
 * the same audio gate is applied to BOTH sides here, and how many cycles it
 * removed from the old side is reported per case, never smoothed away.
 */
import { writeFileSync } from 'node:fs'
import { generateScript } from '../../packages/core/dist/index.mjs'

const BASE = process.env.PARITY_BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const COURSES = (args.courses || 'gle_for_eng,nld_for_eng,hun_for_eng,tur_for_eng').split(',')
const START_FRACTIONS = [0, 0.25, 0.6]
const ROUND_LIMIT = 6
/** Matches useInstantPlayback's BOOTSTRAP_LIMIT — the real client page size. */
const PAGE_LIMIT = 25
/** The offsets `/cycles` documents itself as not emitting (its own
 *  SPACED_REP_OFFSETS stops at 89). Everything the generator schedules here is
 *  the known gap, whatever shape the cycle ends up taking. */
const SEED_PHASE_OFFSETS = [144, 233, 377, 610, 987, 1597, 2584]
const WIRE = 'wire' in args

let bundleToCyclesResponse = null
if (WIRE) {
  ;({ bundleToCyclesResponse } = await import(
    new URL('../../packages/player-vue/src/providers/bundleToBackendCycles.ts', import.meta.url).href
  ))
}

/**
 * A premium course is truncated to the 19-seed free preview for an anonymous
 * caller — on BOTH endpoints, by the same `resolveServerCourseAccess` call —
 * so parity past seed 19 needs a real entitled session. Set PARITY_TOKEN to a
 * Supabase access token and every fetch here carries it; without one the run
 * is still valid, it just only proves the preview window (each case records
 * `previewOnly`).
 */
const TOKEN = (process.env.PARITY_TOKEN || '').trim()
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : undefined

async function getJson(url) {
  const res = await fetch(url, AUTH ? { headers: AUTH } : undefined)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

const norm = (t) => (t || '').toLowerCase().trim().replace(/\s+/g, ' ')

/**
 * `toPlayerCycle`'s audio-completeness gate, verbatim
 * (providers/backendCyclesToRounds.ts): an intro needs both target voices —
 * its prompt is presentation-or-known and may be absent — and every other
 * cycle needs known + both voices. A cycle that fails this is dropped by the
 * client on BOTH paths, so it is not part of what parity is about.
 */
function playableOnWire(c) {
  const a = c.audio || {}
  if (c.type === 'intro') return !!(a.target1_id && a.target2_id)
  return !!(a.known_id && a.target1_id && a.target2_id)
}
const idFromUrl = (u) => (u ? decodeURIComponent(String(u).replace(/^.*\/api\/audio\//, '')) : '')

/** Comparable projection of one WIRE cycle (both sides speak this shape). */
function keyOfWire(c) {
  const prompt = c.type === 'intro'
    ? (c.audio?.presentation_id || c.audio?.known_id || '')
    : (c.audio?.known_id || '')
  return [c.type, c.lego_id, norm(c.known_text), norm(c.target_text),
    prompt, c.audio?.target1_id || '', c.audio?.target2_id || ''].join('|')
}
/** …and of one GENERATED cycle, mapped onto the same projection. */
function keyOfGen(c) {
  const type = c.type === 'review' ? 'spaced_rep' : c.type
  return [type, c.legoId, norm(c.known.text), norm(c.target.text),
    idFromUrl(c.known.audioUrl), idFromUrl(c.target.voice1Url), idFromUrl(c.target.voice2Url)].join('|')
}

/**
 * Walk a paginated cycles producer the way the client does, keeping only the
 * cycles belonging to `wanted` rounds.
 *
 * Pages OVERLAP by design — a page that stops mid-LEGO returns that LEGO as
 * its cursor and the next page replays it from the start ("the frontend can
 * de-dupe by cycle.id"). De-dupe on ROUND-OWNER + id: a spaced-rep cycle id
 * legitimately repeats across rounds, so a bare id de-dupe eats real cycles.
 */
async function walk(fetchPage, from, wanted) {
  const out = []
  const seen = new Set()
  let cursor = from
  let currentLego = null
  let pages = 0
  while (cursor && pages < 30) {
    const page = await fetchPage(cursor)
    pages++
    for (const cyc of page.cycles || []) {
      if (cyc.type === 'intro' || cyc.type === 'debut') currentLego = cyc.lego_id
      const owner = cyc.round_lego_id ?? currentLego
      if (owner && !wanted.has(owner)) continue
      const k = `${owner}::${cyc.id}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(cyc)
    }
    cursor = page.next_lego_id
    if (!cursor || !wanted.has(cursor)) break
  }
  return { cycles: out, pages }
}

function diffSeq(a, b) {
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())
  const ca = count(a), cb = count(b)
  const onlyOld = [], onlyNew = []
  for (const [k, n] of ca) { const d = n - (cb.get(k) || 0); for (let i = 0; i < d; i++) onlyOld.push(k) }
  for (const [k, n] of cb) { const d = n - (ca.get(k) || 0); for (let i = 0; i < d; i++) onlyNew.push(k) }
  let firstOrderDiff = null
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { firstOrderDiff = { index: i, old: a[i] ?? null, new: b[i] ?? null }; break }
  }
  return { onlyOld, onlyNew, firstOrderDiff }
}

const tally = (xs) => xs.reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {})

const report = { base: BASE, mode: WIRE ? 'wire' : 'generator', generatedAt: new Date().toISOString(), cases: [] }

for (const code of COURSES) {
  let bundle
  try {
    bundle = await getJson(`${BASE}/api/courses/${code}/bundle`)
  } catch (err) {
    report.cases.push({ course: code, error: `bundle fetch failed: ${err.message}` })
    continue
  }
  const map = bundle.roundMap || []
  const roundIndexOf = new Map(map.map((e) => [e.legoId, e.roundIndex]))
  for (const frac of START_FRACTIONS) {
    const entry = map[Math.min(map.length - 1, Math.floor(map.length * frac))]
    if (!entry) continue
    const c = { course: code, previewOnly: !!bundle.previewOnly, from: entry.legoId, roundIndex: entry.roundIndex, roundLimit: ROUND_LIMIT }
    try {
      // ---- NEW side ----
      const gen = generateScript({ bundle, position: { mode: 'main', fromLegoId: entry.legoId }, roundLimit: ROUND_LIMIT, random: () => 0.5 })
      const wanted = new Set(gen.rounds.map((r) => r.legoId))
      // Which LEGOs each round reviews at a SEED-PHASE offset — the
      // generator's own `currentRoundIndex - offset` lookup, replayed here so
      // the tier is identified by scheduling position rather than by id shape.
      const seedPhaseLegos = new Set()
      for (const r of gen.rounds) {
        const roundIndex = roundIndexOf.get(r.legoId)
        if (!roundIndex) continue
        for (const offset of SEED_PHASE_OFFSETS) {
          const reviewed = map[roundIndex - offset - 1]
          if (reviewed) seedPhaseLegos.add(reviewed.legoId)
        }
      }
      const seedPhaseKeys = new Set(
        gen.rounds.flatMap((r) =>
          r.cycles
            .filter((x) => x.id.endsWith('_seedrep') || (x.type === 'review' && seedPhaseLegos.has(x.legoId)))
            .map(keyOfGen),
        ),
      )
      let newKeys, newTypes
      if (WIRE) {
        const w = await walk((cursor) => Promise.resolve(bundleToCyclesResponse(bundle, cursor, PAGE_LIMIT)), entry.legoId, wanted)
        newKeys = w.cycles.map(keyOfWire)
        newTypes = tally(w.cycles.map((x) => x.type))
        c.newPages = w.pages
      } else {
        newKeys = gen.rounds.flatMap((r) => r.cycles.map(keyOfGen))
        newTypes = tally(gen.rounds.flatMap((r) => r.cycles.map((x) => (x.type === 'review' ? 'spaced_rep' : x.type))))
      }

      // ---- OLD side: the live endpoint ----
      const old = await walk(
        (cursor) => getJson(`${BASE}/api/courses/${code}/cycles?from=${encodeURIComponent(cursor)}&limit=${PAGE_LIMIT}`),
        entry.legoId,
        wanted,
      )
      const oldPlayable = old.cycles.filter(playableOnWire)
      const oldKeys = oldPlayable.map(keyOfWire)
      c.oldDroppedUnplayable = old.cycles.length - oldPlayable.length

      const d = diffSeq(oldKeys, newKeys)
      c.oldCycles = oldKeys.length
      c.oldCyclesOnWire = old.cycles.length
      c.newCycles = newKeys.length
      c.oldPages = old.pages
      c.byType = { old: tally(oldPlayable.map((x) => x.type)), new: newTypes }
      c.identical = d.onlyOld.length === 0 && d.onlyNew.length === 0 && !d.firstOrderDiff
      c.onlyInOld = d.onlyOld.slice(0, 12)
      c.onlyInNew = d.onlyNew.slice(0, 12)
      c.onlyInOldCount = d.onlyOld.length
      c.onlyInNewCount = d.onlyNew.length
      c.firstOrderDiff = d.firstOrderDiff
      c.extrasAreAllSeedPhase = d.onlyNew.every((k) => seedPhaseKeys.has(k))
      c.verdict = oldKeys.length === 0 && newKeys.length === 0
        ? 'NO_AUDIO'
        : c.identical
        ? 'IDENTICAL'
        : d.onlyOld.length === 0 && c.extrasAreAllSeedPhase
          ? 'SUPERSET_SEED_PHASE_ONLY'
          : 'DRIFT'
    } catch (err) {
      c.error = err.message
    }
    report.cases.push(c)
  }
}

const out = args.out || `parity-cycles-${report.mode}.json`
writeFileSync(out, JSON.stringify(report, null, 2))
for (const c of report.cases) {
  if (c.error) { console.log(`${c.course} ${c.from ?? ''} ERROR ${c.error}`); continue }
  console.log(
    `${c.course} from=${c.from} old=${c.oldCycles} new=${c.newCycles} ${c.verdict} ` +
      `onlyOld=${c.onlyInOldCount} onlyNew=${c.onlyInNewCount} unplayableDroppedFromOld=${c.oldDroppedUnplayable}`,
  )
}
const drift = report.cases.filter((c) => c.error || c.verdict === 'DRIFT')
const noAudio = report.cases.filter((c) => c.verdict === 'NO_AUDIO')
console.log(`\nmode=${report.mode}: ` +
  `${report.cases.filter((c) => c.verdict === 'IDENTICAL').length} identical, ` +
  `${report.cases.filter((c) => c.verdict === 'SUPERSET_SEED_PHASE_ONLY').length} superset (seed-phase only), ` +
  `${noAudio.length} no-audio (PROVES NOTHING), ` +
  `${drift.length} drift/error`)
console.log(`wrote ${out}`)
process.exitCode = drift.length ? 1 : 0
