// Canary for the additive player_events.app_shell column.
// One transaction: assert absent -> apply -> replay the real insert and the
// real read -> COMMIT iff both are green, ROLLBACK on anything else.
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));
const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const m = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
const MIGRATION = fs.readFileSync(process.argv[2], 'utf8')
  .split('\n').filter(l => !/^NOTIFY pgrst/.test(l.trim())).join('\n');

(async () => {
  const c = new Client({ connectionString: m[1], ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = (s, p) => c.query(s, p);
  try {
    const before = await q(`select count(*)::int n from information_schema.columns
       where table_schema='public' and table_name='player_events' and column_name='app_shell'`);
    console.log('app_shell present before:', before.rows[0].n);

    const rowsBefore = await q(`select count(*)::bigint n from player_events`);
    console.log('player_events rows before:', rowsBefore.rows[0].n);

    await q('BEGIN');
    await q(MIGRATION);

    // Replay 1 — the real insert api/player-events.ts does, WITH app_shell.
    await q(`insert into player_events (event_type, app_shell, env, occurred_at)
             values ('canary_app_shell','webview','canary', now())`);
    // Replay 2 — the real read shape a question page would use.
    const read = await q(`select app_shell, count(*)::int n from player_events
                          where env='canary' group by app_shell`);
    console.log('replay read:', JSON.stringify(read.rows));
    // Replay 3 — an insert WITHOUT app_shell must still work (the degradation
    // path in api/player-events.ts has to survive).
    await q(`insert into player_events (event_type, env, occurred_at)
             values ('canary_no_shell','canary', now())`);
    // Clean up the canary rows inside the same transaction.
    await q(`delete from player_events where env='canary'`);

    const after = await q(`select count(*)::int n from information_schema.columns
       where table_schema='public' and table_name='player_events' and column_name='app_shell'`);
    const rowsAfter = await q(`select count(*)::bigint n from player_events`);

    const green = after.rows[0].n === 1 && rowsAfter.rows[0].n === rowsBefore.rows[0].n;
    console.log('app_shell present after:', after.rows[0].n, '| rows after:', rowsAfter.rows[0].n);
    if (!green) { await q('ROLLBACK'); console.log('NOT GREEN — rolled back'); process.exit(1); }
    if (process.env.COMMIT === '1') { await q('COMMIT'); console.log('COMMITTED'); }
    else { await q('ROLLBACK'); console.log('GREEN — rolled back (dry run). Re-run with COMMIT=1.'); }
    await q(`NOTIFY pgrst, 'reload schema'`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('CANARY FAILED:', e.message);
    process.exit(1);
  } finally { await c.end(); }
})();
