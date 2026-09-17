/**
 * The long class the estate does not yet have.
 *
 * The deepest real class on 2026-09-17 is 287 audio plays — about 40 chunks in
 * — so nothing live exercises the axis at the depth this card has to survive.
 * This synthesises one: real cym_s_for_eng chunks and real practice phrases,
 * read from the live course tables, played through as a class would play them
 * over 40 sittings, with the course's own recombination — a phrase late in the
 * course firing chunks introduced hundreds of chunks earlier.
 *
 * Run: node make-fixture.mjs   (writes fixture-300.json beside this file)
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const env = fs.readFileSync(process.env.HOME + '/.ssi-sentinel.env', 'utf8')
const key = /SUPABASE_SERVICE_ROLE_KEY\s*=\s*"?([^"\n]+)/.exec(env)[1].trim()
const svc = createClient('https://swfvymspfxmnfhevgdkg.supabase.co', key)

const COURSE = 'cym_s_for_eng'
const N = 300

const legos = []
for (let page = 0; page < 3 && legos.length < N; page++) {
  const { data } = await svc.from('course_legos')
    .select('lego_id, seed_number, lego_index, target_text, known_text')
    .eq('course_code', COURSE)
    .order('seed_number', { ascending: true }).order('lego_index', { ascending: true })
    .range(page * 1000, page * 1000 + 999)
  for (const r of data ?? []) legos.push({ id: r.lego_id, seed: r.seed_number, t: r.target_text, k: r.known_text })
  if ((data ?? []).length < 1000) break
}
const axis = legos.slice(0, N)
const ordinalOf = new Map(axis.map((l, i) => [l.id, i]))

const { data: phraseRows } = await svc.from('course_practice_phrases')
  .select('id, target_text, known_text, phrase_role, position, lego_id, decomposition')
  .eq('course_code', COURSE)
  .in('lego_id', axis.map((l) => l.id))
  .limit(4000)

// A phrase fires the chunk it belongs to plus every chunk its decomposition
// names — that is the server's rule, and it is where the long arcs come from.
const byLego = new Map()
for (const p of phraseRows ?? []) {
  const o = ordinalOf.get(p.lego_id)
  if (o == null) continue
  const fires = new Set([o])
  const d = p.decomposition
  const parts = Array.isArray(d) ? d : Array.isArray(d?.parts) ? d.parts : []
  for (const part of parts) {
    const id = typeof part === 'string' ? part : part?.lego_id || part?.legoId
    const q = ordinalOf.get(id)
    if (q != null) fires.add(q)
  }
  if (!byLego.has(o)) byLego.set(o, [])
  byLego.get(o).push({ id: p.id, t: p.target_text, k: p.known_text, role: p.phrase_role, pos: p.position, fires: [...fires].sort((a, b) => a - b) })
}

// Belt-and-braces: where a course row carries no decomposition, the class still
// recombines — a phrase at chunk o also says chunks the spaced-repetition queue
// brings back, at Fibonacci offsets behind it. Without this the drawing would
// only ever show neighbours, which is not what the course does.
const FIB = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]
function reviewFires(o, salt) {
  const back = FIB[(o + salt) % FIB.length]
  const q = o - back
  return q >= 0 ? [q, o] : [o]
}

const events = []
const phrases = {}
const sittings = []
let t = new Date('2026-01-08T09:00:00.000Z').getTime()
let sitting = -1
let cyclesThisSitting = 0
const SITTING_CYCLES = 26

for (let o = 0; o < N; o++) {
  const own = byLego.get(o) || []
  const cycles = []
  cycles.push({ phrase: null, fires: [o], kind: 'intro' })
  for (const p of own.slice(0, 3)) {
    phrases[p.id] = { t: p.t, k: p.k, lego: o, role: p.role === 'use' ? 'use' : 'build', pos: p.pos || 1 }
    cycles.push({ phrase: p.id, fires: p.fires, kind: p.role === 'use' ? 'use' : 'build' })
  }
  if (own.length < 2) cycles.push({ phrase: null, fires: reviewFires(o, 1), kind: 'build' })
  cycles.push({ phrase: null, fires: reviewFires(o, 7), kind: 'use' })

  for (const c of cycles) {
    if (cyclesThisSitting === 0 || cyclesThisSitting >= SITTING_CYCLES) {
      sitting += 1
      cyclesThisSitting = 0
      t += 86400000 * (1 + (sitting % 4))
      sittings.push(new Date(t).toISOString().slice(0, 10))
    }
    t += 11000
    cyclesThisSitting += 1
    events.push({ t: new Date(t).toISOString(), lego: o, phrase: c.phrase, fires: c.fires, kind: c.kind, hearings: 2, s: sitting })
  }
}

const distinct = new Set(events.map((e) => e.phrase).filter(Boolean)).size
const payload = {
  courseCode: COURSE,
  legos: axis,
  legosTotal: legos.length,
  axisFrom: 0,
  events,
  sittings,
  phrases,
  tally: { total: events.length, hearings: events.length * 2, detoured: 0, intro: N, debut: 0, build: 0, use: 0, other: 0 },
  introducedCount: N,
  distinctPhrases: distinct,
  minutes: Math.round((events.length * 11) / 60),
  reachedSeed: axis[N - 1].seed,
  reachedSeedText: { t: axis[N - 1].t, k: axis[N - 1].k },
  seedsTotal: legos[legos.length - 1].seed,
  windowDays: 180,
}
fs.writeFileSync(path.join(here, 'fixture-300.json'), JSON.stringify(payload))
const spans = events.flatMap((e) => (e.fires.length > 1 ? [Math.max(...e.fires) - Math.min(...e.fires)] : []))
console.log(`chunks ${axis.length}  events ${events.length}  sittings ${sittings.length}  phrases ${distinct}`)
console.log(`arcs ${spans.length}  longest span ${Math.max(...spans)} chunks  median ${spans.sort((a, b) => a - b)[spans.length >> 1]}`)
