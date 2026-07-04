// Lane C canary — secfix_13: lock down the 30 course-prod / Popty tables.
// Applies on LIVE prod inside ONE transaction, replays every real consumer
// path as its real role, asserts, then ROLLBACK (dry-run) or COMMIT iff all
// green (--commit). Write-replays are wrapped in SAVEPOINTs and rolled back
// individually, so even --commit persists ONLY the DDL.
//
//   node laneC_canary.cjs            # dry-run, rolls back, prints board
//   node laneC_canary.cjs --commit   # COMMIT only if every assertion passes
const fs=require('fs'); const path=require('path');
const PGDIR='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg';
const ENVP='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql';
const { Client }=require(PGDIR);
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;}

const MIG=path.join(__dirname,'20260610_secfix_13_course_prod_lockdown.sql');
const LEARNER_SUB='355e513f-1464-4739-b439-422c0c790c0c'; // real authenticated user

// expect: 'rows'(>=1) | 'ok'(no error) | 'denied'(permission/RLS error)
const ASSERTIONS=[
  // --- POPTY BROWSER (anon): the 4 dashboard reads must still populate ---
  {name:'POPTY: anon reads audio_flags (QA view)', role:'anon',
   sql:`select audio_uuid, status, reason, flagged_by, created_at from public.audio_flags where course_code='heb_for_eng' limit 3`, expect:'rows'},
  {name:'POPTY: anon counts course_gender_expansions (stats)', role:'anon',
   sql:`select count(*) from public.course_gender_expansions where course_code='hrv_for_eng'`, expect:'rows'},
  {name:'POPTY: anon reads orchestrator_messages (build monitor)', role:'anon',
   sql:`select * from public.orchestrator_messages where course_code='ces_for_eng' order by created_at limit 3`, expect:'rows'},
  {name:'POPTY: anon reads content_feedback (QA aggregation)', role:'anon',
   sql:`select audio_id, feedback_type, comment, created_at from public.content_feedback where course_code='spa_for_eng' limit 3`, expect:'rows'},

  // --- LEARNER-APP BROWSER: content read + the 3 feedback write paths ---
  {name:'PLAYER: anon reads lego_introductions (presentation audio)', role:'anon',
   sql:`select lego_id, presentation_audio_id, audio_uuid from public.lego_introductions where course_code='gle_for_eng' and lego_id in ('S0001L01') limit 1`, expect:'rows'},
  {name:'PLAYER: authed reads lego_introductions', role:'authenticated', jwtSub:LEARNER_SUB,
   sql:`select lego_id from public.lego_introductions where course_code='gle_for_eng' limit 1`, expect:'rows'},
  {name:'FEEDBACK: anon INSERT content_feedback (ReportIssue)', role:'anon',
   sql:`insert into public.content_feedback (course_code, feedback_type) values ('spa_for_eng','flagged')`, expect:'ok'},
  {name:'FEEDBACK: authed INSERT content_feedback', role:'authenticated', jwtSub:LEARNER_SUB,
   sql:`insert into public.content_feedback (course_code, feedback_type) values ('spa_for_eng','flagged')`, expect:'ok'},
  {name:'FEEDBACK: anon UPSERT sample_flags conflict-UPDATE path', role:'anon',
   sql:`insert into public.sample_flags (audio_uuid, course_code, status, notes, flagged_by, flagged_at)
        values ('4014814b-9c5a-41ac-9870-3a9ff2b05e3c','ita_for_eng','needs_review','Learner flagged for review','learner', now())
        on conflict (audio_uuid, course_code) do update
        set status=excluded.status, notes=excluded.notes, flagged_by=excluded.flagged_by, flagged_at=excluded.flagged_at`, expect:'ok'},
  {name:'FEEDBACK: anon UPSERT sample_flags fresh-INSERT path', role:'anon',
   sql:`insert into public.sample_flags (audio_uuid, course_code, status, notes, flagged_by, flagged_at)
        values (gen_random_uuid(),'ita_for_eng','needs_review','canary','learner', now())
        on conflict (audio_uuid, course_code) do update set status=excluded.status`, expect:'ok'},
  {name:'FEEDBACK: authed INSERT tester_feedback', role:'authenticated', jwtSub:LEARNER_SUB,
   sql:`insert into public.tester_feedback (user_id, title, feedback_type) values ('canary-user','canary probe','bug')`, expect:'ok'},

  // --- CAMBERLEY / VERCEL (service_role): pipeline must keep working ---
  {name:'SVC: service-role reads build_jobs', role:'service_role',
   sql:`select * from public.build_jobs limit 1`, expect:'rows'},
  {name:'SVC: service-role INSERT orchestrator_messages (emit-progress)', role:'service_role',
   sql:`insert into public.orchestrator_messages (course_code, direction, message) values ('canary_test','agent_to_human','canary')`, expect:'ok'},
  {name:'SVC: service-role resolves content_feedback (UPDATE)', role:'service_role',
   sql:`update public.content_feedback set resolved_at=now() where course_code='spa_for_eng'`, expect:'ok'},
  {name:'SVC: service-role updates sample_flags (QA resolve)', role:'service_role',
   sql:`update public.sample_flags set status='approved' where audio_uuid='4014814b-9c5a-41ac-9870-3a9ff2b05e3c' and course_code='ita_for_eng'`, expect:'ok'},
  {name:'SVC: service-role reads voices (voice-config-service)', role:'service_role',
   sql:`select * from public.voices limit 1`, expect:'rows'},
  {name:'SVC: service-role reads course_export_states (production-api)', role:'service_role',
   sql:`select * from public.course_export_states limit 1`, expect:'rows'},
  {name:'SVC: service-role reads try_links (api/try-link)', role:'service_role',
   sql:`select * from public.try_links limit 1`, expect:'rows'},

  // --- LOCKED: anon must now be denied on the no-consumer tables + writes ---
  {name:'LOCK: anon denied SELECT build_jobs', role:'anon',
   sql:`select * from public.build_jobs limit 1`, expect:'denied'},
  {name:'LOCK: anon denied SELECT course_seed_drafts', role:'anon',
   sql:`select * from public.course_seed_drafts limit 1`, expect:'denied'},
  {name:'LOCK: anon denied SELECT language_pair_briefs', role:'anon',
   sql:`select * from public.language_pair_briefs limit 1`, expect:'denied'},
  {name:'LOCK: anon denied SELECT try_links', role:'anon',
   sql:`select * from public.try_links limit 1`, expect:'denied'},
  {name:'LOCK: anon denied SELECT voices', role:'anon',
   sql:`select * from public.voices limit 1`, expect:'denied'},
  {name:'LOCK: anon denied SELECT tester_feedback (write-only)', role:'anon',
   sql:`select * from public.tester_feedback limit 1`, expect:'denied'},
  {name:'LOCK: anon denied INSERT orchestrator_messages', role:'anon',
   sql:`insert into public.orchestrator_messages (course_code, direction, message) values ('x','out','vandal')`, expect:'denied'},
  {name:'LOCK: anon denied UPDATE audio_flags', role:'anon',
   sql:`update public.audio_flags set status='cleared' where course_code='heb_for_eng'`, expect:'denied'},
  {name:'LOCK: anon denied UPDATE lego_introductions', role:'anon',
   sql:`update public.lego_introductions set course_code=course_code where course_code='gle_for_eng'`, expect:'denied'},
  {name:'LOCK: anon denied DELETE content_feedback', role:'anon',
   sql:`delete from public.content_feedback where course_code='spa_for_eng'`, expect:'denied'},
  {name:'LOCK: anon denied DELETE sample_flags', role:'anon',
   sql:`delete from public.sample_flags where course_code='ita_for_eng'`, expect:'denied'},
  {name:'LOCK: authed denied SELECT build_jobs', role:'authenticated', jwtSub:LEARNER_SUB,
   sql:`select * from public.build_jobs limit 1`, expect:'denied'},

  // --- regression guard: Tier-1 + keystone state intact ---
  {name:'GUARD: anon STILL denied who-pays', role:'anon',
   sql:`select * from public.learner_subscription_status limit 1`, expect:'denied'},
  {name:'GUARD: anon still reads course_stats (discovery)', role:'anon',
   sql:`select * from public.course_stats limit 1`, expect:'rows'},
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
  console.log(`\n===== LANE C secfix_13 (30 course-prod tables locked down) =====`);
  for(const r of results) console.log(`  ${r.pass?'✅':'❌'} [${r.role||'-'}/${r.expect||'-'}] ${r.name} — ${r.detail}`);
  console.log(`  ----\n  ${allPass?'ALL GREEN ✅':'HAS RED ❌'} · mode=${commit?(allPass?'COMMITTED':'rolled back (not green)'):'DRY-RUN (rolled back)'}`);
})();
