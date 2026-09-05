const path=require('path'),fs=require('fs');const DASH='/home/tomcassidy/ssi-dashboard-v7-clean';
require(path.join(DASH,'node_modules','dotenv')).config({path:path.join(DASH,'.env.psql'),quiet:true});
const {Client}=require(path.join(DASH,'node_modules','pg'));
const plan=JSON.parse(fs.readFileSync(DASH+'/docs/pods/hrv-pod0-switchover-applied-2026-08-22.json','utf8'));
(async()=>{const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const {rows:st}=await db.query(`select learner_id,sentence_id from learner_pod_state where course_code='hrv_for_eng'`);
const have=new Set(st.map(r=>r.learner_id+'|'+r.sentence_id));
const c={};
for(const a of plan.actions.filter(x=>x.action==='carry')){
 const tgt=a.to.replace(':pod-0-unrecorded:',':pod-1:');
 const shape=/:s\d+$/.test(tgt)?'split(:sN)':'whole-turn';
 const status=have.has(a.learner_id+'|'+tgt)?'present':'MISSING';
 c[shape+' '+status]=(c[shape+' '+status]||0)+1;}
console.log('hrv 08-22 recorded carries, by key shape and survival:');
Object.entries(c).sort().forEach(([k,v])=>console.log('  '+k.padEnd(24),v));
// same shape breakdown of gle's surviving rows and of what lea heard
const {rows:g}=await db.query(`select count(*) filter (where sentence_id ~ ':s[0-9]+$') split, count(*) filter (where sentence_id !~ ':s[0-9]+$') whole from learner_pod_state where course_code='gle_for_eng' and updated_at < '2026-08-25'`);
console.log('\ngle rows written by the 08-24 flip, by shape:',JSON.stringify(g[0]));
await db.end()})();
