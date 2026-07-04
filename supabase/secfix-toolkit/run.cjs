#!/usr/bin/env node
// Minimal SQL runner against the shared SSi DB.
// Usage: node run.cjs --file x.sql   OR   node run.cjs "SELECT 1"
// Loads DATABASE_URL from ssi-dashboard-v7-clean/.env.psql; pg from dashboard node_modules.
const fs = require('fs');
const path = require('path');
const DASH = '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean';
const { Client } = require(path.join(DASH, 'node_modules', 'pg'));

const envText = fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8');
const m = envText.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) { console.error('No DATABASE_URL in .env.psql'); process.exit(1); }

let sql;
if (process.argv[2] === '--file') sql = fs.readFileSync(process.argv[3], 'utf8');
else sql = process.argv.slice(2).join(' ');

(async () => {
  const c = new Client({ connectionString: m[1], ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const res = await c.query(sql);
    const results = Array.isArray(res) ? res : [res];
    for (const r of results) {
      if (r.rows && r.rows.length) console.log(JSON.stringify(r.rows, null, 1));
      else console.log(`-- ${r.command} ${r.rowCount ?? ''}`);
    }
  } finally { await c.end(); }
})().catch(e => { console.error('SQL ERROR:', e.message); process.exit(1); });
