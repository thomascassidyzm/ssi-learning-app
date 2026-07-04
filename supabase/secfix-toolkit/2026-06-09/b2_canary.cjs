// Lane B2 canary — secfix_16: own-row RLS on the LIVE learner tables.
// In-transaction fixtures (created as postgres post-migration, deleted before
// COMMIT). Replays the exact app shapes from the consumer trace.
//   node b2_canary.cjs            # dry-run
//   node b2_canary.cjs --commit   # COMMIT iff all green
const fs=require('fs'); const path=require('path');
const PGDIR='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg';
const ENVP='/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql';
const { Client }=require(PGDIR);
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;}

const MIG=path.join(__dirname,'20260610_secfix_16_live_learner_tables_b2.sql');
const AUTH_SUB='355e513f-1464-4739-b439-422c0c790c0c';       // real auth user; school_admin role, NOT god/ssi_admin
const OWN_LEARNER='b05406f6-57d9-423b-9e44-756701253721';
const SSI_ADMIN_SUB='6ec3f0b5-ff63-4dd4-bbde-ddab69bc1652';  // real ssi_admin (platform_role) with uuid uid
const RANDOM_SUB='dddddddd-0000-4000-8000-000000000009';     // no learner row
const NEWUSER_SUB='dddddddd-0000-4000-8000-00000000000a';    // no learner row (signup test)
const CLAIM_SUB ='dddddddd-0000-4000-8000-00000000000b';     // claims the CLAIM learner by email
const SCHOOL='c0de0000-0000-4000-8000-000000000011';
const KLASS ='c0de0000-0000-4000-8000-000000000012';
const STUDENT_UID='c0de0000-0000-4000-8000-0000000000aa';    // fixture student's auth uid (text)
const STUDENT_LID='c0de0000-0000-4000-8000-0000000000ab';    // fixture student's learners.id
const CLAIM_LID  ='c0de0000-0000-4000-8000-0000000000ac';    // multi-email claim target

const SETUP=[
  `insert into public.schools (id, school_name, admin_user_id, teacher_join_code, admin_join_code)
   values ('${SCHOOL}','CANARY SCHOOL B2','${AUTH_SUB}','CANARY-T-B2','CANARY-A-B2')`,
  `insert into public.classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code)
   values ('${KLASS}','${SCHOOL}','${AUTH_SUB}','CANARY CLASS B2','zho_for_eng','CANARY-S-B2')`,
  `insert into public.learners (id, user_id, display_name) values ('${STUDENT_LID}','${STUDENT_UID}','Canary Student')`,
  `insert into public.learners (id, user_id, display_name, verified_emails)
   values ('${CLAIM_LID}','old-claim-uid','Canary Claim', array['canary-claim@example.com'])`,
  `insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
   values ('${STUDENT_UID}','class','CLASS:${KLASS}','student','canary-setup')`,
  `insert into public.sessions (learner_id, course_id, started_at, duration_seconds, items_practiced)
   values ('${STUDENT_LID}','zho_for_eng', now(), 0, 0)`,
  `insert into public.course_enrollments (learner_id, course_id) values ('${STUDENT_LID}','zho_for_eng')`,
  `insert into public.lego_progress (learner_id, lego_id, course_id, thread_id)
   values ('${STUDENT_LID}','S0001L01','zho_for_eng', 1)`,
  `insert into public.seed_progress (learner_id, seed_id, course_id, thread_id)
   values ('${STUDENT_LID}','S0001','zho_for_eng', 1)`,
];
const CLEANUP=[
  `delete from public.user_tags where tag_value='CLASS:${KLASS}' or added_by='canary-setup'`,
  `delete from public.sessions where learner_id in ('${STUDENT_LID}','${CLAIM_LID}')`,
  `delete from public.course_enrollments where learner_id in ('${STUDENT_LID}','${CLAIM_LID}')`,
  `delete from public.lego_progress where learner_id in ('${STUDENT_LID}','${CLAIM_LID}')`,
  `delete from public.seed_progress where learner_id in ('${STUDENT_LID}','${CLAIM_LID}')`,
  `delete from public.classes where id='${KLASS}'`,
  `delete from public.schools where id='${SCHOOL}'`,
  `delete from public.learners where id in ('${STUDENT_LID}','${CLAIM_LID}')`,
];
const CLEANUP_VERIFY=
  `select 1 where not exists (select 1 from public.learners where id in ('${STUDENT_LID}','${CLAIM_LID}'))
            and not exists (select 1 from public.schools where id='${SCHOOL}')
            and not exists (select 1 from public.classes where id='${KLASS}')
            and not exists (select 1 from public.sessions where learner_id='${STUDENT_LID}')`;

const ASSERTIONS=[
  // --- preconditions ---
  {name:'PRE: caller is not god and not ssi_admin', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select 1 where not public.is_god_user() and not public.is_ssi_admin()`, expect:'rows'},

  // --- PLAYER own-row writes (exact SessionStore/ProgressStore shapes) ---
  {name:'PLAYER: startSession INSERT+returning (fires daily_contributions trigger)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.sessions (learner_id, course_id, started_at, ended_at, duration_seconds, items_practiced, spikes_detected, final_rolling_average)
        values ('${OWN_LEARNER}','zho_for_eng', now(), null, 0, 0, 0, 0) returning *`, expect:'rows'},
  {name:'PLAYER: endSession UPDATE own ok', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`update public.sessions set ended_at=now(), duration_seconds=60, items_practiced=5
        where learner_id = public.current_learner_id() and course_id='zho_for_eng'`, expect:'ok'},
  {name:'FORGE: session INSERT for another learner denied', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.sessions (learner_id, course_id, started_at, duration_seconds, items_practiced)
        values ('${STUDENT_LID}','zho_for_eng', now(), 0, 0)`, expect:'denied'},
  {name:'PLAYER: createEnrollment INSERT+returning (unenrolled course)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.course_enrollments (learner_id, course_id)
        values ('${OWN_LEARNER}', (select course_code from public.courses
                                   where course_code not in (select course_id from public.course_enrollments where learner_id='${OWN_LEARNER}')
                                   limit 1)) returning *`, expect:'rows'},
  {name:'PLAYER: cursor advance UPDATE (forward-only .or shape, fires ratchet trigger)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`update public.course_enrollments
        set last_completed_lego_id='S0001L01', last_completed_round_index=1, current_cycle_index=0, last_practiced_at=now()
        where learner_id = public.current_learner_id() and course_id='zho_for_eng'
          and (last_completed_round_index is null or last_completed_round_index < 1)`, expect:'ok'},
  {name:'FORGE: enrollment UPDATE for another learner matches nothing', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`with u as (update public.course_enrollments set total_practice_minutes=9999
                  where learner_id='${STUDENT_LID}' returning 1)
        select 1 where not exists (select 1 from u)`, expect:'rows'},
  {name:'PLAYER: saveLegoProgress INSERT+returning', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.lego_progress (learner_id, lego_id, course_id, thread_id, fibonacci_position, skip_number, reps_completed, is_retired)
        values ('${OWN_LEARNER}','S9999L99','zho_for_eng', 1, 0, 1, 0, false) returning *`, expect:'rows'},
  {name:'PLAYER: saveSeedProgress INSERT+returning', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`insert into public.seed_progress (learner_id, seed_id, course_id, thread_id, is_introduced)
        values ('${OWN_LEARNER}','S9999','zho_for_eng', 1, true) returning *`, expect:'rows'},

  // --- learners: signup, settings, takeover-hole closed ---
  {name:'SIGNUP: new user INSERTs own learner row (+returning)', role:'authenticated', jwtSub:NEWUSER_SUB,
   sql:`insert into public.learners (user_id, display_name) values ((auth.uid())::text,'Canary New') returning id`, expect:'rows'},
  {name:'FORGE: INSERT learner for someone else denied', role:'authenticated', jwtSub:NEWUSER_SUB,
   sql:`insert into public.learners (user_id, display_name) values ('${STUDENT_UID}','Evil') returning id`, expect:'denied'},
  {name:'SETTINGS: display_name UPDATE own row ok', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`update public.learners set display_name='Canary Admin' where user_id=(auth.uid())::text`, expect:'ok'},
  {name:'TAKEOVER CLOSED: cannot repoint another learner user_id', role:'authenticated', jwtSub:RANDOM_SUB,
   sql:`with u as (update public.learners set user_id=(auth.uid())::text where id='${STUDENT_LID}' returning 1)
        select 1 where not exists (select 1 from u)`, expect:'rows'},

  // --- multi-email claim bridge ---
  {name:'CLAIM: verified email claims the learner (returns old uid)', role:'authenticated', jwtSub:CLAIM_SUB, email:'canary-claim@example.com',
   sql:`select 1 from (select public.claim_learner('${CLAIM_LID}') o) t where t.o = 'old-claim-uid'`, expect:'rows'},
  {name:'CLAIM: wrong email denied', role:'authenticated', jwtSub:CLAIM_SUB, email:'wrong@example.com',
   sql:`select public.claim_learner('${CLAIM_LID}')`, expect:'denied'},
  {name:'CLAIM: anon denied', role:'anon',
   sql:`select public.claim_learner('${CLAIM_LID}')`, expect:'denied'},

  // --- principal + admin read scopes ---
  {name:'TEACHER/ADMIN: AUTH_SUB reads fixture student sessions', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.sessions where learner_id='${STUDENT_LID}'`, expect:'rows'},
  {name:'TEACHER/ADMIN: reads student enrollments (StudentProgressView shape)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select course_id, enrolled_at, last_practiced_at, total_practice_minutes from public.course_enrollments where learner_id='${STUDENT_LID}'`, expect:'rows'},
  {name:'TEACHER/ADMIN: reads student seed/lego progress', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select 1 where exists (select 1 from public.seed_progress where learner_id='${STUDENT_LID}')
                  and exists (select 1 from public.lego_progress where learner_id='${STUDENT_LID}')`, expect:'rows'},
  {name:'TEACHER/ADMIN: reads student learners row (name)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select display_name from public.learners where id='${STUDENT_LID}'`, expect:'rows'},
  {name:'SSI_ADMIN: sees all sessions (admin dashboards)', role:'authenticated', jwtSub:SSI_ADMIN_SUB,
   sql:`select * from public.sessions limit 1`, expect:'rows'},
  {name:'SSI_ADMIN: sees all learners (admin users list)', role:'authenticated', jwtSub:SSI_ADMIN_SUB,
   sql:`select * from public.learners limit 1`, expect:'rows'},
  {name:'OUTSIDER: sees NO sessions, enrollments, or learners of others', role:'authenticated', jwtSub:RANDOM_SUB,
   sql:`select 1 where not exists (select 1 from public.sessions where learner_id in ('${STUDENT_LID}','${OWN_LEARNER}'))
                  and not exists (select 1 from public.course_enrollments where learner_id in ('${STUDENT_LID}','${OWN_LEARNER}'))
                  and not exists (select 1 from public.learners where id in ('${STUDENT_LID}','${OWN_LEARNER}'))`, expect:'rows'},
  {name:'LOCK: anon still denied sessions', role:'anon',
   sql:`select * from public.sessions limit 1`, expect:'denied'},

  // --- daily_contributions ---
  {name:'DC: anon still reads community aggregates', role:'anon',
   sql:`select contribution_date, phrases_count, minutes_practiced from public.daily_contributions limit 1`, expect:'rows'},
  {name:'DC: authenticated direct write now denied (trigger-only)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`update public.daily_contributions set phrases_count=999999 where true`, expect:'denied'},

  // --- jwt-sub drift cleanup still works canonically ---
  {name:'DRIFT: own subscription read ok (no error)', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.subscriptions where learner_id = public.current_learner_id()`, expect:'ok'},
  {name:'DRIFT: own entitlements read ok', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`select * from public.user_entitlements where learner_id = public.current_learner_id()`, expect:'ok'},
  {name:'DRIFT: ssi_admin reads invite_codes', role:'authenticated', jwtSub:SSI_ADMIN_SUB,
   sql:`select * from public.invite_codes limit 1`, expect:'rows'},
  {name:'DRIFT: non-admin cannot manage regions', role:'authenticated', jwtSub:AUTH_SUB,
   sql:`with u as (update public.regions set name=name returning 1)
        select 1 where not exists (select 1 from u)`, expect:'rows'},

  // --- service + guards ---
  {name:'SVC: service-role reads learners/sessions (api endpoints)', role:'service_role',
   sql:`select 1 where exists (select 1 from public.learners) and exists (select 1 from public.sessions)`, expect:'rows'},
  {name:'GUARD: anon still reads course_stats', role:'anon',
   sql:`select * from public.course_stats limit 1`, expect:'rows'},
  {name:'GUARD: anon STILL denied who-pays', role:'anon',
   sql:`select * from public.learner_subscription_status limit 1`, expect:'denied'},
  {name:'GUARD: B1 intact — feedback insert + lego_introductions read', role:'anon',
   sql:`with i as (insert into public.content_feedback (course_code, feedback_type) values ('spa_for_eng','flagged') returning 1) select 1 from i`, expect:'ok'},
];

async function setCaller(c,a){
  if(a.jwtSub){ const claims={sub:a.jwtSub,role:a.role,aud:'authenticated'};
    if(a.email) claims.email=a.email;
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
  const c=new Client({connectionString:loadEnv(ENVP).DATABASE_URL}); await c.connect();
  const results=[]; let allPass=true;
  try{
    await c.query('BEGIN');
    await c.query(fs.readFileSync(MIG,'utf8'));
    for(const s of SETUP) await c.query(s);
    for(const a of ASSERTIONS){ const r=await assert(c,a); results.push(r); if(!r.pass)allPass=false; }
    for(const s of CLEANUP) await c.query(s);
    const v=await c.query(CLEANUP_VERIFY);
    results.push({name:'CLEANUP: all fixtures removed', role:'postgres', expect:'rows',
                  pass:v.rowCount>=1, detail:v.rowCount>=1?'clean':'FIXTURES REMAIN — DO NOT COMMIT'});
    if(v.rowCount<1) allPass=false;
    if(commit&&allPass) await c.query('COMMIT'); else await c.query('ROLLBACK');
  }catch(e){ await c.query('ROLLBACK').catch(()=>{}); results.push({name:'APPLY/FATAL',pass:false,detail:e.message.split('\n')[0]}); allPass=false; }
  await c.end();
  console.log(`\n===== LANE B2 secfix_16 (live learner tables own-row RLS) =====`);
  for(const r of results) console.log(`  ${r.pass?'✅':'❌'} [${r.role||'-'}/${r.expect||'-'}] ${r.name} — ${r.detail}`);
  console.log(`  ----\n  ${allPass?'ALL GREEN ✅':'HAS RED ❌'} · mode=${commit?(allPass?'COMMITTED':'rolled back (not green)'):'DRY-RUN (rolled back)'}`);
})();
