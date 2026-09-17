// Replaying brain, specimen v2 — step 1: distil the live pull into data.json (class-level only).
// Input: $CS_SCRATCH/{plays,legos,seeds,phrases,classes}.json pulled live 2026-09-17 from the
// learner-app Supabase (player_events audio_play rows for every Chepstow class entity, cym_s_for_eng
// course tables). Output: data.json beside this file. No pupil exists in any input: the class
// entity is the only learner behind a class's plays.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const S = process.argv[2] || process.env.CS_SCRATCH
const R = f => JSON.parse(readFileSync(join(S, f)))
const plays = R('plays.json'), legos = R('legos.json'), seeds = R('seeds.json'), phrases = R('phrases.json')
const CLASS = '8H', COURSE = 'cym_s_for_eng', SHOW_SEEDS = 11

const ord = new Map(legos.map((l, i) => [l.lego_id, i]))
const pById = new Map(phrases.map(p => [p.id, p]))
const toPhrase = c => { const m = /^(S\d{4}L\d{2})_(build|use)_(\d{2})_/.exec(c); return m ? `${COURSE}:${m[1]}${m[2] === 'use' ? 'U' : 'B'}${m[3]}` : null }

// One event per cycle the class HEARD the target of: the target1 audio_play row.
const tally = { total: 0, intro: 0, debut: 0, build: 0, use: 0, legacy: 0, unresolved: 0 }
const events = []
for (const p of plays) {
  if (p.role !== 'target1') continue
  const cls = p.class_name === CLASS ? 'class' : 'school'
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
  if (cls === 'class') tally[kind]++
  events.push({ cls, t: p.occurred_at, lego, phrase, fires, kind })
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
const out = {
  school: 'Ysgol Cas-gwent Chepstow School', className: CLASS, course: 'Welsh, southern, for English speakers', courseCode: COURSE,
  pulledAt: '2026-09-17', legosTotal: legos.length, seedsTotal: Math.max(...legos.map(l => l.seed_number)), showSeeds: SHOW_SEEDS,
  legos: legos.filter(l => l.seed_number <= SHOW_SEEDS).map(l => ({ id: l.lego_id, seed: l.seed_number, t: l.target_text, k: l.known_text })),
  seeds: Object.fromEntries(seeds.filter(s => s.seed_number <= 40).map(s => [s.seed_number, { t: s.target_text, k: s.known_text }])),
  sittings: days, events: classEvents.map(({ cls, ...e }) => e), schoolEvents: schoolEvents.map(({ cls, s, ...e }) => e), phrases: P,
  classPhraseCount: classPhrases.size,
  tally, schoolClasses, schoolCycles: schoolEvents.length, schoolFirst: schoolEvents[0]?.t.slice(0, 10), schoolLast: schoolEvents.at(-1)?.t.slice(0, 10),
  knownOnly: plays.filter(p => p.class_name === CLASS && p.role === 'known').length,
}
writeFileSync(join(here, 'data.json'), JSON.stringify(out))
console.log(tally, 'sittings', days, 'school events', schoolEvents.length, 'phrases used (class)', classPhrases.size, 'phrases used (all)', usedPhrases.size, 'bytes', JSON.stringify(out).length)
