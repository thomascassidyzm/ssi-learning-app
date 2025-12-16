const fs = require('fs');
const https = require('https');

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co';
const SERVICE_KEY = 'sb_secret_rjnajgh-6CuwZUEJv7Xtkg_wCZuRyTh';

// Read the schema SQL
const schema = fs.readFileSync('schema_deploy_ready.sql', 'utf8');

// Execute via REST API
const url = new URL('/rest/v1/rpc/exec_sql', SUPABASE_URL);

const postData = JSON.stringify({ sql: schema });

const options = {
  hostname: 'swfvymspfxmnfhevgdkg.supabase.co',
  path: '/rest/v1/rpc/exec_sql',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.write(postData);
req.end();
