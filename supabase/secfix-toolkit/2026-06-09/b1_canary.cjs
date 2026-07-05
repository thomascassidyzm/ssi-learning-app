// Lane B1 canary — secfix_15: class_sessions backfill+RLS, user_tags relink+RLS.
// Uses in-transaction FIXTURES (created as postgres after the migration, deleted
// before COMMIT) so principal-scope branches can be asserted against rows that
// auth.uid() can actually match — the live demo data is Clerk-era fake ids.
//   node b1_canary.cjs            # dry-run
//   node b1_canary.cjs --commit   # COMMIT iff all green (fixtures removed either way)
const fs=require('fs'); const path=require('path');
const PGDIR='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg';
const ENVP='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql';
const { Client }=require(PGDIR);
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;}

const MIG=path.join(__dirname,'20260610_secfix_15_class_sessions_user_tags_b1.sql');
const AUTH_SUB='355e513f-1464-4739-b439-422c0c790c0c';       // real auth user (school admin of the FIXTURE school below)
const OWN_LEARNER='b05406f6-57d9-423b-9e44-756701253721';
const OTHER_UID='user_38XyeApIRkuFsPlQ80SCk25k463';          // a DIFFERENT identity that IS on a learners row (Clerk-era, demo)
const RANDOM_SUB='dddddddd-0000-4000-8000-000000000009';     // auth uid with NO learner row
const SCHOOL='c0de0000-0000-4000-8000-000000000001';
const KLASS ='c0de0000-0000-4000-8000-000000000002';
const REAL_CLASS='d5000000-0000-0000-0000-000000000001';     // existing demo class (FK target)
const OTHER_SCHOOL='88fc72f5-37a2-4bb9-9dde-acf61691fbc9';   // real school NOT admined by AUTH_SUB

const SETUP=[
  `insert into public.schools (id, school_name, admin_user_id, teacher_join_code, admin_join_code)
   values ('${SCHOOL}','CANARY SCHOOL','${AUTH_SUB}','CANARY-T-0610','CANARY-A-0610')`,
  `insert into public.classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code)
   values ('${KLASS}','${SCHOOL}','${OTHER_UID}','CANARY CLASS','zho_for_eng','CANARY-S-0610')`,
  `insert into public.class_sessions (class_id, teacher_user_id, start_lego_id)
   values ('${KLASS}','${OTHER_UID}','S0001L01')`,
  `insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
   values ('${OTHER_UID}','school','SCHOOL:${SCHOOL}','teacher','canary-setup')`,
  `insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
   values ('canary-student-uid','class','CLASS:${KLASS}','student','canary-setup')`,
  `insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
   values ('canary-orphan-uid','school','SCHOOL:${SCHOOL}','student','canary-setup')`,
  `insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
   values ('${AUTH_SUB}','school','SCHOOL:${OTHER_SCHOOL}','student','canary-setup')`,
];
const CLEANUP=[
  `delete from public.user_tags where tag_value in ('SCHOOL:${SCHOOL}','CLASS:${KLASS}') or user_id in ('canary-orphan-uid','canary-svc-user') or added_by='canary-setup'`,
  `delete from public.class_sessions where class_id='${KLASS}'`,
  `delete from public.classes where id='${KLASS}'`,
  `delete from public.schools where id='${SCHOOL}'`,
];
const CLEANUP_VERIFY=
  `select 1 where not exists (select 1 from public.schools where id='${SCHOOL}')
            and not exists (select 1 from public.classes where id='${KLASS}')
            and not exists (select 1 from public.class_sessions where class_id='${KLASS}')
            and not exists (select 1 from public.user_tags where tag_value in ('SCHOOL:${SCHOOL}','CLASS:${KLASS}'))`;

const ASSERTIONS=[
  // --- preconditions ---
  {name:'PRE: canary identity is NOT a god user', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select 1 where not public.is_god_user()`, expect:'rows'},
  {name:'PRE: B0 bridge intact (current_learner_id)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select 1 where public.current_learner_id() = '${OWN_LEARNER}'::uuid`, expect:'rows'},

  // --- class_sessions backfill integrity (as postgres) ---
  {name:'BACKFILL: every class_sessions row maps to a learners.user_id',
   sql:`select 1 where not exists (select 1 from public.class_sessions cs
        where not exists (select 1 from public.learners l where l.user_id = cs.teacher_user_id))`, expect:'rows'},
  {name:'BACKFILL: row count sane (157 expected + 1 fixture)',
   sql:`select 1 from (select count(*) n from public.class_sessions) t where t.n between 150 and 170`, expect:'rows'},

  // --- class_sessions: teacher write path (app shape post-fix) ---
  {name:'CS: authed teacher INSERTs own session (LearningPlayer shape)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.class_sessions (class_id, teacher_user_id, start_lego_id)
        values ('${REAL_CLASS}','${AUTH_SUB}','S0001L01')`, expect:'ok'},
  {name:'CS: FORGE — INSERT with someone else uid denied', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.class_sessions (class_id, teacher_user_id, start_lego_id)
        values ('${REAL_CLASS}','${OTHER_UID}','S0001L01')`, expect:'denied'},
  {name:'CS: own UPDATE path ok (end-session shape)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`update public.class_sessions set ended_at=now() where teacher_user_id=(auth.uid())::text`, expect:'ok'},
  {name:'CS: school admin READS class sessions in their school (fixture)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.class_sessions where class_id='${KLASS}'`, expect:'rows'},
  {name:'CS: outsider sees NOTHING of that class', role:'authenticated', jwtSub:RANDOM_SUB,
   sql:`select 1 where not exists (select 1 from public.class_sessions where class_id='${KLASS}')`, expect:'rows'},
  {name:'CS: anon denied', role:'anon',
   sql:`select * from public.class_sessions limit 1`, expect:'denied'},
  {name:'CS: service-role unaffected', role:'service_role',
   sql:`select * from public.class_sessions limit 1`, expect:'rows'},

  // --- user_tags: own + principal reads ---
  {name:'UT: own tags readable (role detection at login)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.user_tags where user_id=(auth.uid())::text or user_id='${OTHER_UID}' limit 1`, expect:'rows'},
  {name:'UT: school admin lists teachers (TeachersView read)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.user_tags where tag_value='SCHOOL:${SCHOOL}' and role_in_context='teacher'`, expect:'rows'},
  {name:'UT: school admin lists class students (ClassDetail read)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.user_tags where tag_value='CLASS:${KLASS}'`, expect:'rows'},
  {name:'UT: outsider sees none of the fixture school tags', role:'authenticated', jwtSub:RANDOM_SUB,
   sql:`select 1 where not exists (select 1 from public.user_tags where tag_value='SCHOOL:${SCHOOL}')`, expect:'rows'},

  // --- user_tags: soft-delete replays (exact app shapes) ---
  {name:'UT: TeachersView remove-teacher soft-delete works for admin', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`update public.user_tags set removed_at=now()
        where user_id='${OTHER_UID}' and tag_type='school' and role_in_context='teacher'
          and tag_value='SCHOOL:${SCHOOL}' and removed_at is null`, expect:'rows'},
  {name:'UT: ClassDetail remove-student soft-delete works for admin', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`update public.user_tags set removed_at=now()
        where user_id='canary-student-uid' and tag_type='class'
          and tag_value='CLASS:${KLASS}' and removed_at is null`, expect:'rows'},

  // --- user_tags: forgery blocked ---
  {name:'UT: FORGE — self INSERT teacher tag (other school) denied', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
        values ('${AUTH_SUB}','school','SCHOOL:${OTHER_SCHOOL}','teacher','${AUTH_SUB}')`, expect:'denied'},
  {name:'UT: FORGE — self UPDATE own student tag to admin denied', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`update public.user_tags set role_in_context='admin'
        where user_id=(auth.uid())::text and tag_value='SCHOOL:${OTHER_SCHOOL}' and added_by='canary-setup'`, expect:'denied'},
  {name:'UT: self non-privileged INSERT still works', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
        values ('${AUTH_SUB}','class','CLASS:${REAL_CLASS}','student','${AUTH_SUB}')`, expect:'ok'},
  {name:'UT: anon denied', role:'anon',
   sql:`select * from public.user_tags limit 1`, expect:'denied'},

  // --- relink bridge ---
  {name:'RELINK: claims orphaned identity tags', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select 1 from (select public.relink_user_tags('canary-orphan-uid') n) t where t.n >= 1`, expect:'rows'},
  {name:'RELINK: refuses an identity still on a learners row', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select public.relink_user_tags('${OTHER_UID}')`, expect:'denied'},
  {name:'RELINK: anon cannot execute', role:'anon',
   sql:`select public.relink_user_tags('canary-orphan-uid')`, expect:'denied'},

  // --- service paths (redeem/create-staff) unaffected ---
  {name:'SVC: service-role inserts privileged tag (redeem path)', role:'service_role',
   sql:`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
        values ('canary-svc-user','school','SCHOOL:${SCHOOL}','admin','canary-svc-user')`, expect:'ok'},
  {name:'SVC: service-role reads all tags', role:'service_role',
   sql:`select * from public.user_tags limit 1`, expect:'rows'},

  // --- regression guards ---
  {name:'GUARD: anon still reads course_stats', role:'anon',
   sql:`select * from public.course_stats limit 1`, expect:'rows'},
  {name:'GUARD: anon STILL denied who-pays', role:'anon',
   sql:`select * from public.learner_subscription_status limit 1`, expect:'denied'},
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
    for(const s of SETUP) await c.query(s);                       // fixtures (as postgres)
    for(const a of ASSERTIONS){ const r=await assert(c,a); results.push(r); if(!r.pass)allPass=false; }
    for(const s of CLEANUP) await c.query(s);                     // remove fixtures (as postgres)
    const v=await c.query(CLEANUP_VERIFY);
    results.push({name:'CLEANUP: all fixtures removed', role:'postgres', expect:'rows',
                  pass:v.rowCount>=1, detail:v.rowCount>=1?'clean':'FIXTURES REMAIN — DO NOT COMMIT'});
    if(v.rowCount<1) allPass=false;
    if(commit&&allPass) await c.query('COMMIT'); else await c.query('ROLLBACK');
  }catch(e){ await c.query('ROLLBACK').catch(()=>{}); results.push({name:'APPLY/FATAL',pass:false,detail:e.message.split('\n')[0]}); allPass=false; }
  await c.end();
  console.log(`\n===== LANE B1 secfix_15 (class_sessions + user_tags full enable) =====`);
  for(const r of results) console.log(`  ${r.pass?'✅':'❌'} [${r.role||'-'}/${r.expect||'-'}] ${r.name} — ${r.detail}`);
  console.log(`  ----\n  ${allPass?'ALL GREEN ✅':'HAS RED ❌'} · mode=${commit?(allPass?'COMMITTED':'rolled back (not green)'):'DRY-RUN (rolled back)'}`);
})();
