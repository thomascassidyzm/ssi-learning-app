// Live census: how many NEW sentences does each pod lap debut, per course?
//
// Reads the real listening_pod_sentences rows straight from Supabase, runs
// them through the SAME flatten + cohort partition the runtime uses
// (buildPodCohorts over the flattened per-sentence list), and reports the
// cohort-size distribution. Tom's rule (2026-08-09): "max 1 new sentence per
// POD visit, 2 only if they genuinely belong together" — so a healthy census
// is mean 1.00 with max 2, the 2 being the cold-start pair only.
//
// It also answers "is this global or local?": pass LEARNER=<display_name> to
// print that learner's completed_pod_rounds ratchet next to the census, which
// is what decides how much accumulated content their lap actually replays.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... COURSES=deu_for_eng,fra_for_eng \
//     LEARNER=beunollyn node e2e/pod-cohort-census-live.mjs
import { createClient } from '@supabase/supabase-js'
import { buildPodCohorts } from '@ssi/core/pods'

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const COURSES = (process.env.COURSES || 'deu_for_eng,fra_for_eng,spa_for_eng').split(',')
const LEARNER = process.env.LEARNER || null

const BOUNDARY = /(?<=[.!?…])\s+/

/** Mirror of usePodLapScheduler.flattenPodRows: a row carrying per-sentence
 *  clips becomes one unit per sentence, and glue_to_next is recomputed
 *  speaker-aware (siblings of one turn always glue). */
function flatten(rows) {
  const expanded = []
  rows.forEach((row, rowIdx) => {
    const clips = (Array.isArray(row.sentence_audio_ids) ? row.sentence_audio_ids : []).filter(Boolean)
    const texts = (row.target_text || '').split(BOUNDARY).map((s) => s.trim()).filter(Boolean)
    const units = clips.length >= 2 ? clips.length : 1
    for (let k = 0; k < units; k++) {
      expanded.push({
        scene_number: row.scene_number ?? null,
        speaker: row.speaker,
        target_text: units === 1 ? row.target_text : (texts[k] || row.target_text),
        _turnId: String(rowIdx),
        _origGlue: !!row.glue_to_next,
        glue_to_next: false,
      })
    }
  })
  for (let i = 0; i < expanded.length; i++) {
    const cur = expanded[i]
    const next = expanded[i + 1]
    if (!next) { cur.glue_to_next = false; continue }
    if (next._turnId === cur._turnId) { cur.glue_to_next = true; continue }
    const a = cur.speaker, b = next.speaker
    cur.glue_to_next = a && b ? a === b : cur._origGlue
  }
  return expanded
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

for (const course of COURSES) {
  const { data, error } = await svc
    .from('listening_pod_sentences')
    .select('scene_number, speaker, target_text, glue_to_next, sentence_audio_ids')
    .eq('pod_id', `${course}:pod-0`)
    .order('global_order')
  if (error) { console.log(`SKIP ${course} :: ${error.message}`); continue }
  if (!data?.length) { console.log(`SKIP ${course} :: no pod rows`); continue }

  const sentences = flatten(data)
  const cohorts = buildPodCohorts(sentences)
  const sizes = cohorts.map((c) => c.size)
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length
  const overTwo = sizes.filter((s) => s > 2).length

  console.log(
    `\n${course}: ${data.length} turn-rows -> ${sentences.length} sentences -> ${cohorts.length} cohorts` +
    ` | mean ${mean.toFixed(2)} | max ${Math.max(...sizes)} | laps>2: ${overTwo}`,
  )
  console.log('  first 5 cohorts:', JSON.stringify(cohorts.slice(0, 5).map((c) =>
    sentences.slice(c.start, c.start + c.size).map((s) => s.target_text))))

  check(`${course}: the cold-start lap is exactly two sentences`, sizes[0] === 2, `size=${sizes[0]}`)
  check(`${course}: every later lap debuts ONE new sentence`,
    sizes.slice(1).every((s) => s === 1), `max after cold start = ${Math.max(...sizes.slice(1))}`)
  check(`${course}: no lap debuts a paragraph`, overTwo === 0, `${overTwo} laps > 2`)
}

if (LEARNER) {
  const { data: ls } = await svc.from('learners').select('id, display_name').ilike('display_name', LEARNER)
  for (const l of ls || []) {
    const { data: es } = await svc
      .from('course_enrollments')
      .select('course_id, completed_pod_rounds, pod_activation_round')
      .eq('learner_id', l.id)
    console.log(`\nRATCHET — ${l.display_name} (${l.id}):`)
    for (const e of (es || []).filter((e) => (e.completed_pod_rounds ?? 0) > 0 || COURSES.includes(e.course_id))) {
      console.log(`  ${e.course_id}: completed_pod_rounds=${e.completed_pod_rounds} ` +
        `pod_activation_round=${e.pod_activation_round}` +
        `  -> a lap REPLAYS ~${e.completed_pod_rounds} accumulated sentences, of which 1 is new`)
    }
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
