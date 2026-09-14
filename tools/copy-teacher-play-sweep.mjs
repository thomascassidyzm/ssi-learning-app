#!/usr/bin/env node
/**
 * One-off sweep: copy every UNAMBIGUOUS teacher's own-account play onto the
 * class's play-as-class account, platform-wide.
 *
 * WHY. Teachers run lessons signed in as themselves instead of using Play as
 * class, so the class account reads "not started" forever and the class loses
 * its own position. The per-pair copy tool already exists
 * (api/_utils/classProgressCopy.ts, preview/apply routes, one append-only
 * class_progress_copy_audit row per copy). Tom's ruling, 2026-09-14 16:30Z:
 * "wherever there is no ambiguity - i.e. one teacher, one class, and no play
 * as class data, we should copy it all over ... they can always skip back to
 * the beginning easily on the play as class account." This script is that
 * sweep. It supersedes #662's "no bulk apply" for the unambiguous cases ONLY;
 * everything ambiguous is left for the per-pair admin card.
 *
 * THE UNAMBIGUOUS CONDITION — all four must hold, anything else is ambiguous:
 *   1. exactly one teacher on the class (classes.teacher_user_id plus active
 *      class teacher user_tags, exactly as candidates.ts builds it);
 *   2. that teacher teaches exactly one class ACROSS THE WHOLE PLATFORM;
 *   3. the class account has zero play on the class course — no class learner
 *      at all, or no rows in any COPY_TABLES table for that course and a
 *      cursor with no position and zero practice minutes;
 *   4. the teacher's own account has play on that course (planCopy finds rows).
 * Plus one guard of Tom's own example: a class whose single teacher IS the
 * school's admin is treated as an admin or test class and left ambiguous —
 * Angharad's own account on her own admin class was one of #662's 27.
 *
 * NOTHING IS GUESSED. Every condition is re-derived from the live database on
 * both the dry run and the apply; --apply never trusts the dry-run file, and
 * re-asserts all four per pair at the moment it writes. A pair that has
 * drifted is skipped and named.
 *
 * COPY, NOT MOVE, AND REVERSIBLE. The teacher's rows stay where they are; the
 * audit row makes a second run a no-op and makes undoCopy possible
 * (api/_utils/classProgressCopy.ts). Every copy sends the teacher one in-app
 * message through the inbox primitive of job #684, whose one tap runs that
 * undo through POST /api/messages/act — so nobody's class account changes
 * without her being told and being able to put it back.
 *
 * ENV — service role required; the anon key silently undercounts:
 *   set -a; . ~/.ssi-sentinel.env; set +a
 *   export SUPABASE_URL=https://swfvymspfxmnfhevgdkg.supabase.co
 *
 * RUN — Node strips the types, and the resolver lets a .mjs import the app's
 * own TypeScript so this script cannot drift from the live copy rules:
 *   node --experimental-strip-types --import ./tools/ts-extension-resolver.mjs \
 *        tools/copy-teacher-play-sweep.mjs            # DRY RUN (default)
 *   ... tools/copy-teacher-play-sweep.mjs --apply     # write
 *
 * Logs land beside this file as copy-teacher-play-sweep-{dryrun,applied}-log.json.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { planCopy, applyCopy, cursorPosition, COPY_TABLES } from '../api/_utils/classProgressCopy.ts'
import { ensureClassLearnerEntity } from '../api/_utils/classLearnerEntity.ts'
import { sendClassPlayCopiedNotice } from '../api/_utils/copyPlayNotice.ts'

const APPLY = process.argv.includes('--apply')
const HERE = dirname(fileURLToPath(import.meta.url))

/** Names this sweep in every audit row it writes, so it is never mistaken for a school admin's own run. */
export const SWEEP_ACTOR = 'sweep:copy-teacher-play:2026-09-14'

/** A class with no learner entity has nothing on its side: plan against an id that matches no row. */
const NO_CLASS_LEARNER = '00000000-0000-0000-0000-000000000000'
/** planCopy reads a dozen tables per pair. Same figure as candidates.ts. */
const CONCURRENCY = 4
const PAGE = 1000

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (service role required).')
  process.exit(1)
}
const svc = createClient(url, key)

// ------------------------------------------------------------------ helpers

async function readAll(table, select, tune = (q) => q) {
  const out = []
  for (let page = 0; page < 200; page++) {
    const { data, error } = await tune(svc.from(table).select(select)).range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
  }
  return out
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

/** Test and probe accounts are counted separately and never copied either way. */
export function isTestAccount(learner, emails) {
  const name = String(learner?.display_name || '')
  if (/^zz\s*test/i.test(name)) return true
  for (const e of emails ?? []) {
    const s = String(e).toLowerCase()
    if (s.includes('@ssi-probe.test') || s.includes('+chepstowtest') || s.includes('+colombo-')) return true
  }
  return false
}

// ------------------------------------------------------------------ the scan

/**
 * Re-derives every pair and every condition from the live DB. Returns the
 * unambiguous copies, the ambiguous list with the condition each failed, and
 * the test accounts excluded. Writes nothing.
 */
export async function scan() {
  const schools = await readAll('schools', 'id, school_name, admin_user_id')
  const schoolById = new Map(schools.map((s) => [String(s.id), s]))

  // ALL classes, not only the candidates: condition 2 counts a teacher's
  // classes across the whole platform, including other schools'.
  const allClasses = await readAll('classes', 'id, school_id, class_name, course_code, teacher_user_id, class_learner_id, is_active')

  const teachersByClass = new Map()
  const add = (classId, uid) => {
    if (!teachersByClass.has(classId)) teachersByClass.set(classId, new Set())
    teachersByClass.get(classId).add(String(uid))
  }
  for (const c of allClasses) if (c.teacher_user_id) add(String(c.id), c.teacher_user_id)
  const tags = await readAll('user_tags', 'user_id, tag_value', (q) =>
    q.eq('tag_type', 'class').eq('role_in_context', 'teacher').is('removed_at', null))
  for (const t of tags) {
    const classId = String(t.tag_value || '').replace('CLASS:', '')
    if (classId) add(classId, t.user_id)
  }

  const classCountByTeacher = new Map()
  for (const [, uids] of teachersByClass) {
    for (const uid of uids) classCountByTeacher.set(uid, (classCountByTeacher.get(uid) ?? 0) + 1)
  }

  const candidateClasses = allClasses.filter((c) => c.is_active !== false && c.course_code)

  // Teacher learner rows, for every teacher of a candidate class.
  const teacherUids = [...new Set(candidateClasses.flatMap((c) => [...(teachersByClass.get(String(c.id)) ?? [])]))]
  const learnerByUid = new Map()
  for (let i = 0; i < teacherUids.length; i += 200) {
    const batch = teacherUids.slice(i, i + 200)
    const { data, error } = await svc.from('learners').select('id, user_id, display_name, verified_emails').in('user_id', batch)
    if (error) throw new Error(`learners read failed: ${error.message}`)
    for (const r of data ?? []) learnerByUid.set(String(r.user_id), r)
  }

  const copies = []
  const ambiguous = []
  const testAccounts = []

  const pairs = []
  for (const cls of candidateClasses) {
    const uids = [...(teachersByClass.get(String(cls.id)) ?? [])]
    for (const uid of uids) pairs.push({ cls, uid, teacherCount: uids.length })
  }

  // Cheap conditions first: only pairs that pass 1, 2 and the admin-class
  // guard are worth a planCopy, which is thirteen table reads each.
  const planned = []
  for (const p of pairs) {
    const { cls, uid, teacherCount } = p
    const school = schoolById.get(String(cls.school_id))
    const learner = learnerByUid.get(uid)
    const base = {
      school: { id: String(cls.school_id ?? ''), name: String(school?.school_name ?? '') },
      class: { id: String(cls.id), name: String(cls.class_name ?? ''), course_code: String(cls.course_code), class_learner_id: cls.class_learner_id ?? null },
      teacher: { user_id: uid, name: String(learner?.display_name ?? ''), learner_id: learner ? String(learner.id) : null },
      teachers_on_class: teacherCount,
      classes_taught_platform_wide: classCountByTeacher.get(uid) ?? 0,
    }
    // The sweep is a SCHOOLS sweep: Tom's ruling walks every school. A class
    // with no school row behind it — a tutor's own class, a fixture — is out
    // of scope and is listed, never copied.
    if (!school) { ambiguous.push({ ...base, failed: 'no_school', detail: 'this class belongs to no school, so it is outside a schools sweep' }); continue }
    if (!learner) { ambiguous.push({ ...base, failed: 'no_learner_account', detail: 'that teacher has no learner row, so there is nothing to copy' }); continue }
    if (isTestAccount(learner, learner.verified_emails)) { testAccounts.push(base); continue }
    if (teacherCount !== 1) { ambiguous.push({ ...base, failed: 'condition_1_one_teacher', detail: `${teacherCount} teachers on this class` }); continue }
    if ((classCountByTeacher.get(uid) ?? 0) !== 1) { ambiguous.push({ ...base, failed: 'condition_2_one_class', detail: `this teacher is on ${classCountByTeacher.get(uid)} classes platform-wide` }); continue }
    if (String(school.admin_user_id || '') === uid) { ambiguous.push({ ...base, failed: 'admin_class', detail: 'the single teacher is the school admin, so this reads as an admin or test class' }); continue }
    planned.push({ ...p, base, learner })
  }

  const evaluated = await mapLimit(planned, CONCURRENCY, async ({ cls, base, learner }) => {
    const courseCode = String(cls.course_code)
    const targetLearnerId = cls.class_learner_id ? String(cls.class_learner_id) : NO_CLASS_LEARNER
    const plan = await planCopy(svc, { sourceLearnerId: String(learner.id), targetLearnerId, courseCode })
    const classRows = cls.class_learner_id ? await countClassRows(targetLearnerId, courseCode) : { total: 0, perTable: {} }
    return { base, plan, classRows, cls }
  })

  for (const { base, plan, classRows, cls } of evaluated) {
    const tPos = cursorPosition(plan.cursor.target)
    const sPos = cursorPosition(plan.cursor.source)
    const classMinutes = Number(plan.cursor.target?.total_practice_minutes || 0)
    const teacherMinutes = Number(plan.cursor.source?.total_practice_minutes || 0)
    const totalToCopy = Object.values(plan.toCopy).reduce((a, b) => a + b, 0)
    const figures = {
      ...base,
      teacher_minutes: teacherMinutes,
      class_minutes: classMinutes,
      teacher_position: sPos.legoId,
      class_position: tPos.legoId,
      class_rows_on_course: classRows.total,
    }
    if (classRows.total > 0 || tPos.legoId || classMinutes > 0) {
      ambiguous.push({
        ...figures,
        failed: 'condition_3_class_account_has_play',
        detail: `the class account already has ${classRows.total} rows, position ${tPos.legoId ?? 'none'}, ${classMinutes} minutes on this course`,
        class_rows_per_table: classRows.perTable,
      })
      continue
    }
    if (totalToCopy === 0) {
      ambiguous.push({ ...figures, failed: 'condition_4_nothing_to_copy', detail: 'the teacher has no own-account play on this course' })
      continue
    }
    copies.push({
      ...figures,
      to_copy: plan.toCopy,
      total_rows: totalToCopy,
      in_app_seconds: plan.inAppSecondsToCopy,
      minutes_to_add: plan.minutesToAdd,
      prior_runs: plan.priorRuns,
      resulting_position: plan.resulting.legoId,
      class_learner_will_be_created: !cls.class_learner_id,
    })
  }

  const sortKey = (r) => `${r.school.name} ${r.class.name} ${r.teacher.name}`
  copies.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  ambiguous.sort((a, b) => `${a.failed} ${sortKey(a)}`.localeCompare(`${b.failed} ${sortKey(b)}`))

  return {
    generated_at: new Date().toISOString(),
    schools_scanned: schools.length,
    classes_scanned: allClasses.length,
    candidate_classes: candidateClasses.length,
    pairs_checked: pairs.length,
    copies,
    ambiguous,
    test_accounts_excluded: testAccounts,
  }
}

/** Direct row counts on the class side — condition 3 never trusts the enrollment row alone. */
async function countClassRows(learnerId, courseCode) {
  const perTable = {}
  let total = 0
  for (const spec of COPY_TABLES) {
    const { count, error } = await svc
      .from(spec.table)
      .select('*', { count: 'exact', head: true })
      .eq('learner_id', learnerId)
      .eq(spec.courseColumn, courseCode)
    if (error) throw new Error(`${spec.table} count failed: ${error.message}`)
    perTable[spec.table] = count ?? 0
    total += count ?? 0
  }
  return { total, perTable }
}

// ----------------------------------------------------------------- the apply

async function applySweep(scanResult) {
  const applied = []
  for (const row of scanResult.copies) {
    const label = `${row.school.name} / ${row.class.name} / ${row.teacher.name}`
    try {
      // Re-derive from the DB at the moment of writing. A pair that has
      // drifted since the scan is skipped and named, never forced.
      const fresh = await scan()
      const still = fresh.copies.find((c) => c.class.id === row.class.id && c.teacher.user_id === row.teacher.user_id)
      if (!still) {
        applied.push({ ...row, outcome: 'skipped_drift', detail: 'the four conditions no longer hold for this pair' })
        console.log(`  SKIP (drifted)  ${label}`)
        continue
      }
      // The pair still qualifies, but the copy is planned from the FRESH row,
      // never the original scan: a class whose course changed, or a teacher
      // whose learner row was re-pointed, is skipped and named (job #689).
      if (still.class.course_code !== row.class.course_code || still.teacher.learner_id !== row.teacher.learner_id) {
        const detail = `scan said ${row.class.course_code} / ${row.teacher.learner_id}, now ${still.class.course_code} / ${still.teacher.learner_id}`
        applied.push({ ...row, outcome: 'skipped_drift', detail })
        console.log(`  SKIP (drifted)  ${label}: ${detail}`)
        continue
      }
      const ensured = await ensureClassLearnerEntity(svc, still.class.id)
      if ('error' in ensured) {
        applied.push({ ...row, outcome: 'failed', detail: `class learner: ${ensured.error}` })
        console.log(`  FAIL  ${label}: ${ensured.error}`)
        continue
      }
      const plan = await planCopy(svc, {
        sourceLearnerId: still.teacher.learner_id,
        targetLearnerId: ensured.learnerId,
        courseCode: still.class.course_code,
      })
      const { record, auditId, error } = await applyCopy(svc, plan, { actorUserId: SWEEP_ACTOR, classId: still.class.id })
      const copiedCounts = Object.fromEntries(Object.entries(record.copied).map(([t, m]) => [t, Object.keys(m).length]))
      const totalRows = Object.values(copiedCounts).reduce((a, b) => a + b, 0)
      if (error) {
        applied.push({ ...row, outcome: 'partial', audit_id: auditId, copied: copiedCounts, total_rows: totalRows, detail: error })
        console.log(`  PARTIAL  ${label}: ${error}`)
        continue
      }
      // applyCopy already sends the teacher her notice through the inbox
      // primitive (job #684). This re-asserts it rather than sending a second:
      // the notice is deduped on the audit id, so a call that finds one
      // already there says so and writes nothing.
      const notice = auditId
        ? await sendClassPlayCopiedNotice(svc, auditId)
        : { sent: false, id: null, skipped: 'no audit id' }
      applied.push({
        ...row,
        outcome: 'copied',
        audit_id: auditId,
        copied: copiedCounts,
        total_rows: totalRows,
        minutes_added: record.minutesAdded,
        cursor_taken_from_teacher: record.cursorTakenFromSource,
        notice,
      })
      console.log(`  copied  ${label}  ${totalRows} rows${notice.sent ? '' : `  [notice: ${notice.skipped || notice.error || 'already sent'}]`}`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      applied.push({ ...row, outcome: 'failed', detail })
      console.log(`  FAIL  ${label}: ${detail}`)
    }
  }
  return applied
}

// -------------------------------------------------------------------- run it

const result = await scan()
console.log(`\nschools ${result.schools_scanned}  classes ${result.classes_scanned}  pairs ${result.pairs_checked}`)
console.log(`unambiguous copies: ${result.copies.length}  ambiguous: ${result.ambiguous.length}  test accounts: ${result.test_accounts_excluded.length}`)
const byCondition = {}
for (const a of result.ambiguous) byCondition[a.failed] = (byCondition[a.failed] ?? 0) + 1
for (const [k, v] of Object.entries(byCondition).sort()) console.log(`  ${k}: ${v}`)

if (!APPLY) {
  writeFileSync(join(HERE, 'copy-teacher-play-sweep-dryrun-log.json'), JSON.stringify({ mode: 'dry-run', ...result }, null, 2))
  console.log('\nDRY RUN — nothing written. Log: tools/copy-teacher-play-sweep-dryrun-log.json')
  console.log('Re-run with --apply to write.')
} else {
  console.log(`\nAPPLYING ${result.copies.length} copies as ${SWEEP_ACTOR}\n`)
  const applied = await applySweep(result)
  const after = await scan()
  const log = {
    mode: 'applied',
    generated_at: new Date().toISOString(),
    actor: SWEEP_ACTOR,
    planned: result.copies.length,
    copied: applied.filter((a) => a.outcome === 'copied').length,
    partial: applied.filter((a) => a.outcome === 'partial').length,
    failed: applied.filter((a) => a.outcome === 'failed').length,
    skipped_drift: applied.filter((a) => a.outcome === 'skipped_drift').length,
    applied,
    reconciliation: {
      copies_remaining_after: after.copies.length,
      ambiguous_before: result.ambiguous.length,
      ambiguous_after: after.ambiguous.length,
      ambiguous_identical: JSON.stringify(after.ambiguous) === JSON.stringify(result.ambiguous),
    },
  }
  writeFileSync(join(HERE, 'copy-teacher-play-sweep-applied-log.json'), JSON.stringify(log, null, 2))
  console.log(`\ncopied ${log.copied}  partial ${log.partial}  failed ${log.failed}  skipped ${log.skipped_drift}`)
  console.log(`re-run: ${after.copies.length} copies still outstanding, ambiguous list ${log.reconciliation.ambiguous_identical ? 'bit-identical' : 'CHANGED — read it'}`)
  console.log('Log: tools/copy-teacher-play-sweep-applied-log.json')
}
