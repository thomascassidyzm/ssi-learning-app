#!/usr/bin/env node
// Ad-hoc read-only query runner against the live SSi DB (postgres role).
// Usage: node q.cjs "SELECT ..."   or   node q.cjs --file query.sql
const fs = require('fs');
const path = require('path');
const DASH = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));
const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const DB_URL = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];

const sql = process.argv[2] === '--file'
  ? fs.readFileSync(process.argv[3], 'utf8')
  : process.argv[2];

(async () => {
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(sql);
    const results = Array.isArray(r) ? r : [r];
    for (const res of results) {
      if (res.rows && res.rows.length) console.log(JSON.stringify(res.rows, null, 1));
      else console.log(`-- ${res.command} ${res.rowCount ?? ''}`);
    }
  } finally {
    await c.end();
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
