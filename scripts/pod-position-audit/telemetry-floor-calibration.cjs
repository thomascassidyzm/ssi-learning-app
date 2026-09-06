const path=require('path'),fs=require('fs');const DASH='/home/tomcassidy/ssi-dashboard-v7-clean';
require(path.join(DASH,'node_modules','dotenv')).config({path:path.join(DASH,'.env.psql'),quiet:true});
const {Client}=require(path.join(DASH,'node_modules','pg'));
const plan=JSON.parse(fs.readFileSync(DASH+'/docs/pods/hrv-pod0-switchover-applied-2026-08-22.json','utf8'));
(async()=>{const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const {rows:ln}=await db.query(`select id,display_name from learners`);const nm=new Map(ln.map(r=>[r.id,r.display_name]));
// rows actually held at 08-22, per learner (carry+drop = every row in the table then)
const held={};for(const a of plan.actions){const k=a.learner_id;held[k]=held[k]||{carry:0,drop:0};held[k][a.action]++}
// distinct sentences heard, ledger era, up to 08-22
const {rows:tel}=await db.query(`
 select pe.user_id, count(distinct(pe.payload->>'sentenceIdx')) idx_all,
   count(distinct(pe.payload->>'sentenceIdx')) filter (where pe.occurred_at>='2026-07-05') idx_ledger
 from player_events pe where pe.event_type='audio_play' and pe.payload->>'cycleType'='pod_play'
  and pe.payload ? 'sentenceIdx' and pe.course_code='hrv_for_eng' and pe.occurred_at<'2026-08-22'
 group by 1`);
const t=new Map(tel.map(r=>[r.user_id,r]));
const out=Object.entries(held).map(([id,h])=>({learner:nm.get(id)||id.slice(0,8),
  rows_held_0822:h.carry+h.drop, carried:h.carry, dropped:h.drop,
  distinct_heard_alltime:t.get(id)?.idx_all??0, distinct_heard_ledger:t.get(id)?.idx_ledger??0}));
console.table(out.sort((a,b)=>b.rows_held_0822-a.rows_held_0822));
await db.end()})();
