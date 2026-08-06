#!/usr/bin/env node
/**
 * Backfill class-teacher tags from the legacy lead pointer  (item A-74).
 *
 * WHY. teacher↔class is `user_tags(tag_type='class', role_in_context='teacher')`,
 * surfaced by the `class_teachers` view; `classes.teacher_user_id` is a demoted
 * denormalised LEAD POINTER. The dual-write was never completed, so measured
 * live 2026-08-06: of 62 classes, 47 have a lead pointer but NO active
 * class/teacher tag, 13 have both, 2 have neither. Only the 13 appear in
 * `class_teachers`.
 *
 * That matters now because 20260806_co_teacher_read_parity.sql routes
 * co-teacher access through `is_class_teacher()`, which reads TAGS. Without
 * this backfill, 47 classes keep working only through the legacy pointer — and
 * every membership-based guard shipped in this build would treat their lead
 * teacher as a non-member.
 *
 * WHAT IT DOES
 *   1. inserts the missing lead tag for every active class with a lead pointer
 *      and no active class/teacher tag  (is_lead falls out for free: the
 *      `class_teachers` view derives is_lead by comparing to teacher_user_id)
 *   2. soft-deletes (`removed_at`) class-teacher tags pointing at classes that
 *      no longer exist — 11 of them. Soft, not hard: this is the reversible
 *      choice, consistent with how the rest of the codebase retires tags.
 *
 * SAFETY
 *   - DRY RUN BY DEFAULT. Pass --commit to write.
 *   - Per-row before-state assertions; ABORTS on drift (if the row no longer
 *     looks the way it did when the plan was built, nothing is written).
 *   - Idempotent. `unique_active_tag` is UNIQUE (user_id, tag_type, tag_value)
 *     and is NOT partial — a soft-removed row still occupies the slot — so the
 *     insert is ON CONFLICT DO UPDATE ... SET removed_at = NULL, which
 *     reactivates rather than colliding. The constraint is NOT modified:
 *     partial-izing it would break paid enrolment via the paddle webhook's
 *     onConflict arbiter (docs/methodology/class-first-class-citizen.md:53).
 *   - Every row written is logged to
 *     backfill_class_teacher_tags_2026-08-06-{dryrun,applied}-log.json.
 *
 * Usage: node backfill_class_teacher_tags_2026-08-06.cjs [--commit]
 */
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const DB_URL = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
const COMMIT = process.argv.includes('--commit');
const ADDED_BY = 'backfill-a74-2026-08-06';

const COUNTS = `
  SELECT
    (SELECT count(*)::int FROM public.classes) AS classes_total,
    (SELECT count(*)::int FROM public.classes c WHERE c.teacher_user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.user_tags ut WHERE ut.tag_type='class'
         AND ut.role_in_context='teacher' AND ut.removed_at IS NULL
         AND ut.tag_value='CLASS:'||c.id::text)) AS lead_pointer_no_tag,
    (SELECT count(*)::int FROM public.classes c WHERE c.teacher_user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.user_tags ut WHERE ut.tag_type='class'
         AND ut.role_in_context='teacher' AND ut.removed_at IS NULL
         AND ut.tag_value='CLASS:'||c.id::text)) AS both,
    (SELECT count(*)::int FROM public.classes c WHERE c.teacher_user_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.user_tags ut WHERE ut.tag_type='class'
         AND ut.role_in_context='teacher' AND ut.removed_at IS NULL
         AND ut.tag_value='CLASS:'||c.id::text)) AS neither,
    (SELECT count(*)::int FROM public.user_tags ut WHERE ut.tag_type='class'
       AND ut.role_in_context='teacher' AND ut.removed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.classes c WHERE 'CLASS:'||c.id::text = ut.tag_value)) AS orphan_tags,
    (SELECT count(*)::int FROM public.class_teachers) AS class_teachers_rows
`;

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (sql, params) => c.query(sql, params);
  const log = { mode: COMMIT ? 'applied' : 'dryrun', before: null, after: null, inserts: [], orphans: [] };

  try {
    await q('BEGIN');

    log.before = (await q(COUNTS)).rows[0];
    console.log('BEFORE:', JSON.stringify(log.before));

    // ---- plan 1: missing lead tags ----------------------------------------
    const missing = (await q(`
      SELECT c.id AS class_id, c.class_name, c.teacher_user_id, c.school_id
      FROM public.classes c
      WHERE c.is_active
        AND c.teacher_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.user_tags ut
          WHERE ut.tag_type='class' AND ut.role_in_context='teacher'
            AND ut.removed_at IS NULL AND ut.tag_value='CLASS:'||c.id::text)
      ORDER BY c.created_at`)).rows;
    console.log(`\nplan: insert ${missing.length} lead tags`);

    for (const m of missing) {
      // before-state assertion: re-read the row and confirm it still matches
      const now = (await q(`SELECT teacher_user_id, is_active FROM public.classes WHERE id=$1`, [m.class_id])).rows[0];
      if (!now || now.teacher_user_id !== m.teacher_user_id || !now.is_active) {
        throw new Error(`DRIFT on class ${m.class_id}: expected lead ${m.teacher_user_id}, found ${now && now.teacher_user_id}`);
      }
      const entry = {
        class_id: m.class_id, class_name: m.class_name,
        teacher_user_id: m.teacher_user_id, school_id: m.school_id,
        tag_value: `CLASS:${m.class_id}`, action: 'insert_lead_tag',
      };
      const r = await q(`
        INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
        VALUES ($1, 'class', $2, 'teacher', $3)
        ON CONFLICT (user_id, tag_type, tag_value)
        DO UPDATE SET removed_at = NULL, role_in_context = 'teacher'
        RETURNING id, (xmax = 0) AS inserted`,
        [m.teacher_user_id, entry.tag_value, ADDED_BY]);
      entry.tag_id = r.rows[0].id;
      entry.reactivated = !r.rows[0].inserted;
      log.inserts.push(entry);
    }

    // ---- plan 2: orphan tags pointing at deleted classes ------------------
    const orphans = (await q(`
      SELECT ut.id, ut.user_id, ut.tag_value, ut.added_at, ut.added_by
      FROM public.user_tags ut
      WHERE ut.tag_type='class' AND ut.role_in_context='teacher' AND ut.removed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.classes c WHERE 'CLASS:'||c.id::text = ut.tag_value)
      ORDER BY ut.added_at`)).rows;
    console.log(`plan: soft-delete ${orphans.length} orphan tags (classes no longer exist)`);

    for (const o of orphans) {
      const still = (await q(`SELECT removed_at FROM public.user_tags WHERE id=$1`, [o.id])).rows[0];
      if (!still || still.removed_at !== null) throw new Error(`DRIFT on tag ${o.id}: already removed or gone`);
      await q(`UPDATE public.user_tags SET removed_at = now() WHERE id = $1 AND removed_at IS NULL`, [o.id]);
      log.orphans.push({ ...o, action: 'soft_delete_orphan' });
    }

    log.after = (await q(COUNTS)).rows[0];
    console.log('\nAFTER: ', JSON.stringify(log.after));

    // ---- reconcile: the deltas must equal exactly what we logged ----------
    const b = log.before, a = log.after;
    const checks = [
      ['lead_pointer_no_tag cleared', b.lead_pointer_no_tag - a.lead_pointer_no_tag, log.inserts.length],
      ['orphan_tags cleared', b.orphan_tags - a.orphan_tags, log.orphans.length],
      ['class_teachers grew', a.class_teachers_rows - b.class_teachers_rows, log.inserts.length - log.orphans.length + log.orphans.length],
      ['classes_total unchanged', a.classes_total - b.classes_total, 0],
      ['neither unchanged', a.neither - b.neither, 0],
    ];
    let bad = 0;
    for (const [name, actual, expected] of checks) {
      const okk = actual === expected;
      if (!okk) bad++;
      console.log(`  ${okk ? '✅' : '❌'} ${name}: ${actual} (expected ${expected})`);
    }

    const out = path.join(__dirname, `backfill_class_teacher_tags_2026-08-06-${log.mode}-log.json`);
    fs.writeFileSync(out, JSON.stringify(log, null, 1));
    console.log(`\nlog → ${out}`);

    if (bad === 0 && COMMIT) { await q('COMMIT'); console.log('✅ COMMITTED'); }
    else { await q('ROLLBACK'); console.log(bad ? '❌ ROLLED BACK — reconciliation failed' : 'ROLLED BACK (dry run — rerun with --commit)'); if (bad) process.exitCode = 1; }
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('BACKFILL ERROR:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
