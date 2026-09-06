const path=require('path');const DASH='/home/tomcassidy/ssi-dashboard-v7-clean';
require(path.join(DASH,'node_modules','dotenv')).config({path:path.join(DASH,'.env.psql'),quiet:true});
const {Client}=require(path.join(DASH,'node_modules','pg'));
const SIX=['gle_for_eng','hrv_for_eng','nld_for_eng','hin_for_eng','fra_ca_for_eng','deu_at_for_eng','deu_for_eng','swe_for_eng'];
const CTRL=['cym_s_for_eng','cym_n_for_eng','ell_for_eng','swa_for_eng','ukr_for_eng','lav_for_eng','cat_for_eng','hye_for_eng','dan_for_eng','tur_for_eng','nor_for_eng','tha_for_eng','heb_for_eng'];
const SQL=`
 select pe.course_code, l.display_name,
  count(distinct (pe.payload->>'sentenceIdx')) filter (where pe.occurred_at<'2026-08-24 08:30:00+00') idx_pre,
  count(distinct (pe.payload->>'sentenceIdx')) filter (where pe.occurred_at>='2026-08-24 08:30:00+00') idx_post,
  (select count(*) from learner_pod_state s where s.learner_id=pe.user_id and s.course_code=pe.course_code) rows_today,
  (select coalesce(sum(exposures),0) from learner_pod_state s where s.learner_id=pe.user_id and s.course_code=pe.course_code) exp_today,
  max(pe.occurred_at)::date last_heard
 from player_events pe join learners l on l.id=pe.user_id
 where pe.event_type='audio_play' and pe.payload->>'cycleType'='pod_play' and pe.payload ? 'sentenceIdx'
   and pe.occurred_at >= '2026-07-05' and pe.course_code=any($1)
 group by 1,2,pe.user_id having count(distinct (pe.payload->>'sentenceIdx'))>1 order by 1, idx_pre desc nulls last`;
(async()=>{const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const q=async(l,s,p)=>{const r=await db.query(s,p);console.log('\n##',l);console.table(r.rows.slice(0,100))};
await q('LEDGER-ERA FLOOR — the six + gates',SQL,[SIX]);
await q('LEDGER-ERA FLOOR — control (never flipped 08-24)',SQL,[CTRL]);
await db.end()})();
