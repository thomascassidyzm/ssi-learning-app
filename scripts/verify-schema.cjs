#!/usr/bin/env node
/**
 * Schema Verification Script
 * Checks if the learner tables have been deployed to Supabase
 */

const https = require('https');

const PROJECT_REF = 'swfvymspfxmnfhevgdkg';
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg';

const REQUIRED_TABLES = [
  'learners',
  'course_enrollments',
  'lego_progress',
  'seed_progress',
  'sessions',
  'response_metrics',
  'spike_events'
];

async function checkTable(tableName) {
  return new Promise((resolve) => {
    const options = {
      hostname: `${PROJECT_REF}.supabase.co`,
      path: `/rest/v1/${tableName}?select=*&limit=0`,
      method: 'GET',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ table: tableName, exists: true });
        } else {
          resolve({ table: tableName, exists: false });
        }
      });
    });

    req.on('error', () => {
      resolve({ table: tableName, exists: false, error: true });
    });

    req.end();
  });
}

async function main() {
  console.log('SSi Learning App - Schema Verification');
  console.log('======================================\n');

  const results = await Promise.all(REQUIRED_TABLES.map(checkTable));

  let allExist = true;
  let missingTables = [];

  console.log('Learner Tables Status:');
  console.log('');

  for (const result of results) {
    if (result.exists) {
      console.log(`  [OK] ${result.table}`);
    } else {
      console.log(`  [--] ${result.table}`);
      allExist = false;
      missingTables.push(result.table);
    }
  }

  console.log('');

  if (allExist) {
    console.log('All tables exist! Schema is deployed.');
    process.exit(0);
  } else {
    console.log('Missing tables:', missingTables.join(', '));
    console.log('');
    console.log('To deploy the schema:');
    console.log('  1. Open: https://supabase.com/dashboard/project/' + PROJECT_REF + '/sql');
    console.log('  2. Copy contents of: schema_deploy_ready.sql');
    console.log('  3. Paste and click "Run"');
    process.exit(1);
  }
}

main().catch(console.error);
