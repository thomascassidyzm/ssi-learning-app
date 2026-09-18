/**
 * The long class the estate does not have — drawn from a REAL learner instead.
 *
 * #120 could only draw the fold against a class it synthesised, because the
 * deepest real CLASS on 2026-09-17 is about 40 chunks in. A real LEARNER is
 * much deeper: 7434474c on cym_n_for_eng has heard 616 distinct chunks, reach
 * 633, over 67 sittings and 30,286 audio plays. This reads that learner's own
 * diary and runs it through the SERVER'S OWN buildBrain (api/_utils/classBrain.ts)
 * with the axis rules of api/classes/[id]/brain.ts, so nothing about what the
 * card draws is synthesised. The learner stands in for a class; no pupil data
 * is drawn per pupil and nothing is written back.
 *
 * Writes fixture-real.json (as-is) and fixture-real-mid.json (the same diary
 * with everything before an orange-belt-ish ordinal DROPPED — a DERIVED
 * mid-course start, used to test where the fold anchors).
 *
 * Run: node make-fixture-real.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const require_ = createRequire(import.meta.url)
const esbuild = require_('/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js')

// The server's own brain, compiled from source — never re-implemented here.
const src = fs.readFileSync(path.join(repo, 'api/_utils/classBrain.ts'), 'utf8')
const js = esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const { buildBrain, chooseAxis } = mod

const env = fs.readFileSync(process.env.HOME + '/.ssi-sentinel.env', 'utf8')
const key = /SUPABASE_SERVICE_ROLE_KEY\s*=\s*"?([^"\n]+)/.exec(env)[1].trim()
const svc = createClient('https://swfvymspfxmnfhevgdkg.supabase.co', key)

const LEARNER = process.env.LEARNER || '7434474c-24a4-4612-8310-76992571cc83'
const COURSE = process.env.COURSE || 'cym_n_for_eng'
const WINDOW_DAYS = 180
const MAX_AXIS = 2000
const PAGE = 1000

async function pageAll(build) {
  const out = []
  for (let p = 0; p < 200; p++) {
    const { data, error } = await build(p * PAGE, p * PAGE + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

const legoRows = await pageAll((a, b) => svc.from('course_legos')
  .select('lego_id, seed_number, lego_index, target_text, known_text')
  .eq('course_code', COURSE)
  .order('seed_number', { ascending: true }).order('lego_index', { ascending: true })
  .range(a, b))
const legos = legoRows.map((r) => ({ id: r.lego_id, seed: r.seed_number, t: r.target_text || '', k: r.known_text || '' }))

const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString()
// The whole diary, not the server's 12-page cap — see the report's finding.
const raw = await pageAll((a, b) => svc.from('player_events')
  .select('event_type, occurred_at, payload, course_code')
  .eq('learner_id', LEARNER)
  .in('event_type', ['audio_play', 'audio_failed', 'belt_skip', 'lego_skip'])
  .gte('occurred_at', sinceIso)
  .order('occurred_at', { ascending: true })
  .range(a, b))

const foreign = raw.filter((r) => r.course_code && r.course_code !== COURSE).length
const diary = raw.filter((r) => !r.course_code || r.course_code === COURSE).map((r) => {
  const p = r.payload || {}
  return {
    event_type: r.event_type,
    occurred_at: r.occurred_at,
    role: typeof p.role === 'string' ? p.role : null,
    lego_id: typeof p.legoId === 'string' ? p.legoId : typeof p.fromLegoId === 'string' ? p.fromLegoId : null,
    cycle_id: typeof p.cycleId === 'string' ? p.cycleId : null,
    target_seed: typeof p.targetSeed === 'number' && Number.isFinite(p.targetSeed) ? p.targetSeed : null,
  }
})

const ordinalOf = new Map(legos.map((l, i) => [l.id, i]))
const seedOf = new Map(legos.map((l) => [l.id, l.seed]))

// The phrases the diary names — exactly the server's read.
const phraseIds = new Set()
for (const r of diary) {
  const m = /^(S\d{4}L\d{2})_(build|use)_(\d{2})/.exec(r.cycle_id || '')
  if (m) phraseIds.add(`${COURSE}:${m[1]}${m[2] === 'use' ? 'U' : 'B'}${m[3]}`)
}
const phrases = new Map()
const ids = [...phraseIds]
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await svc.from('course_practice_phrases')
    .select('id, target_text, known_text, phrase_role, position, lego_id, decomposition')
    .in('id', ids.slice(i, i + 200))
  for (const r of data ?? []) phrases.set(String(r.id), r)
}

// The server takes the position line from course_seeds, not from the lego.
const seedText = new Map()
{
  const rows = await pageAll((a, b) => svc.from('course_seeds')
    .select('seed_number, target_text, known_text').eq('course_code', COURSE).order('seed_number').range(a, b))
  for (const r of rows) seedText.set(r.seed_number, { t: r.target_text || '', k: r.known_text || '' })
}

function makePayload(rows, label) {
  const skips = rows.filter((r) => r.event_type === 'belt_skip' || r.event_type === 'lego_skip')
    .map((r) => ({ occurred_at: r.occurred_at, event_type: r.event_type, target_seed: r.event_type === 'belt_skip' ? r.target_seed : null }))
  const brain = buildBrain({ courseCode: COURSE, rows, skips, ordinalOf, seedOf, phrases })
  // The server's own axis rules, whichever way they currently fall.
  const { axisFrom, axisTo, reachOrd } = chooseAxis(legos.length, brain.events, MAX_AXIS)
  const reachedSeed = reachOrd >= 0 ? legos[reachOrd].seed : 0
  const lit = brain.events.flatMap((e) => e.fires)
  const payload = {
    courseCode: COURSE,
    legos: legos.slice(axisFrom, axisTo).map((l) => ({ id: l.id, seed: l.seed, t: l.t, k: l.k })),
    legosTotal: legos.length,
    axisFrom,
    events: brain.events,
    sittings: brain.sittings,
    phrases: brain.phraseText,
    tally: brain.tally,
    introducedCount: brain.introducedCount,
    distinctPhrases: brain.distinctPhrases,
    minutes: Math.round((brain.tally.total * 11) / 60),
    reachedSeed,
    reachedSeedText: reachOrd >= 0 ? (seedText.get(legos[reachOrd].seed) || null) : null,
    seedsTotal: legos.length ? legos[legos.length - 1].seed : 0,
    windowDays: WINDOW_DAYS,
  }
  const spans = brain.events.flatMap((e) => (e.fires.length > 1 ? [Math.max(...e.fires) - Math.min(...e.fires)] : []))
  spans.sort((a, b) => a - b)
  console.log(`[${label}] chunks ${payload.legos.length}  axisFrom ${axisFrom}  events ${brain.events.length}  sittings ${brain.sittings.length}  phrases ${brain.distinctPhrases}  detoured ${brain.tally.detoured}`)
  console.log(`[${label}] first lit ordinal ${Math.min(...lit)}  reach ${reachOrd}  arcs ${spans.length}  longest ${spans[spans.length - 1]}  median ${spans[spans.length >> 1]}`)
  console.log(`[${label}] kinds ${JSON.stringify(brain.tally)}`)
  return payload
}

console.log(`diary rows ${raw.length} (foreign-course rows dropped: ${foreign})`)
fs.writeFileSync(path.join(here, 'fixture-real.json'), JSON.stringify(makePayload(diary, 'real')))

// DERIVED mid-course start: no real learner in the estate starts partway in,
// so the anchoring case is made by dropping every diary row before an
// orange-belt-ish ordinal. Honest because it is said out loud, here and in the
// report: this one is derived, the one above is not.
const MID = Number(process.env.MID_ORD || 220)
const midRows = diary.filter((r) => {
  const o = r.lego_id ? ordinalOf.get(r.lego_id) : undefined
  return o === undefined ? false : o >= MID
})
fs.writeFileSync(path.join(here, 'fixture-real-mid.json'), JSON.stringify(makePayload(midRows, `mid>=${MID}`)))

// The school Tom actually described: one that did some of the course LAST year
// and is a term in this year — a mid-course start AND a short lit stretch.
// Same real diary, kept only between two ordinals. Also derived, also said so.
const A = Number(process.env.SHALLOW_FROM || 150)
const B = Number(process.env.SHALLOW_TO || 174)
const shallowRows = diary.filter((r) => {
  const o = r.lego_id ? ordinalOf.get(r.lego_id) : undefined
  return o === undefined ? false : o >= A && o < B
})
fs.writeFileSync(path.join(here, 'fixture-real-shallow.json'), JSON.stringify(makePayload(shallowRows, `shallow ${A}..${B}`)))
