const {Client}=require('pg');
const url=require('fs').readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql','utf8').split('\n').find(l=>l.startsWith('DATABASE_URL=')).slice(13).trim();
// strict cut on EVENT VOLUME (enrolment depth columns are barely written)
function q({thr, win, env, excludeTest}){
  const w=[`coalesce(pe.learner_id,pe.user_id) is not null`,`pe.course_code is not null`];
  if(win==='90d') w.push(`pe.occurred_at >= now() - interval '90 days'`);
  if(env==='prod') w.push(`pe.env='production'`);
  if(excludeTest) w.push(`coalesce(pe.learner_id,pe.user_id) not in (select * from test_learner_ids())`);
  return `with e as (select coalesce(pe.learner_id,pe.user_id) lid, pe.course_code cc, count(*) n from player_events pe where ${w.join(' and ')} group by 1,2),
  k as (select lid, cc from e where n>=${thr}),
  f as (select k.lid, coalesce(c.target_lang, split_part(k.cc,'_for_',1)) tl from k left join courses c on c.course_code=k.cc),
  per as (select lid, count(distinct tl) n from f group by lid)
  select case when n>=4 then '4+' else n::text end bucket, count(*) learners from per group by 1 order by 1`;
}
const cs=[];
for(const win of ['all','90d']) for(const thr of [1,50,200]) for(const env of ['prod','all']) for(const ex of [true,false]) cs.push({win,thr,env,excludeTest:ex});
(async()=>{const c=new Client({connectionString:url});await c.connect();
for(const x of cs){const r=await c.query(q(x));const t=r.rows.reduce((a,b)=>a+Number(b.learners),0);
console.log('##',`win=${x.win} events>=${x.thr} env=${x.env} test=${x.excludeTest?'excl':'incl'}`,'N='+t,r.rows.map(v=>`${v.bucket}:${v.learners}`).join(' '));}
await c.end();})();
