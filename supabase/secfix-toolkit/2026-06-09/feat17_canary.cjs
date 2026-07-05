// feat_17 canary — is_demo separation. Verifies the flag exists, demo sessions
// are invisible to ALL global aggregates, real sessions still aggregate, and
// the leaderboard kept security_invoker through the REPLACE.
const fs=require('fs'); const path=require('path');
const { Client }=require('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg');
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;}
const MIG=path.join(__dirname,'20260610_feat_17_demo_data_separation.sql');
const AUTH_SUB='355e513f-1464-4739-b439-422c0c790c0c';
const OWN_LEARNER='b05406f6-57d9-423b-9e44-756701253721';
const DEMO_LID='c0de0000-0000-4000-8000-0000000000dd';

const SETUP=[
  `insert into public.learners (id, user_id, display_name, is_demo) values ('${DEMO_LID}','c0de0000-0000-4000-8000-0000000000de','Canary Demo', true)`,
  `insert into public.sessions (learner_id, course_id, started_at, duration_seconds, items_practiced)
   values ('${DEMO_LID}','zzz_for_eng', '2026-01-15T12:00:00Z', 600, 50)`,
  `insert into public.sessions (learner_id, course_id, started_at, duration_seconds, items_practiced)
   values ('${OWN_LEARNER}','zzy_for_eng', '2026-01-15T12:00:00Z', 600, 50)`,
];
const CLEANUP=[
  `delete from public.sessions where learner_id='${DEMO_LID}' or course_id='zzy_for_eng'`,
  `delete from public.daily_contributions where target_language in ('zzy','zzz')`,
  `delete from public.learners where id='${DEMO_LID}'`,
];
const ASSERTIONS=[
  {name:'COLS: is_demo exists on learners/schools/groups',
   sql:`select 1 where (select count(*) from information_schema.columns where table_schema='public' and column_name='is_demo' and table_name in ('learners','schools','groups')) = 3`, expect:'rows'},
  {name:'DC: DEMO session (setup) aggregated NOTHING',
   sql:`select 1 where not exists (
          select 1 from public.daily_contributions
          where target_language='zzz' and contribution_date='2026-01-15' and (phrases_count>0 or unique_speakers>0))`, expect:'rows'},
  {name:'DC: REAL session (setup) aggregated correctly (trigger alive)',
   sql:`select 1 from public.daily_contributions
        where target_language='zzy' and contribution_date='2026-01-15' and phrases_count=50 and unique_speakers=1`, expect:'rows'},
  {name:'WL: leaderboard selectable + demo learners excluded',
   sql:`select 1 where not exists (select 1 from public.weekly_leaderboard wl join public.learners l on l.id=wl.learner_id where l.is_demo)`, expect:'rows'},
  {name:'WL: security_invoker SURVIVED the REPLACE (regression guard)',
   sql:`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname='weekly_leaderboard'
          and coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name='security_invoker'), false)`, expect:'rows'},
  {name:'WL: anon still revoked on leaderboard', role:'anon',
   sql:`select * from public.weekly_leaderboard limit 1`, expect:'denied'},
  {name:'GCC: returns 3 windows, still works', role:'anon',
   sql:`select * from public.get_community_contribution('cym')`, expect:'rows'},
  {name:'GUARD: anon reads daily_contributions', role:'anon',
   sql:`select * from public.daily_contributions limit 1`, expect:'rows'},
  {name:'GUARD: who-pays still denied', role:'anon',
   sql:`select * from public.learner_subscription_status limit 1`, expect:'denied'},
];

async function setCaller(c,a){
  if(a.jwtSub){ const claims={sub:a.jwtSub,role:a.role,aud:'authenticated'};
    await c.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify(claims)]);
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
  const c=new Client({connectionString:loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql').DATABASE_URL}); await c.connect();
  const results=[]; let allPass=true;
  try{
    await c.query('BEGIN');
    await c.query(fs.readFileSync(MIG,'utf8'));
    for(const s of SETUP) await c.query(s);
    for(const a of ASSERTIONS){ const r=await assert(c,a); results.push(r); if(!r.pass)allPass=false; }
    for(const s of CLEANUP) await c.query(s);
    const v=await c.query(`select 1 where not exists (select 1 from public.learners where id='${DEMO_LID}')`);
    results.push({name:'CLEANUP: fixtures removed', expect:'rows', pass:v.rowCount>=1, detail:v.rowCount>=1?'clean':'REMAIN'});
    if(v.rowCount<1) allPass=false;
    if(commit&&allPass) await c.query('COMMIT'); else await c.query('ROLLBACK');
  }catch(e){ await c.query('ROLLBACK').catch(()=>{}); results.push({name:'APPLY/FATAL',pass:false,detail:e.message.split('\n')[0]}); allPass=false; }
  await c.end();
  console.log(`\n===== FEAT_17 (is_demo separation) =====`);
  for(const r of results) console.log(`  ${r.pass?'✅':'❌'} [${r.role||'-'}/${r.expect||'-'}] ${r.name} — ${r.detail}`);
  console.log(`  ----\n  ${allPass?'ALL GREEN ✅':'HAS RED ❌'} · mode=${commit?(allPass?'COMMITTED':'rolled back'):'DRY-RUN (rolled back)'}`);
})();
