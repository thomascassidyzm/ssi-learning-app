const {Client}=require('pg');
const url=require('fs').readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql','utf8').split('\n').find(l=>l.startsWith('DATABASE_URL=')).slice(13).trim();
const REAL=`l.id not in (select * from test_learner_ids())`;
const cohorts={
 sub_active:`select v.learner_id id from learner_subscription_status v join learners l on l.id=v.learner_id where v.is_subscribed and ${REAL}`,
 sub_ever:`select s.learner_id id from subscriptions s join learners l on l.id=s.learner_id where ${REAL}`,
 entitlement_redeemed:`select ue.learner_id id from user_entitlements ue join learners l on l.id=ue.learner_id where ${REAL}`,
 entitlement_unexpired:`select ue.learner_id id from user_entitlements ue join learners l on l.id=ue.learner_id where ${REAL} and (ue.expires_at is null or ue.expires_at>now())`,
 school_tagged:`select l.id from learners l where ${REAL} and exists(select 1 from user_tags ut where ut.user_id=l.user_id and ut.removed_at is null)`,
};
cohorts.entitled_any=`(${cohorts.sub_active}) union (${cohorts.entitlement_unexpired}) union (${cohorts.school_tagged})`;
cohorts.all_real=`select l.id from learners l where ${REAL}`;
const dist=(sub,env)=>`with coh as (${sub}),
 e as (select coalesce(pe.learner_id,pe.user_id) lid, pe.course_code cc from player_events pe where coalesce(pe.learner_id,pe.user_id) in (select id from coh) and pe.course_code is not null ${env==='prod'?"and pe.env='production'":''}),
 ce as (select ce.learner_id lid, ce.course_id cc from course_enrollments ce where ce.learner_id in (select id from coh)),
 x as (select * from e union all select * from ce),
 f as (select x.lid, coalesce(c.target_lang, split_part(x.cc,'_for_',1)) tl from x left join courses c on c.course_code=x.cc),
 per as (select lid, count(distinct tl) n from f group by lid)
 select case when n>=4 then '4+' else n::text end bucket, count(*) learners from per group by 1 order by 1`;
(async()=>{const c=new Client({connectionString:url});await c.connect();
for(const [k,s] of Object.entries(cohorts)){
  const size=(await c.query(`select count(*) n from (select distinct id from (${s}) z) y`)).rows[0].n;
  for(const env of ['prod','all']){
   const r=await c.query(dist(s,env));const t=r.rows.reduce((a,b)=>a+Number(b.learners),0);
   console.log('##',k,'cohort='+size,'env='+env,'withActivity='+t,r.rows.map(v=>`${v.bucket}:${v.learners}`).join(' '));
  }
}
// not-entitled = all_real minus entitled_any
const notEnt=`select l.id from learners l where ${REAL} and l.id not in (select id from (${cohorts.entitled_any}) z)`;
const size=(await c.query(`select count(*) n from (${notEnt}) y`)).rows[0].n;
for(const env of ['prod','all']){const r=await c.query(dist(notEnt,env));const t=r.rows.reduce((a,b)=>a+Number(b.learners),0);
 console.log('##','not_entitled','cohort='+size,'env='+env,'withActivity='+t,r.rows.map(v=>`${v.bucket}:${v.learners}`).join(' '));}
await c.end();})();
