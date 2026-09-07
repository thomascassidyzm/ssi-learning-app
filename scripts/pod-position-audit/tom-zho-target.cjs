#!/usr/bin/env node
/**
 * tom-zho-target.cjs — the ONE derivation behind job #706's write, so the
 * number is computed rather than typed, and recomputed at write time.
 *
 * Tom, 2026-09-06: "Shall I correct your Chinese counter to what you actually
 * earned?" — "1 - yes". This account, this course, nothing else.
 *
 *   43  — the stored value his own completed Layer-2 pod laps drove the
 *         counter to by 2026-06-10. Read off the podRound LABEL of the last
 *         pod lap he completed before the gap: under that era's model
 *         podRound ≡ completed_pod_rounds + 1, so completing the lap labelled
 *         43 left the counter at 43. (Laps 1-18 predate pod_lap telemetry
 *         entirely — the event type shipped 2026-05-07 16:06 — which is why a
 *         replay from zero cannot reach this and reads 37 instead.)
 *   +1   per genuine completed Layer-2 pod lap on or after 2026-09-06, mapped
 *         through today's cohort partition with podRatchetAfterLap. He is
 *         playing while this runs, so the count is taken at write time.
 *
 * Layer-1 cups are excluded — that is the #657 defect this job fixed.
 */
const path = require('path')
const DASH = '/home/tomcassidy/ssi-dashboard-v7-clean'
require(path.join(DASH, 'node_modules', 'dotenv')).config({ path: path.join(DASH, '.env.psql'), quiet: true })
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))
const REPO = path.resolve(__dirname, '..', '..')

const LEARNER = '81987d60-0c00-4553-8a36-79f83cdf1774' // tom.cassidy — thomas.cassidy+ssi@gmail.com
const COURSE = 'zho_for_eng'
const EARNED_BY_2026_06_10 = 43
const SINCE = '2026-09-06T00:00:00Z'

async function derive(c) {
  const PC = await import(path.join(REPO, 'packages/core/src/pods/podCohorts.ts'))
  const PS = await import(path.join(REPO, 'packages/player-vue/src/composables/podSentenceSplit.ts'))
  const T = await import(path.join(__dirname, 'podLapTelemetry.ts'))

  const pod = (await c.query(
    `select id from listening_pods where course_code = $1 and visibility = 'live'
       and slug = any($2::text[]) and (pod_type is null or pod_type = 'core')
     order by array_position($2::text[], slug) limit 1`,
    [COURSE, ['pod-1', 'pod-0']],
  )).rows[0]
  if (!pod) throw new Error('no served pod for ' + COURSE)
  const rows = (await c.query(
    `select id, global_order, scene_number, speaker, target_text, known_text, target_audio_id,
            known_audio_id, glue_to_next, sentence_audio_ids, sentence_known_audio_ids
       from listening_pod_sentences where pod_id = $1 order by global_order`, [pod.id])).rows
  const sentences = []
  for (const r of rows) for (const _ of PS.splitRowUnits(r)) sentences.push({ scene_number: r.scene_number ?? null, glue_to_next: false })
  const cohorts = PC.buildPodCohorts(sentences)

  const ends = (await c.query(
    `select occurred_at, session_id, payload from player_events
      where user_id = $1 and course_code = $2 and event_type = 'pod_lap_end' and occurred_at >= $3
      order by occurred_at`, [LEARNER, COURSE, SINCE])).rows
  const stages = (await c.query(
    `select (payload->>'podRound')::int pr, session_id, max((payload->>'stage')::int) ms
       from player_events where user_id = $1 and course_code = $2 and event_type = 'audio_play'
        and payload->>'stage' is not null and occurred_at >= $3 group by 1, 2`,
    [LEARNER, COURSE, SINCE])).rows
  const stageBy = new Map(stages.map((r) => [r.pr + '|' + r.session_id, Number(r.ms)]))
  const events = ends.map((r) => ({
    occurredAt: new Date(r.occurred_at),
    payload: r.payload || {},
    childMaxStage: stageBy.has(Number(r.payload?.podRound) + '|' + r.session_id)
      ? stageBy.get(Number(r.payload?.podRound) + '|' + r.session_id) : null,
  }))
  const tally = T.tallyPodLaps(events)

  let target = EARNED_BY_2026_06_10
  for (let i = 0; i < tally.completedPodLaps; i++) target = PC.podRatchetAfterLap(cohorts, target)
  return {
    sentences: sentences.length,
    cohorts: cohorts.length,
    earned_by_2026_06_10: EARNED_BY_2026_06_10,
    laps_since: tally.completedPodLaps,
    layer1_cups_excluded_since: tally.completedLayer1Cups,
    target,
  }
}

if (require.main === module) {
  ;(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL })
    await c.connect()
    console.log(JSON.stringify(await derive(c), null, 2))
    await c.end()
  })().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
}

module.exports = { derive, LEARNER, COURSE }
