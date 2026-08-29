/**
 * Golden-master parity harness — bundle+generateScript vs the LIVE /cycles endpoint.
 *
 * Bundle-cutover design §5 step 3 ("golden-master test: for N courses,
 * artifact-id-pinned output diffed against the old path's emission for the
 * same inputs"). The old path for the BOOTSTRAP cutover (step 5) is path (b),
 * the JIT endpoints — so THIS harness diffs against /api/courses/:code/cycles,
 * which is the thing the bootstrap cutover retires. (The step-6 full-walk
 * cutover needs a second harness against generateLearningScript; not this one.)
 *
 * Read-only. Hits the deployed dev branch alias, no DB credentials, no app boot.
 *
 *   node tools/bundle-cutover/parity-cycles.mjs [--courses a,b] [--out file.json]
 */
import { writeFileSync } from 'node:fs'
import { generateScript } from '../../packages/core/dist/index.mjs'

const BASE = process.env.PARITY_BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')),
)
const COURSES = (args.courses || 'gle_for_eng,nld_for_eng,hun_for_eng,tur_for_eng').split(',')
const START_FRACTIONS = [0, 0.25, 0.6]
const ROUND_LIMIT = 6
/** /cycles caps at MAX_LIMIT=50 cycles per response, so the old side is PAGED
 *  via next_lego_id until it has covered every LEGO the generator emitted. */
const API_PAGE = 50

async function getJson(url) {
  const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

/** Comparable projection of one cycle, whichever side produced it. */
const norm = (t) => (t || '').toLowerCase().trim().replace(/\s+/g, ' ')
function keyOfApi(c) {
  // Intro prompt = presentation || known (the client's own resolution in
  // backendCyclesToRounds.toPlayerCycle); the endpoint carries known_id on an
  // intro only as that fallback, so it is not a second clip to diff.
  const prompt = c.type === 'intro'
    ? (c.audio?.presentation_id || c.audio?.known_id || '')
    : (c.audio?.known_id || '')
  return [c.type, c.lego_id, norm(c.known_text), norm(c.target_text),
    prompt, c.audio?.target1_id || '', c.audio?.target2_id || ''].join('|')
}
const idFromUrl = (u) => (u ? decodeURIComponent(String(u).replace(/^.*\/api\/audio\//, '')) : '')
function keyOfGen(c) {
  // generator's 'review' == endpoint's 'spaced_rep'
  const type = c.type === 'review' ? 'spaced_rep' : c.type
  return [type, c.legoId, norm(c.known.text), norm(c.target.text),
    idFromUrl(c.known.audioUrl), idFromUrl(c.target.voice1Url), idFromUrl(c.target.voice2Url)].join('|')
}

function diffSeq(a, b) {
  // multiset diff + first ordering divergence
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

const report = { base: BASE, generatedAt: new Date().toISOString(), cases: [] }

for (const code of COURSES) {
  let bundle
  try {
    bundle = await getJson(`${BASE}/api/courses/${code}/bundle`)
  } catch (err) {
    report.cases.push({ course: code, error: `bundle fetch failed: ${err.message}` })
    continue
  }
  const map = bundle.roundMap || []
  for (const frac of START_FRACTIONS) {
    const startIdx = Math.min(map.length - 1, Math.floor(map.length * frac))
    const entry = map[startIdx]
    if (!entry) continue
    const c = { course: code, previewOnly: !!bundle.previewOnly, from: entry.legoId, roundIndex: entry.roundIndex, roundLimit: ROUND_LIMIT }
    try {
      // NEW path: pure generator over the bundle
      const gen = generateScript({ bundle, position: { mode: 'main', fromLegoId: entry.legoId }, roundLimit: ROUND_LIMIT, random: () => 0.5 })
      const genRounds = gen.rounds
      // OLD path: live /cycles, asked for more cycles than we need, then
      // truncated to exactly the LEGOs the generator emitted rounds for.
      const wanted = new Set(genRounds.map((r) => r.legoId))
      const apiCycles = []
      // /cycles pages OVERLAP by design: when a page stops mid-LEGO its
      // next_lego_id is THAT lego, so the next page replays the remainder
      // ("the frontend can de-dupe by cycle.id"). Do exactly that.
      const seenCycleIds = new Set()
      let cursor = entry.legoId
      let currentLego = null
      let pages = 0
      const seenLegos = new Set()
      while (cursor && pages < 20) {
        const api = await getJson(`${BASE}/api/courses/${code}/cycles?from=${encodeURIComponent(cursor)}&limit=${API_PAGE}`)
        pages++
        for (const cyc of api.cycles || []) {
          if (cyc.type === 'intro' || cyc.type === 'debut') { currentLego = cyc.lego_id; seenLegos.add(currentLego) }
          if (currentLego && !wanted.has(currentLego)) continue
          // Key on ROUND-OWNER + cycle id: a spaced-rep cycle id
          // (`S0160L02_spaced_rep_1`) legitimately repeats across rounds, so a
          // bare id dedupe silently eats real cycles.
          const dedupeKey = `${currentLego}::${cyc.id}`
          if (seenCycleIds.has(dedupeKey)) continue
          seenCycleIds.add(dedupeKey)
          apiCycles.push(cyc)
        }
        cursor = api.next_lego_id
        // Keep paging while the cursor still points INSIDE the wanted window.
        // Stopping at "all wanted LEGOs introduced" truncates the last LEGO's
        // round, because a page can stop mid-LEGO at the 50-cycle cap.
        if (!cursor || !wanted.has(cursor)) break
      }
      c.pages = pages
      const oldKeys = apiCycles.map(keyOfApi)
      const newKeys = genRounds.flatMap((r) => r.cycles.map(keyOfGen))
      // SEED-PHASE reviews (offsets ≥144, the full parent seed sentence) are a
      // DOCUMENTED gap in /cycles ("KNOWN GAPS vs the walk" in cycles.ts) — the
      // generator has them because the walk has them. Extras of exactly that
      // shape are expected, not drift.
      const seedPhaseKeys = new Set(
        genRounds.flatMap((r) => r.cycles.filter((x) => x.id.endsWith('_seedrep')).map(keyOfGen)),
      )
      const d = diffSeq(oldKeys, newKeys)
      c.oldCycles = oldKeys.length
      c.newCycles = newKeys.length
      c.identical = d.onlyOld.length === 0 && d.onlyNew.length === 0 && !d.firstOrderDiff
      c.byType = { old: tally(apiCycles.map((x) => x.type)), new: tally(genRounds.flatMap((r) => r.cycles.map((x) => (x.type === 'review' ? 'spaced_rep' : x.type)))) }
      c.onlyInOld = d.onlyOld.slice(0, 12)
      c.onlyInNew = d.onlyNew.slice(0, 12)
      c.onlyInOldCount = d.onlyOld.length
      c.onlyInNewCount = d.onlyNew.length
      c.firstOrderDiff = d.firstOrderDiff
      c.extrasAreAllSeedPhase = d.onlyNew.every((k) => seedPhaseKeys.has(k))
      c.verdict = c.identical
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

function tally(xs) { const o = {}; for (const x of xs) o[x] = (o[x] || 0) + 1; return o }

const out = args.out || 'parity-cycles-report.json'
writeFileSync(out, JSON.stringify(report, null, 2))
for (const c of report.cases) {
  if (c.error) { console.log(`${c.course} ${c.from ?? ''} ERROR ${c.error}`); continue }
  console.log(`${c.course} from=${c.from} old=${c.oldCycles} new=${c.newCycles} ${c.verdict} onlyOld=${c.onlyInOldCount} onlyNew=${c.onlyInNewCount}`)
  console.log(`   types old=${JSON.stringify(c.byType.old)} new=${JSON.stringify(c.byType.new)}`)
}
const drift = report.cases.filter((c) => c.error || c.verdict === 'DRIFT')
console.log(`\n${report.cases.filter((c) => c.verdict === 'IDENTICAL').length} identical, ` +
  `${report.cases.filter((c) => c.verdict === 'SUPERSET_SEED_PHASE_ONLY').length} superset (seed-phase only), ` +
  `${drift.length} drift/error`)
console.log(`wrote ${out}`)
process.exitCode = drift.length ? 1 : 0
