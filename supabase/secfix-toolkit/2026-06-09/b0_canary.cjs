// Lane B0 canary — secfix_14: identity bridge + empty learner tables + player_events.
//   node b0_canary.cjs            # dry-run
//   node b0_canary.cjs --commit   # COMMIT iff all green
const fs=require('fs'); const path=require('path');
const PGDIR='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg';
const ENVP='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql';
const { Client }=require(PGDIR);
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;}

const MIG=path.join(__dirname,'20260610_secfix_14_identity_bridge_b0.sql');
const AUTH_SUB='355e513f-1464-4739-b439-422c0c790c0c';      // real auth user
const OWN_LEARNER='b05406f6-57d9-423b-9e44-756701253721';   // their learners.id
const OTHER_LEARNER='be30e58b-cced-48d6-819e-91a50256e9b6'; // someone else's learners.id

const ASSERTIONS=[
  // --- the bridge itself ---
  {name:'BRIDGE: current_learner_id() maps auth.uid -> own learners.id', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select 1 where public.current_learner_id() = '${OWN_LEARNER}'::uuid`, expect:'rows'},
  {name:'BRIDGE: returns null for anon', role:'anon',
   sql:`select 1 where public.current_learner_id() is null`, expect:'rows'},

  // --- own-row write/read on the 5 empty tables (representative replays) ---
  {name:'OWN: authed INSERT learner_points own row', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.learner_points (learner_id, course_id) values ('${OWN_LEARNER}','zho_for_eng')`, expect:'ok'},
  {name:'OWN: authed INSERT learner_milestones own row', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.learner_milestones (learner_id, course_id, milestone_type) values ('${OWN_LEARNER}','zho_for_eng','canary')`, expect:'ok'},
  {name:'FORGE: authed INSERT learner_points for ANOTHER learner -> denied', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.learner_points (learner_id, course_id) values ('${OTHER_LEARNER}','zho_for_eng')`, expect:'denied'},
  {name:'FORGE: authed INSERT response_metrics for ANOTHER learner -> denied', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.response_metrics (id, session_id, learner_id, course_id, lego_id, timestamp, response_latency_ms, phrase_length, normalized_latency, thread_id, mode)
        values ('canary-rm', gen_random_uuid(), '${OTHER_LEARNER}','zho_for_eng','S0001L01', now(), 100, 5, 1.0, 1, 'standard')`, expect:'denied'},
  {name:'OWN: authed SELECT response_metrics (own scope, empty ok)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.response_metrics where learner_id = public.current_learner_id() limit 1`, expect:'ok'},
  {name:'OWN: authed SELECT spike_events ok', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.spike_events limit 1`, expect:'ok'},
  {name:'OWN: authed SELECT learner_practice_history ok', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.learner_practice_history limit 1`, expect:'ok'},
  {name:'LOCK: anon denied SELECT learner_points', role:'anon',
   sql:`select * from public.learner_points limit 1`, expect:'denied'},
  {name:'LOCK: anon denied SELECT response_metrics', role:'anon',
   sql:`select * from public.response_metrics limit 1`, expect:'denied'},
  {name:'LOCK: anon denied INSERT spike_events', role:'anon',
   sql:`insert into public.spike_events (id, session_id, learner_id, course_id, lego_id, timestamp, latency, rolling_average, spike_ratio, response, thread_id)
        values ('canary-sp', gen_random_uuid(), '${OWN_LEARNER}','zho_for_eng','S0001L01', now(), 1.0, 1.0, 1.0, 'spike', 1)`, expect:'denied'},

  // --- player_events: service-only ---
  {name:'PE: authed denied INSERT player_events (writes go via api)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.player_events (event_type) values ('canary')`, expect:'denied'},
  {name:'PE: authed denied SELECT player_events', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.player_events limit 1`, expect:'denied'},
  {name:'PE: anon denied SELECT player_events', role:'anon',
   sql:`select * from public.player_events limit 1`, expect:'denied'},
  {name:'PE: service-role still INSERTs (api/player-events path)', role:'service_role',
   sql:`insert into public.player_events (event_type, user_id) values ('canary', '${OWN_LEARNER}')`, expect:'ok'},
  {name:'PE: service-role still reads (insights)', role:'service_role',
   sql:`select * from public.player_events limit 1`, expect:'rows'},

  // --- service + RPC readers unaffected ---
  {name:'SVC: service-role reads learner_points', role:'service_role',
   sql:`select * from public.learner_points limit 1`, expect:'ok'},

  // --- regression guards ---
  {name:'GUARD: anon still reads course_stats', role:'anon',
   sql:`select * from public.course_stats limit 1`, expect:'rows'},
  {name:'GUARD: anon STILL denied who-pays', role:'anon',
   sql:`select * from public.learner_subscription_status limit 1`, expect:'denied'},
  {name:'GUARD: feedback write path intact (anon INSERT content_feedback)', role:'anon',
   sql:`insert into public.content_feedback (course_code, feedback_type) values ('spa_for_eng','flagged')`, expect:'ok'},
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
    await c.query(fs.readFileSync(MIG,'utf8'));
    for(const a of ASSERTIONS){ const r=await assert(c,a); results.push(r); if(!r.pass)allPass=false; }
    if(commit&&allPass) await c.query('COMMIT'); else await c.query('ROLLBACK');
  }catch(e){ await c.query('ROLLBACK').catch(()=>{}); results.push({name:'APPLY/FATAL',pass:false,detail:e.message.split('\n')[0]}); allPass=false; }
  await c.end();
  console.log(`\n===== LANE B0 secfix_14 (identity bridge + empty learner tables + player_events) =====`);
  for(const r of results) console.log(`  ${r.pass?'✅':'❌'} [${r.role||'-'}/${r.expect||'-'}] ${r.name} — ${r.detail}`);
  console.log(`  ----\n  ${allPass?'ALL GREEN ✅':'HAS RED ❌'} · mode=${commit?(allPass?'COMMITTED':'rolled back (not green)'):'DRY-RUN (rolled back)'}`);
})();
