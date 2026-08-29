/**
 * INF PLAY parity harness for the bundle cutover (step 5b).
 *
 * The main-loop harness (`parity-cycles.mjs`) diffs cycle for cycle because
 * both producers there are deterministic. INF PLAY is not, and says so:
 * "subsequent requests with the SAME from_round may return DIFFERENT cycles —
 * that's expected for INF PLAY where variety > determinism". Both the
 * random-USE LEGO sample and the spaced-rep phrase draw are RNG, on BOTH
 * sides. Two calls to the LIVE endpoint disagree with each other, so
 * cycle-for-cycle equality is not a property either producer has, and any
 * harness claiming it would be lying.
 *
 * What IS the contract, and what this checks per inf round:
 *
 *   1. SPACED-REP SCHEDULE — exactly which LEGOs are reviewed. Both sides
 *      walk the same fib offsets back from (mainLoopCount + infRound) into
 *      the same main-loop order, so this set is deterministic and must match
 *      exactly. This is the load-bearing check: it is the pedagogy.
 *      Three documented exceptions, each of which is the endpoint being
 *      BEHIND rather than the generator being different, and each attributed
 *      per extra so none is waved through:
 *        seedPhase              — offsets ≥144 (below);
 *        endpointPhraseCap      — the endpoint's phrase query is capped at
 *                                 10,000 rows, so the tail of a big course is
 *                                 invisible to it (spa_for_eng: 10,072 rows);
 *        endpointLostToAudioDraw— the endpoint samples one USE phrase at
 *                                 random then skips it if a clip is missing,
 *                                 losing the whole review; the generator
 *                                 filters its pools first, as the walk does.
 *      On the first of those, the same one the main loop has: the
 *      endpoint's offsets stop at 89, while the walk — the source of truth —
 *      keeps going into the SEED-PHASE tier (≥144) in infinite play too. The
 *      generator follows the walk, so extra reviews at exactly those offsets
 *      are the generator being ahead of the endpoint, never being different.
 *   2. ROUND SIZE — the two round-length RANGES must overlap; the generator is
 *      flagged only if its BEST sample is shorter than the endpoint's WORST.
 *      Equality is not asserted and cannot be: both producers sample LEGOs at
 *      random to fill the round, and a LEGO with no playable USE phrase yields
 *      nothing, so each disagrees with ITSELF run to run — measured at 21-22
 *      cycles on both sides. Both ranges are reported per case, so a genuine
 *      shortfall is visible rather than hidden inside a tolerance.
 *   3. POOL LEGALITY — every cycle's (known,target) pair is a real USE phrase
 *      of the LEGO it is filed under, checked against the bundle. A random
 *      draw is only allowed to differ WITHIN the legal pool.
 *   4. MAIN LOOP COUNT — the two producers must agree on where the main loop
 *      ends, or every offset above is computed against a different origin.
 *
 * The endpoint is sampled SAMPLES times per case and the union of its
 * spaced-rep sets is compared, so one lucky draw cannot pass a case that a
 * second draw would fail.
 *
 * Read-only, no DB credentials. PARITY_TOKEN is REQUIRED for premium courses:
 * unlike /cycles, /infplay-cycles has no preview slice — a non-entitled caller
 * gets a hard 403 by design.
 *
 *   node --experimental-strip-types tools/bundle-cutover/parity-infplay.mjs \
 *     [--courses=a,b] [--rounds=1,7,95] [--out=f.json]
 */
import { writeFileSync } from 'node:fs'

const BASE = process.env.PARITY_BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const COURSES = (args.courses || 'hun_for_eng,gle_for_eng,tur_for_eng,nld_for_eng').split(',')
/** 1 = first round past the main loop (peak spaced rep); 7 = mid-drain;
 *  95 = past offset 89, where the round is pure random USE. */
const FROM_ROUNDS = (args.rounds || '1,7,95').split(',').map(Number)
/** Rounds per call — the client's INFPLAY_ROUND_LIMIT. */
const ROUND_LIMIT = Number(args.roundLimit || 15)
/** How many times to re-sample the RNG-driven endpoint per case. */
const SAMPLES = Number(args.samples || 3)

const TOKEN = (process.env.PARITY_TOKEN || '').trim()
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : undefined

const { bundleToInfPlayCyclesResponse } = await import(
  new URL('../../packages/player-vue/src/providers/bundleToBackendCycles.ts', import.meta.url).href
)

async function getJson(url) {
  const res = await fetch(url, AUTH ? { headers: AUTH } : undefined)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

const norm = (t) => (t || '').toLowerCase().trim().replace(/\s+/g, ' ')
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))

/** Group a flat cycle list into { infRound → cycles }. */
function byRound(cycles) {
  const m = new Map()
  for (const c of cycles) {
    const r = c.inf_round
    if (typeof r !== 'number') continue
    if (!m.has(r)) m.set(r, [])
    m.get(r).push(c)
  }
  return m
}

const legosReviewed = (cs) => new Set(cs.filter((c) => c.type === 'spaced_rep').map((c) => c.lego_id))

/** Offsets `/infplay-cycles` documents itself as not walking (its list stops
 *  at 89). The walk does walk them, so the generator does too. */
const SEED_PHASE_OFFSETS = [144, 233, 377, 610, 987, 1597, 2584]

/**
 * LEGOs whose USE rows fall past the endpoint's hard `.limit(10000)` on
 * course_practice_phrases. The endpoint orders by (seed, lego, position), so
 * the tail of a big course is simply invisible to it — spa_for_eng has 10,072
 * such rows — and those LEGOs can never be reviewed or drawn there. The bundle
 * pages the whole table, so the generator sees them.
 */
function legosPastEndpointPhraseCap(bundle) {
  const ENDPOINT_PHRASE_CAP = 10000
  const rows = bundle.phrases
    .filter((p) => p.role === 'use')
    .sort((a, b) => a.legoId.localeCompare(b.legoId) || a.position - b.position)
  const out = new Set()
  for (let i = ENDPOINT_PHRASE_CAP; i < rows.length; i++) out.add(rows[i].legoId)
  return out
}

/**
 * LEGOs where the endpoint can lose a review to chance: it samples one USE
 * phrase at random and then skips it if any clip is missing, so a LEGO with
 * both complete and incomplete rows is reviewed only sometimes. The generator
 * filters its pools to complete rows first (as the walk does), so it always
 * reviews them.
 */
function legosWithPartialPhraseAudio(bundle) {
  const seen = new Map()
  for (const p of bundle.phrases) {
    if (p.role !== 'use') continue
    const ok = !!(p.audio?.known && p.audio?.target1 && p.audio?.target2)
    const e = seen.get(p.legoId) || { ok: 0, bad: 0 }
    e[ok ? 'ok' : 'bad']++
    seen.set(p.legoId, e)
  }
  const out = new Set()
  for (const [legoId, e] of seen) if (e.ok > 0 && e.bad > 0) out.add(legoId)
  return out
}

/** Which main-loop LEGOs this inf round reviews at a SEED-PHASE offset. */
function seedPhaseLegosFor(bundle, infRound) {
  const out = new Set()
  const absolute = bundle.mainLoopCount + infRound
  for (const offset of SEED_PHASE_OFFSETS) {
    const reviewRound = absolute - offset
    if (reviewRound < 1 || reviewRound > bundle.mainLoopCount) continue
    const entry = bundle.roundMap[reviewRound - 1]
    if (entry) out.add(entry.legoId)
  }
  return out
}

const report = { base: BASE, generatedAt: new Date().toISOString(), roundLimit: ROUND_LIMIT, samples: SAMPLES, cases: [] }

for (const code of COURSES) {
  let bundle
  try {
    bundle = await getJson(`${BASE}/api/courses/${code}/bundle`)
  } catch (err) {
    report.cases.push({ course: code, error: `bundle fetch failed: ${err.message}` })
    continue
  }
  if (bundle.previewOnly) {
    // Not a failure — the correct answer. A preview caller has no INF PLAY at
    // all, so there is nothing to compare and nothing to flag.
    report.cases.push({ course: code, verdict: 'PREVIEW_ONLY_NO_INFPLAY' })
    continue
  }

  // Legal USE pool per LEGO, straight off the bundle — the ground truth a
  // random draw is allowed to move within.
  const usePool = new Map()
  for (const p of bundle.phrases) {
    if (p.role !== 'use') continue
    const key = `${p.legoId}`
    if (!usePool.has(key)) usePool.set(key, new Set())
    usePool.get(key).add(`${norm(p.knownText)}|${norm(p.targetText)}`)
  }

  const pastCap = legosPastEndpointPhraseCap(bundle)
  const partialAudio = legosWithPartialPhraseAudio(bundle)
  const seedPool = new Set()
  for (const sd of bundle.seeds || []) seedPool.add(`${norm(sd.knownText)}|${norm(sd.targetText)}`)

  for (const fromRound of FROM_ROUNDS) {
    const c = { course: code, fromRound }
    try {
      // Both producers are RNG-driven, so BOTH are sampled and unioned. An
      // asymmetric harness — many samples of one side, one of the other —
      // reads random variation as drift, which is how this harness first
      // mis-blamed the generator for zho_for_eng's dropped review.
      const genSamples = []
      for (let s = 0; s < SAMPLES; s++) genSamples.push(bundleToInfPlayCyclesResponse(bundle, fromRound, ROUND_LIMIT))
      const gen = genSamples[0]
      const genRounds = byRound(gen.cycles)

      const samples = []
      for (let s = 0; s < SAMPLES; s++) {
        samples.push(await getJson(`${BASE}/api/courses/${code}/infplay-cycles?from_round=${fromRound}&limit=${ROUND_LIMIT}`))
      }
      const old = samples[0]

      c.mainLoopCount = { old: old.main_loop_count, new: gen.main_loop_count }
      c.mainLoopCountAgrees = old.main_loop_count === gen.main_loop_count
      c.nextInfRound = { old: old.next_inf_round, new: gen.next_inf_round }

      const roundDiffs = []
      let illegal = 0
      let checked = 0
      let supersetRounds = 0
      let endpointVariedItsOwnRoundSize = 0
      let generatorVariedItsOwnRoundSize = 0
      const oldLen = []
      const newLen = []
      const extras = { seedPhase: 0, endpointPhraseCap: 0, endpointLostToAudioDraw: 0 }
      const unexplainedExtras = []
      for (const [infRound, oldCycles] of byRound(old.cycles)) {
        const newCycles = genRounds.get(infRound) || []
        checked++
        // 1 — the schedule, unioned over every endpoint sample so a single
        // lucky draw cannot carry the case.
        const oldSet = new Set()
        for (const s of samples) for (const l of legosReviewed(byRound(s.cycles).get(infRound) || [])) oldSet.add(l)
        const newSet = new Set()
        for (const s of genSamples) for (const l of legosReviewed(byRound(s.cycles).get(infRound) || [])) newSet.add(l)
        // 2 — round size and split.
        const size = (cs) => ({ total: cs.length, sr: cs.filter((x) => x.type === 'spaced_rep').length, use: cs.filter((x) => x.type === 'use').length })
        const so = size(oldCycles), sn = size(newCycles)
        const oldTotals = samples.map((s) => (byRound(s.cycles).get(infRound) || []).length)
        const newTotals = genSamples.map((s) => (byRound(s.cycles).get(infRound) || []).length)
        so.range = [Math.min(...oldTotals), Math.max(...oldTotals)]
        sn.range = [Math.min(...newTotals), Math.max(...newTotals)]
        if (so.range[0] !== so.range[1]) endpointVariedItsOwnRoundSize++
        if (sn.range[0] !== sn.range[1]) generatorVariedItsOwnRoundSize++
        oldLen.push(...oldTotals)
        newLen.push(...newTotals)
        // 3 — pool legality of the new side's draws. A seed-phase review
        // plays the parent SEED sentence, not a USE phrase, so it is checked
        // against the seed pool instead.
        for (const x of newCycles) {
          const pool = x.id.includes('_infseedrep_') ? seedPool : usePool.get(x.lego_id)
          if (!pool || !pool.has(`${norm(x.known_text)}|${norm(x.target_text)}`)) illegal++
        }
        const seedPhase = seedPhaseLegosFor(bundle, infRound)
        const onlyOld = [...oldSet].filter((x) => !newSet.has(x))
        const onlyNew = [...newSet].filter((x) => !oldSet.has(x))
        // Every extra must be attributable to one of the three ways the
        // endpoint is behind. Anything else is real drift and must not be
        // waved through as "superset".
        const unexplained = []
        for (const legoId of onlyNew) {
          if (seedPhase.has(legoId)) extras.seedPhase++
          else if (pastCap.has(legoId)) extras.endpointPhraseCap++
          else if (partialAudio.has(legoId)) extras.endpointLostToAudioDraw++
          else unexplained.push(legoId)
        }
        const extrasAllSeedPhase = unexplained.length === 0
        if (onlyNew.length > 0 && extrasAllSeedPhase) supersetRounds++
        if (unexplained.length > 0) unexplainedExtras.push({ infRound, legos: unexplained })
        // The extras displace random USE one-for-one to hold the round at its
        // target length, so the split moves by exactly their count while the
        // total does not move at all.
        if (onlyOld.length > 0 || !extrasAllSeedPhase || sn.range[1] < so.range[0]) {
          roundDiffs.push({ infRound, onlyOldReviews: onlyOld, onlyNewReviews: onlyNew, size: { old: so, new: sn } })
        }
      }
      c.roundsChecked = checked
      c.supersetRounds = supersetRounds
      c.endpointVariedItsOwnRoundSize = endpointVariedItsOwnRoundSize
      c.generatorVariedItsOwnRoundSize = generatorVariedItsOwnRoundSize
      c.roundLength = {
        old: oldLen.length ? [Math.min(...oldLen), Math.max(...oldLen)] : null,
        new: newLen.length ? [Math.min(...newLen), Math.max(...newLen)] : null,
      }
      c.extras = extras
      c.unexplainedExtras = unexplainedExtras.slice(0, 8)
      c.illegalDraws = illegal
      c.roundDiffs = roundDiffs.slice(0, 8)
      c.roundDiffCount = roundDiffs.length
      // A course with no rendered audio produces no rounds on either side.
      // That proves nothing about the generator and must never read as a pass.
      c.verdict = checked === 0
        ? 'NO_AUDIO'
        : !c.mainLoopCountAgrees
        ? 'DRIFT_MAIN_LOOP_COUNT'
        : illegal > 0
          ? 'DRIFT_ILLEGAL_DRAW'
          : roundDiffs.length > 0
            ? 'DRIFT_SCHEDULE'
            : supersetRounds > 0
              ? 'SCHEDULE_SUPERSET_EXPLAINED'
              : 'SCHEDULE_IDENTICAL'
    } catch (err) {
      c.error = err.message
    }
    report.cases.push(c)
  }
}

const out = args.out || 'parity-infplay.json'
writeFileSync(out, JSON.stringify(report, null, 2))
for (const c of report.cases) {
  if (c.error) { console.log(`${c.course} from=${c.fromRound ?? ''} ERROR ${c.error}`); continue }
  if (c.verdict === 'NO_AUDIO') { console.log(`${c.course} from=${c.fromRound} NO_AUDIO — neither side emits a round (PROVES NOTHING)`); continue }
  if (c.verdict === 'PREVIEW_ONLY_NO_INFPLAY') { console.log(`${c.course} PREVIEW_ONLY_NO_INFPLAY (no entitled session — nothing to compare)`); continue }
  console.log(
    `${c.course} from=${c.fromRound} rounds=${c.roundsChecked} ${c.verdict} ` +
      `scheduleDiffs=${c.roundDiffCount} supersetRounds=${c.supersetRounds} illegalDraws=${c.illegalDraws} ` +
      `extras=${JSON.stringify(c.extras)} roundLen old=${JSON.stringify(c.roundLength?.old)} new=${JSON.stringify(c.roundLength?.new)}`,
  )
}
const bad = report.cases.filter((c) => c.error || String(c.verdict).startsWith('DRIFT'))
console.log(
  `\n${report.cases.filter((c) => c.verdict === 'SCHEDULE_IDENTICAL').length} schedule-identical, ` +
    `${report.cases.filter((c) => c.verdict === 'SCHEDULE_SUPERSET_EXPLAINED').length} superset (every extra attributed), ` +
    `${report.cases.filter((c) => c.verdict === 'NO_AUDIO').length} no-audio (PROVES NOTHING), ` +
    `${bad.length} drift/error`,
)
console.log(`wrote ${out}`)
process.exitCode = bad.length ? 1 : 0
