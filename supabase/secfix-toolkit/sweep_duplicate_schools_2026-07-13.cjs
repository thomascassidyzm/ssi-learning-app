#!/usr/bin/env node
/**
 * Read-only sweep for duplicate `schools` rows created by the school_admin
 * double-redeem race (WORKLIST 07-13, fixed by
 * 20260713_school_admin_unique_natural_key.sql + api/code/redeem.ts
 * idempotency). Finds every admin_user_id with >1 schools row, and for each
 * duplicate reports whether it looks like an unambiguous synthetic leftover
 * (no classes, no user_tags referencing it, no invite_codes redeemed against
 * it beyond its own join codes) so a human can decide what to clean up.
 *
 * NEVER deletes anything — report only. Usage: node sweep_duplicate_schools_2026-07-13.cjs
 * Creds: DATABASE_URL from ssi-dashboard-v7-clean/.env.psql (postgres role).
 */
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: dupeAdmins } = await c.query(`
    SELECT admin_user_id, count(*) AS n
    FROM public.schools
    WHERE admin_user_id IS NOT NULL
    GROUP BY admin_user_id
    HAVING count(*) > 1
    ORDER BY count(*) DESC
  `);

  console.log(`Found ${dupeAdmins.length} admin_user_id(s) with more than one schools row.\n`);

  for (const { admin_user_id, n } of dupeAdmins) {
    console.log(`=== admin_user_id ${admin_user_id} — ${n} schools rows ===`);
    const { rows: schools } = await c.query(
      `SELECT id, school_name, created_at, invite_code_id, group_id, platform_status
       FROM public.schools WHERE admin_user_id = $1 ORDER BY created_at ASC`,
      [admin_user_id]
    );
    for (const s of schools) {
      const { rows: [classCount] } = await c.query(
        `SELECT count(*)::int AS n FROM public.classes WHERE school_id = $1`, [s.id]
      );
      const { rows: [tagCount] } = await c.query(
        `SELECT count(*)::int AS n FROM public.user_tags WHERE tag_value = $1 AND removed_at IS NULL`,
        [`SCHOOL:${s.id}`]
      );
      const { rows: [redeemCount] } = await c.query(
        `SELECT count(*)::int AS n FROM public.invite_codes WHERE grants_school_id = $1 AND use_count > 0`,
        [s.id]
      );
      const empty = classCount.n === 0 && tagCount.n === 0 && redeemCount.n === 0;
      console.log(
        `  ${empty ? 'EMPTY-SYNTHETIC' : 'HAS ACTIVITY '} id=${s.id} name="${s.school_name}" created=${s.created_at.toISOString()} ` +
        `classes=${classCount.n} user_tags=${tagCount.n} redeemed_join_codes=${redeemCount.n} status=${s.platform_status}`
      );
    }
    console.log('');
  }

  const { rows: dupeGovt } = await c.query(`
    SELECT user_id, count(*) AS n
    FROM public.govt_admins
    GROUP BY user_id
    HAVING count(*) > 1
    ORDER BY count(*) DESC
  `);
  console.log(`Found ${dupeGovt.length} user_id(s) with more than one govt_admins row.`);
  for (const { user_id, n } of dupeGovt) {
    console.log(`  user_id ${user_id} — ${n} govt_admins rows`);
  }

  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
