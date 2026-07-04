// THE SACK — delete all legacy demo/test data, single transaction, commit only
// if every invariant holds. Backup already taken (SSi-demo-sack-backup-2026-06-10).
//   node demo_sack.cjs            # dry-run
//   node demo_sack.cjs --commit   # COMMIT iff all green
const fs=require('fs');
const { Client }=require('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg');
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;}
const UUID_RE=`'^[0-9a-f]{8}-'`;

const STEPS=[
  ['learners fake/clerk/null (cascades sessions, enrollments, lego/seed_progress, ...)',
   `delete from public.learners where user_id is null or user_id !~ ${UUID_RE}`],
  ['govt_admins (fake ids)',
   `delete from public.govt_admins where user_id !~ ${UUID_RE}`],
  ['null surviving refs to org-linked invite codes (keepers redeemed demo codes)',
   `update public.learners set invite_code_id=null where invite_code_id in
      (select id from public.invite_codes where grants_school_id is not null or grants_class_id is not null or grants_group_id is not null)`],
  ['null govt_admin refs to org-linked invite codes',
   `update public.govt_admins set invite_code_id=null where invite_code_id in
      (select id from public.invite_codes where grants_school_id is not null or grants_class_id is not null or grants_group_id is not null)`],
  ['invite_codes (org-linked join codes)',
   `delete from public.invite_codes where grants_school_id is not null or grants_class_id is not null or grants_group_id is not null`],
  ['user_tags (all — every tag is fake-user or sacked-org)',
   `delete from public.user_tags`],
  ['classes (cascades class_sessions, class entitlement_grants)',
   `delete from public.classes`],
  ['schools (cascades school entitlement_grants)',
   `delete from public.schools`],
  ['groups',
   `delete from public.groups`],
  ['daily_contributions re-baseline from surviving sessions',
   `delete from public.daily_contributions`],
  ['daily_contributions rebuild',
   `insert into public.daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
    select split_part(s.course_id,'_for_',1), s.started_at::date,
           coalesce(sum(s.items_practiced),0), coalesce(sum(s.duration_seconds),0)/60, count(distinct s.learner_id)
    from public.sessions s
    where not exists (select 1 from public.learners ld where ld.id=s.learner_id and ld.is_demo)
    group by 1,2`],
];

const INVARIANTS=[
  ['ZERO fake-id learners remain',
   `select 1 from (select count(*) n from public.learners where user_id is null or user_id !~ ${UUID_RE}) t where t.n=0`],
  ['real learners survive (>=123 incl gods + Tom test accts)',
   `select 1 from (select count(*) n from public.learners) t where t.n >= 123`],
  ['known keepers intact (b05406f6 + 6 god users)',
   `select 1 where exists (select 1 from public.learners where id='b05406f6-57d9-423b-9e44-756701253721')
             and (select count(*) from public.learners where educational_role='god') = 6`],
  ['every surviving session belongs to a real-uuid learner',
   `select 1 from (select count(*) n from public.sessions s where not exists
     (select 1 from public.learners l where l.id=s.learner_id and l.user_id ~ ${UUID_RE})) t where t.n=0`],
  ['org tables empty (schools/classes/groups/user_tags/class_sessions)',
   `select 1 from (select (select count(*) from public.schools)+(select count(*) from public.classes)
     +(select count(*) from public.groups)+(select count(*) from public.user_tags)
     +(select count(*) from public.class_sessions) n) t where t.n=0`],
  ['9 unlinked invite codes + 1 real govt_admin kept',
   `select 1 where (select count(*) from public.invite_codes)=9 and (select count(*) from public.govt_admins)=1`],
  ['entitlement_grants cascaded away',
   `select 1 from (select count(*) n from public.entitlement_grants) t where t.n=0`],
  ['daily_contributions rebuilt: >0 days, total below pre-sack 720705 phrases',
   `select 1 from (select count(*) d, coalesce(sum(phrases_count),0) p from public.daily_contributions) t where t.d>0 and t.p>0 and t.p<720705`],
  ['content untouched (courses + seeds still there)',
   `select 1 where (select count(*) from public.courses)>20 and (select count(*) from public.course_seeds limit 1 offset 0)>=0
             and exists (select 1 from public.course_seeds)`],
  ['frozen-progress tables now ~empty (were ~100% demo)',
   `select 1 from (select (select count(*) from public.lego_progress)+(select count(*) from public.seed_progress) n) t where t.n < 5000`],
];

(async()=>{
  const commit=process.argv.includes('--commit');
  const c=new Client({connectionString:loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql').DATABASE_URL});
  await c.connect();
  const results=[]; let allPass=true;
  try{
    await c.query('BEGIN');
    for(const [name,sql] of STEPS){
      const r=await c.query(sql);
      results.push({name:`STEP: ${name}`, pass:true, detail:`${r.rowCount??0} rows`});
    }
    for(const [name,sql] of INVARIANTS){
      let pass=false, detail='';
      try{ const r=await c.query(sql); pass=r.rowCount>=1; detail=pass?'holds':'VIOLATED'; }
      catch(e){ detail='ERR: '+e.message.split('\n')[0]; }
      results.push({name:`INVARIANT: ${name}`, pass, detail});
      if(!pass) allPass=false;
    }
    if(commit&&allPass) await c.query('COMMIT'); else await c.query('ROLLBACK');
  }catch(e){ await c.query('ROLLBACK').catch(()=>{}); results.push({name:'FATAL',pass:false,detail:e.message.split('\n')[0]}); allPass=false; }
  await c.end();
  console.log(`\n===== THE SACK (legacy demo/test data) =====`);
  for(const r of results) console.log(`  ${r.pass?'✅':'❌'} ${r.name} — ${r.detail}`);
  console.log(`  ----\n  ${allPass?'ALL GREEN ✅':'HAS RED ❌'} · mode=${commit?(allPass?'COMMITTED':'rolled back'):'DRY-RUN (rolled back)'}`);
})();
