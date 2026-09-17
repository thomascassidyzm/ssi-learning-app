// Replaying brain, specimen v2 — step 1: distil the live pull into data.json (class-level only).
// Input: $CS_SCRATCH/{plays,legos,seeds,phrases}.json pulled live (plays.json carries known,
// target1 AND target2 audio_play rows, plus audio_failed rows, plus the belt_skip/lego_skip
// rows the abandoned-detour rule reads, per class+school) from the
// learner-app Supabase (player_events audio_play rows for every class entity at St Alban's RC
// High School, Pontypool — the busiest real class estate-wide, per a school-agnostic
// class-grouped query over player_events/classes/schools — cym_s_for_eng course tables).
// Output: data.json beside this file. No pupil exists in any input: the class entity is the
// only learner behind a class's plays.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAbandonedDetours } from './detourRule.mjs'
const here = dirname(fileURLToPath(import.meta.url))
const S = process.argv[2] || process.env.CS_SCRATCH
const R = f => JSON.parse(readFileSync(join(S, f)))
const plays = R('plays.json'), legos = R('legos.json'), seeds = R('seeds.json'), phrases = R('phrases.json')
const CLASS = '9b/KW LJ', COURSE = 'cym_s_for_eng', SHOW_SEEDS = 11

const ord = new Map(legos.map((l, i) => [l.lego_id, i]))
const pById = new Map(phrases.map(p => [p.id, p]))
const toPhrase = c => { const m = /^(S\d{4}L\d{2})_(build|use)_(\d{2})_/.exec(c); return m ? `${COURSE}:${m[1]}${m[2] === 'use' ? 'U' : 'B'}${m[3]}` : null }

// One event per cycle the class HEARD the target of: the target1 audio_play row.
// A cycle plays the target TWICE (target1 voice A, then target2 voice B) — both are real
// hearings. Each event carries a `hearings` count (1 or 2) computed from the class's own
// target1+target2 audio_play rows, excluding any audio_play immediately (<50ms) followed
// by an audio_failed row for the same clip (role+legoId+cycleId) — that play never sounded.
const failedByClip = new Map() // "role|legoId|cycleId|occurred_at(ms)" -> true, for audio_failed rows
for (const p of plays) {
  if (p.event_type !== 'audio_failed') continue
  failedByClip.set(`${p.role}|${p.lego_id}|${p.cycle_id}`, [...(failedByClip.get(`${p.role}|${p.lego_id}|${p.cycle_id}`) || []), p.occurred_at])
}
const wasExcluded = p => {
  const fails = failedByClip.get(`${p.role}|${p.lego_id}|${p.cycle_id}`)
  if (!fails) return false
  return fails.some(f => Math.abs(new Date(f) - new Date(p.occurred_at)) < 50)
}
const classPlaysSorted = plays.filter(p => p.class_name === CLASS && p.event_type === 'audio_play' && (p.role === 'target1' || p.role === 'target2')).sort((a, b) => a.occurred_at < b.occurred_at ? -1 : 1)
// The abandoned-detour rule lives in detourRule.mjs, with its own test.
const seedOfLegoId = new Map(legos.map(l => [l.lego_id, l.seed_number]))
const detoured = findAbandonedDetours(
  classPlaysSorted.filter(p => p.role === 'target1'),
  plays.filter(p => p.class_name === CLASS && (p.event_type === 'belt_skip' || p.event_type === 'lego_skip'))
       .sort((a, b) => a.occurred_at < b.occurred_at ? -1 : 1),
  id => seedOfLegoId.get(id),
)
const hearingsFor = t1 => {
  const i = classPlaysSorted.indexOf(t1)
  let h = wasExcluded(t1) ? 0 : 1
  for (let j = i + 1; j < classPlaysSorted.length; j++) {
    const r2 = classPlaysSorted[j]
    if (r2.role === 'target1') break
    if (r2.role === 'target2' && r2.cycle_id === t1.cycle_id && r2.lego_id === t1.lego_id) { h += wasExcluded(r2) ? 0 : 1; break }
  }
  return h
}
const tally = { total: 0, hearings: 0, detoured: 0, intro: 0, debut: 0, build: 0, use: 0, legacy: 0, unresolved: 0 }
const events = []
for (const p of plays) {
  if (p.role !== 'target1' || p.event_type !== 'audio_play') continue
  const cls = p.class_name === CLASS ? 'class' : 'school'
  if (cls === 'class' && detoured.has(p)) { tally.detoured++; continue }
  if (cls === 'class') tally.total++
  const lego = ord.get(p.lego_id); if (lego === undefined) continue
  let kind, phrase = null, fires = [lego]
  if (/_intro/.test(p.cycle_id)) kind = 'intro'
  else if (/_debut/.test(p.cycle_id)) kind = 'debut'
  else {
    const id = toPhrase(p.cycle_id); const ph = id && pById.get(id)
    if (ph) { kind = ph.phrase_role; phrase = id; fires = [...new Set((ph.decomposition || []).map(d => ord.get(d.legoId)).filter(x => x !== undefined))]; if (!fires.includes(lego)) fires.push(lego) }
    else if (/^S\d{4}L\d{2}_(build|use)_\d+$/.test(p.cycle_id)) kind = 'legacy'
    else kind = 'unresolved'
  }
  const hearings = cls === 'class' ? hearingsFor(p) : 2
  if (cls === 'class') { tally[kind]++; tally.hearings += hearings }
  events.push({ cls, t: p.occurred_at, lego, phrase, fires, kind, hearings })
}
events.sort((a, b) => a.t < b.t ? -1 : 1)
const classEvents = events.filter(e => e.cls === 'class'), schoolEvents = events.filter(e => e.cls === 'school')
// Sittings = days the class played.
const days = [...new Set(classEvents.map(e => e.t.slice(0, 10)))]
classEvents.forEach(e => { e.s = days.indexOf(e.t.slice(0, 10)) })
const usedPhrases = new Set(events.map(e => e.phrase).filter(Boolean))
const classPhrases = new Set(classEvents.map(e => e.phrase).filter(Boolean))
const P = {}; for (const id of usedPhrases) { const p = pById.get(id); P[id] = { t: p.target_text, k: p.known_text, lego: ord.get(p.lego_id), role: p.phrase_role, pos: p.position, n: (p.decomposition || []).length, seed: p.seed_number } }
const schoolClasses = new Set(plays.map(p => p.class_name)).size
// Total in-app minutes: real wall-clock span per sitting (last play minus first play that
// day, any role — known/target1/target2), summed. Idle time between sittings is never counted.
const classPlaysByDay = new Map()
for (const p of plays) { if (p.class_name !== CLASS) continue; const d = p.occurred_at.slice(0, 10); (classPlaysByDay.get(d) || classPlaysByDay.set(d, []).get(d)).push(p.occurred_at) }
let totalMinutes = 0
for (const ts of classPlaysByDay.values()) { ts.sort(); totalMinutes += (new Date(ts.at(-1)) - new Date(ts[0])) / 60000 }
const introducedCount = new Set(classEvents.filter(e => e.kind === 'intro').map(e => e.lego)).size
const out = {
  school: "St Alban's RC High School, Pontypool", className: CLASS, course: 'Welsh, southern, for English speakers', courseCode: COURSE,
  pulledAt: '2026-09-17', legosTotal: legos.length, seedsTotal: Math.max(...legos.map(l => l.seed_number)), showSeeds: SHOW_SEEDS,
  legos: legos.filter(l => l.seed_number <= SHOW_SEEDS).map(l => ({ id: l.lego_id, seed: l.seed_number, t: l.target_text, k: l.known_text })),
  seeds: Object.fromEntries(seeds.filter(s => s.seed_number <= 40).map(s => [s.seed_number, { t: s.target_text, k: s.known_text }])),
  sittings: days, events: classEvents.map(({ cls, ...e }) => e), schoolEvents: schoolEvents.map(({ cls, s, hearings, ...e }) => e), phrases: P,
  classPhraseCount: classPhrases.size,
  tally, schoolClasses, schoolCycles: schoolEvents.length, schoolFirst: schoolEvents[0]?.t.slice(0, 10), schoolLast: schoolEvents.at(-1)?.t.slice(0, 10),
  knownOnly: plays.filter(p => p.class_name === CLASS && p.role === 'known').length,
  totalMinutes: Math.round(totalMinutes * 10) / 10, introducedCount,
  // Estate-wide, class-grouped over player_events JOIN classes JOIN schools, target1 audio_play,
  // cym_s_for_eng, excluding is_demo/is_test schools. Pulled live 2026-09-17 — the query behind
  // "why this class" below; the single source of truth for which class is busiest estate-wide.
  topClassesEstate: [
    { school: "St Alban's RC High School, Pontypool", className: '9b/KW LJ', cycles: 83 },
    { school: 'Ysgol Gyfun Tredegar', className: 'Blwyddyn 10 6', cycles: 66 },
    { school: "St Alban's RC High School, Pontypool", className: '9a/AB LJ', cycles: 61 },
  ],
}
writeFileSync(join(here, 'data.json'), JSON.stringify(out))
console.log('detoured (abandoned) plays excluded:', [...detoured].map(p => `${p.occurred_at} ${p.lego_id} ${p.cycle_id}`))
console.log(tally, 'sittings', days, 'school events', schoolEvents.length, 'phrases used (class)', classPhrases.size, 'phrases used (all)', usedPhrases.size, 'bytes', JSON.stringify(out).length)
