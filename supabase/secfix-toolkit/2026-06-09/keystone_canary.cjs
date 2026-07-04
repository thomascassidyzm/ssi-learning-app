// KEYSTONE (Lane A) canary — secfix_12: flip all 21 views to security_invoker=on.
// Applies on LIVE prod inside ONE transaction, replays the canary-critical reads as
// the real roles, asserts, then ROLLBACK (dry-run) or COMMIT iff all green (--commit).
//
//   node keystone_canary.cjs            # dry-run, rolls back, prints board
//   node keystone_canary.cjs --commit   # COMMIT only if every assertion passes
//
// Reads the migration from the same folder. Connection from ssi-dashboard-v7-clean/.env.psql.
const fs=require('fs'); const path=require('path');
const PGDIR='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg';
const ENVP='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql';
const { Client }=require(PGDIR);
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;}

const MIG=path.join(__dirname,'20260609_secfix_12_views_security_invoker_KEYSTONE.sql');
const ADMIN_SUB='355e513f-1464-4739-b439-422c0c790c0c'; // an authenticated schools admin

// expect: 'rows'(>=1) | 'ok'(no error) | 'denied'(permission/RLS error)
const ASSERTIONS=[
  // --- signup path: the 2 SECURITY-DEFINER validation views, read by service-role ---
  {name:'SIGNUP: service-role still reads invite_code_validation', role:'service_role', sql:`select * from public.invite_code_validation limit 1`, expect:'rows'},
  {name:'SIGNUP: service-role still reads entitlement_code_validation', role:'service_role', sql:`select * from public.entitlement_code_validation limit 1`, expect:'rows'},
  // --- schools dashboards (authenticated admin) must still populate ---
  {name:'SCHOOLS: authed reads class_student_progress', role:'authenticated', jwtSub:ADMIN_SUB, sql:`select * from public.class_student_progress limit 1`, expect:'rows'},
  {name:'SCHOOLS: authed reads class_activity_stats', role:'authenticated', jwtSub:ADMIN_SUB, sql:`select * from public.class_activity_stats limit 1`, expect:'rows'},
  {name:'SCHOOLS: authed reads demographic_cycle_averages', role:'authenticated', jwtSub:ADMIN_SUB, sql:`select * from public.demographic_cycle_averages limit 1`, expect:'rows'},
  {name:'SCHOOLS: authed reads region_summary', role:'authenticated', jwtSub:ADMIN_SUB, sql:`select * from public.region_summary limit 1`, expect:'rows'},
  // --- GUEST course discovery + content (anon) — the riskiest: invoker=on must not
  //     break anon reads of content views (if it does, EXCLUDE these from the flip) ---
  {name:'GUEST: anon still reads course_stats (discovery)', role:'anon', sql:`select * from public.course_stats limit 1`, expect:'rows'},
  {name:'GUEST: anon still reads seed_with_legos (content)', role:'anon', sql:`select * from public.seed_with_legos limit 1`, expect:'rows'},
  {name:'GUEST: anon still reads seed_cycles', role:'anon', sql:`select * from public.seed_cycles limit 1`, expect:'rows'},
  {name:'GUEST: anon still reads course_phrases_unified', role:'anon', sql:`select * from public.course_phrases_unified limit 1`, expect:'rows'},
  // --- regression guard: the Tier-1 sensitive views stay closed to anon ---
  {name:'GUARD: anon STILL denied who-pays', role:'anon', sql:`select * from public.learner_subscription_status limit 1`, expect:'denied'},
];

async function setCaller(c,a){
  if(a.jwtSub){ const claims=JSON.stringify({sub:a.jwtSub,role:a.role,aud:'authenticated'});
    await c.query(`select set_config('request.jwt.claims',$1,true)`,[claims]);
    await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[a.jwtSub]); }
  if(a.role&&a.role!=='postgres') await c.query(`set local role ${a.role}`);
}
async function assert(c,a){
  await c.query('SAVEPOINT s'); let got,err;
  try{ await setCaller(c,a); const r=await c.query(a.sql); got=r.rowCount; }catch(e){err=e;}
  await c.query('ROLLBACK TO SAVEPOINT s');
  let pass=false,detail='';
  if(a.expect==='denied'){pass=!!err&&/permission denied|row-level|42501|policy/i.test(err.message);detail=err?err.message.split('\n')[0]:`NO error (${got} rows) <-- LEAK`;}
  else if(a.expect==='rows'){pass=!err&&got>=1;detail=err?'ERR: '+err.message.split('\n')[0]:`${got} rows`;}
  else if(a.expect==='ok'){pass=!err;detail=err?'ERR: '+err.message.split('\n')[0]:'ok';}
  return {name:a.name,role:a.role,expect:a.expect,pass,detail};
}

(async()=>{
  const commit=process.argv.includes('--commit');
  const c=new Client({connectionString:loadEnv(ENVP).DATABASE_URL}); await c.connect();
  const results=[]; let allPass=true;
  try{
    await c.query('BEGIN');
    await c.query(fs.readFileSync(MIG,'utf8'));   // flip all 21 views
    for(const a of ASSERTIONS){ const r=await assert(c,a); results.push(r); if(!r.pass)allPass=false; }
    if(commit&&allPass) await c.query('COMMIT'); else await c.query('ROLLBACK');
  }catch(e){ await c.query('ROLLBACK').catch(()=>{}); results.push({name:'APPLY/FATAL',pass:false,detail:e.message.split('\n')[0]}); allPass=false; }
  await c.end();
  console.log(`\n===== KEYSTONE secfix_12 (all 21 views -> security_invoker=on) =====`);
  for(const r of results) console.log(`  ${r.pass?'✅':'❌'} [${r.role||'-'}/${r.expect||'-'}] ${r.name} — ${r.detail}`);
  console.log(`  ----\n  ${allPass?'ALL GREEN ✅':'HAS RED ❌'} · mode=${commit?(allPass?'COMMITTED':'rolled back (not green)'):'DRY-RUN (rolled back)'}`);
  if(!allPass) console.log(`  NOTE: any RED 'GUEST' line => that content view's guest read depends on owner-privilege; EXCLUDE it from the flip (keep security_invoker=off) and re-run.`);
})();
