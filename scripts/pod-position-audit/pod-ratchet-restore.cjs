#!/usr/bin/env node
/**
 * pod-ratchet-restore.cjs — restore a learner's listening-pod ratchet
 * (`course_enrollments.completed_pod_rounds`) to the lap their OWN telemetry
 * proves they completed, after a course reset zeroed it.
 *
 * Job #656 (Tom's ruling, 2026-09-05): "Beuno's listening pods should not have
 * been reset, give them back to him on whatever lap he was at."
 *
 * THE UNIT TRAP. `completed_pod_rounds` does NOT store laps — it stores
 * SENTENCES COVERED (packages/core/src/pods/podCohorts.ts:212). So "3 laps"
 * must be mapped through the cohort partition the course serves TODAY, using
 * the shipped pure functions (buildPodCohorts / podRatchetAfterLap), never by
 * writing the lap number.
 *
 * SAFETY:
 *  - dry-run by default; `--apply` to write.
 *  - the UPDATE goes through greatest(), so it can only ever RAISE the value.
 *  - `rounds_since_pod` is never in the SET list (it is #649's work-debt
 *    counter; Beuno is deliberately seeded to 5 = owed a lap next boundary).
 *  - a per-row applied log records the before-state, so it is the rollback.
 *
 * Job #657 (Tom's ruling, 2026-09-05): the ruling was never person-specific —
 * generalised to any learner + course, so the other seven members of the class
 * are restored by exactly this method rather than a reinvented one.
 *
 * Usage:
 *   node scripts/pod-position-audit/pod-ratchet-restore.cjs --fleet
 *   node scripts/pod-position-audit/pod-ratchet-restore.cjs --learner <uuid|display_name> --course <course_id>
 *   node scripts/pod-position-audit/pod-ratchet-restore.cjs --learner paddyhardy --course rus_for_eng --apply
 */
const path = require('path')
const fs = require('fs')

const DASH = '/home/tomcassidy/ssi-dashboard-v7-clean'
require(path.join(DASH, 'node_modules', 'dotenv')).config({ path: path.join(DASH, '.env.psql'), quiet: true })
const { Client } = require(path.join(DASH, 'node_modules', 'pg'))

const REPO = path.resolve(__dirname, '..', '..')
const APPLY = process.argv.includes('--apply')
const FLEET = process.argv.includes('--fleet')

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
// Defaults preserve #656's target so the known-answer check is a bare re-run.
const LEARNER_ARG = arg('learner', '884a23bf-b5ca-4558-b297-c826b04c6dc7') // beunollyn
const COURSE_ID = arg('course', 'deu_for_eng')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Resolve --learner (uuid or display_name) to a single learners.id. */
async function resolveLearner(c, ref) {
  const { rows } = UUID_RE.test(ref)
    ? await c.query('select id, display_name from learners where id = $1', [ref])
    : await c.query('select id, display_name from learners where display_name = $1', [ref])
  if (rows.length !== 1) throw new Error(`--learner ${ref} resolved to ${rows.length} learners, need exactly 1`)
  return rows[0]
}

async function loadCore() {
  const cohorts = await import(path.join(REPO, 'packages/core/src/pods/podCohorts.ts'))
  const split = await import(path.join(REPO, 'packages/player-vue/src/composables/podSentenceSplit.ts'))
  return { cohorts, split }
}

/** Flatten per-TURN pod rows into per-SENTENCE units, as flattenPodRows does. */
function flatten(rows, splitRowUnits) {
  const out = []
  for (const row of rows) {
    const units = splitRowUnits(row)
    for (let k = 0; k < units.length; k++) {
      out.push({ scene_number: row.scene_number ?? null, glue_to_next: false })
    }
  }
  return out
}

/** Completed laps from a learner's own pod_lap telemetry. */
async function derivedLaps(c, learnerId, courseId) {
  const { rows } = await c.query(
    `select id, event_type, occurred_at, payload from player_events
      where user_id = $1 and course_code = $2 and event_type in ('pod_lap_start','pod_lap_end')
      order by occurred_at`,
    [learnerId, courseId],
  )
  const completed = rows.filter(
    (r) =>
      r.event_type === 'pod_lap_end' &&
      r.payload?.abortReason === 'completed' &&
      r.payload?.cancelled !== true &&
      r.payload?.skippedByUser !== true,
  )
  const podRounds = completed.map((r) => Number(r.payload?.podRound)).filter((n) => Number.isFinite(n))
  return {
    events: rows.length,
    completedEvents: completed.map((r) => ({
      id: String(r.id),
      occurred_at: r.occurred_at,
      podRound: r.payload?.podRound,
      abortReason: r.payload?.abortReason,
      playsExpected: r.payload?.playsExpected,
      playsCompleted: r.payload?.playsCompleted,
    })),
    laps: podRounds.length ? Math.max(...podRounds) : 0,
    distinctPodRounds: [...new Set(podRounds)].sort((a, b) => a - b),
  }
}

async function main() {
  const { cohorts: PC, split: PS } = await loadCore()
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  if (FLEET) {
    await fleet(c)
    await c.end()
    return
  }

  const learner = await resolveLearner(c, LEARNER_ARG)
  const LEARNER_ID = learner.id

  // 1. current live state
  const before = (
    await c.query(
      `select learner_id, course_id, completed_pod_rounds, pod_activation_round, rounds_since_pod, updated_at,
              highest_completed_seed, highest_completed_lego_id, current_mode
         from course_enrollments where learner_id = $1 and course_id = $2`,
      [LEARNER_ID, COURSE_ID],
    )
  ).rows[0]
  if (!before) throw new Error('no enrollment row found')

  // 2. laps genuinely completed, from his own telemetry
  const tele = await derivedLaps(c, LEARNER_ID, COURSE_ID)

  // 3. today's live cohorts → target stored value
  // WHICH POD. Mirror the learner path exactly (composables/servedPod.ts):
  // only slugs 'pod-1' then 'pod-0', pod_type core, visibility 'live'. #656's
  // `visibility = 'live' order by pod_order` happened to pick the right row for
  // deu_for_eng but is not the serving rule — a held pod is INDISTINGUISHABLE
  // from absent to a learner, and a parked slug must never resolve.
  // `--pod <id>` overrides it, for the one case where the pod the learner
  // actually heard is still on disk but currently held: mapping through the
  // real content they met beats mapping through nothing.
  const POD_OVERRIDE = arg('pod', null)
  const pod = POD_OVERRIDE
    ? (await c.query(`select id, slug, visibility from listening_pods where id = $1`, [POD_OVERRIDE])).rows[0]
    : (
        await c.query(
          `select id, slug, visibility from listening_pods
            where course_code = $1 and visibility = 'live'
              and slug = any($2::text[]) and (pod_type is null or pod_type = 'core')
            order by array_position($2::text[], slug) limit 1`,
          [COURSE_ID, ['pod-1', 'pod-0']],
        )
      ).rows[0]
  if (!pod) throw new Error('no served pod for ' + COURSE_ID + ' (no live pod-1/pod-0) — cannot map laps to sentences')
  const podRows = (
    await c.query(
      `select id, global_order, scene_number, speaker, target_text, known_text, target_audio_id,
              known_audio_id, glue_to_next, sentence_audio_ids, sentence_known_audio_ids
         from listening_pod_sentences where pod_id = $1 order by global_order`,
      [pod.id],
    )
  ).rows
  const sentences = flatten(podRows, PS.splitRowUnits)
  const cohorts = PC.buildPodCohorts(sentences)

  let target = 0
  const ladder = []
  for (let lap = 1; lap <= tele.laps; lap++) {
    target = PC.podRatchetAfterLap(cohorts, target)
    ladder.push({ lap, storedAfter: target, roundNow: PC.podCohortRoundFor(cohorts, target) })
  }

  const record = {
    job: 657,
    ruling: "Tom, 2026-09-05: a silently-zeroed pod ratchet is given back to the learner — not person-specific",
    generated_at: new Date().toISOString(),
    learner_id: LEARNER_ID,
    display_name: learner.display_name,
    course_id: COURSE_ID,
    before: {
      completed_pod_rounds: before.completed_pod_rounds,
      pod_activation_round: before.pod_activation_round,
      rounds_since_pod: before.rounds_since_pod,
      updated_at: before.updated_at,
      highest_completed_seed: before.highest_completed_seed,
      highest_completed_lego_id: before.highest_completed_lego_id,
      current_mode: before.current_mode,
    },
    telemetry: tele,
    live_pod: {
      pod_id: pod.id, slug: pod.slug, visibility: pod.visibility, overridden: Boolean(POD_OVERRIDE),
      turn_rows: podRows.length, sentences: sentences.length, cohorts: cohorts.length,
    },
    ladder,
    target_completed_pod_rounds: target,
    target_round: cohorts.length ? PC.podCohortRoundFor(cohorts, target) : null,
    applied: false,
  }

  if (!APPLY) {
    console.log('DRY RUN — no write')
    console.log(JSON.stringify(record, null, 2))
    await c.end()
    return
  }

  const res = await c.query(
    `update course_enrollments
        set completed_pod_rounds = greatest(coalesce(completed_pod_rounds, 0), $3::int),
            updated_at = now()
      where learner_id = $1 and course_id = $2
      returning completed_pod_rounds, pod_activation_round, rounds_since_pod, updated_at`,
    [LEARNER_ID, COURSE_ID, target],
  )
  const after = res.rows[0]
  record.applied = true
  record.after = {
    completed_pod_rounds: after.completed_pod_rounds,
    pod_activation_round: after.pod_activation_round,
    rounds_since_pod: after.rounds_since_pod,
    updated_at: after.updated_at,
  }
  record.rounds_since_pod_unchanged = after.rounds_since_pod === before.rounds_since_pod
  record.no_op = after.completed_pod_rounds === before.completed_pod_rounds

  // Independent re-read of the live row — RETURNING is not the verification.
  const reread = (
    await c.query(
      `select completed_pod_rounds, pod_activation_round, rounds_since_pod,
              highest_completed_seed, highest_completed_lego_id, current_mode
         from course_enrollments where learner_id = $1 and course_id = $2`,
      [LEARNER_ID, COURSE_ID],
    )
  ).rows[0]
  record.reread = reread
  record.reread_matches_target = reread.completed_pod_rounds === Math.max(before.completed_pod_rounds || 0, target)
  record.cursor_untouched =
    reread.highest_completed_seed === before.highest_completed_seed &&
    reread.highest_completed_lego_id === before.highest_completed_lego_id &&
    reread.current_mode === before.current_mode &&
    reread.rounds_since_pod === before.rounds_since_pod

  const out = path.join(REPO, 'docs/pod-position-audit/pod-ratchet-restore-fleet-applied-log.json')
  const log = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : []
  log.push(record)
  fs.writeFileSync(out, JSON.stringify(log, null, 2) + '\n')
  console.log(JSON.stringify(record, null, 2))
  console.log('applied log →', out)
  await c.end()
}

/**
 * FLEET FINGERPRINT — read-only. Which enrollments carry the course-reset
 * fingerprint on the ratchet (completed_pod_rounds = 0) while their own
 * telemetry proves at least one COMPLETED pod lap?
 */
async function fleet(c) {
  const { rows } = await c.query(`
    with laps as (
      select pe.user_id as learner_id,
             pe.course_code as course_id,
             count(*) filter (where pe.payload->>'abortReason' = 'completed'
                                and coalesce((pe.payload->>'cancelled')::boolean, false) = false
                                and coalesce((pe.payload->>'skippedByUser')::boolean, false) = false) as completed_laps,
             max(nullif(pe.payload->>'podRound','')::int) filter (where pe.payload->>'abortReason' = 'completed') as max_pod_round,
             min(pe.occurred_at) as first_lap,
             max(pe.occurred_at) as last_lap
        from player_events pe
       where pe.event_type = 'pod_lap_end'
       group by 1, 2
    )
    select l.learner_id, lr.display_name, l.course_id, l.completed_laps, l.max_pod_round,
           l.first_lap, l.last_lap,
           ce.completed_pod_rounds, ce.pod_activation_round, ce.rounds_since_pod
      from laps l
      left join course_enrollments ce on ce.learner_id = l.learner_id and ce.course_id = l.course_id
      left join learners lr on lr.id = l.learner_id
     where l.completed_laps > 0
     order by (ce.completed_pod_rounds is not distinct from 0) desc, l.completed_laps desc
  `)
  const zeroed = rows.filter((r) => r.completed_pod_rounds === 0)
  const missing = rows.filter((r) => r.completed_pod_rounds === null)
  console.log(JSON.stringify({
    query: 'every learner-course with >=1 pod_lap_end abortReason=completed, joined to its enrollment ratchet',
    learner_courses_with_completed_laps: rows.length,
    zeroed_ratchet_with_proven_laps: zeroed.length,
    enrollment_row_missing: missing.length,
    rows,
  }, null, 2))
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
