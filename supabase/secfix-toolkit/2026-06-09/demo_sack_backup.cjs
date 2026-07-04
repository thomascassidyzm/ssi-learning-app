// Backup every row the demo-data sack will delete, to JSON files.
// Read-only. Restore = re-insert from these files.
const fs=require('fs'); const path=require('path');
const { Client }=require('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg');
function loadEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}return o;}
const OUT='/Users/tomcassidy/Desktop/SSi-demo-sack-backup-2026-06-10';
const SACK_LEARNERS=`(select id from public.learners where user_id is null or user_id !~ '^[0-9a-f]{8}-')`;

const DUMPS={
  learners:            `select * from public.learners where id in ${SACK_LEARNERS}`,
  sessions:            `select * from public.sessions where learner_id in ${SACK_LEARNERS}`,
  course_enrollments:  `select * from public.course_enrollments where learner_id in ${SACK_LEARNERS}`,
  lego_progress:       `select * from public.lego_progress where learner_id in ${SACK_LEARNERS}`,
  seed_progress:       `select * from public.seed_progress where learner_id in ${SACK_LEARNERS}`,
  learner_emails:      `select * from public.learner_emails where learner_id in ${SACK_LEARNERS}`,
  subscriptions:       `select * from public.subscriptions where learner_id in ${SACK_LEARNERS}`,
  user_entitlements:   `select * from public.user_entitlements where learner_id in ${SACK_LEARNERS}`,
  teachers:            `select * from public.teachers where learner_id in ${SACK_LEARNERS}`,
  learner_speaking_opportunities: `select * from public.learner_speaking_opportunities where learner_id in ${SACK_LEARNERS}`,
  learner_lego_metrics:`select * from public.learner_lego_metrics where learner_id in ${SACK_LEARNERS}`,
  learner_lego_pairings:`select * from public.learner_lego_pairings where learner_id in ${SACK_LEARNERS}`,
  learner_l1_state:    `select * from public.learner_l1_state where learner_id in ${SACK_LEARNERS}`,
  user_tags:           `select * from public.user_tags`,
  schools:             `select * from public.schools`,
  classes:             `select * from public.classes`,
  groups:              `select * from public.groups`,
  class_sessions:      `select * from public.class_sessions`,
  govt_admins_fake:    `select * from public.govt_admins where user_id !~ '^[0-9a-f]{8}-'`,
  invite_codes_orglinked: `select * from public.invite_codes where grants_school_id is not null or grants_class_id is not null or grants_group_id is not null`,
  entitlement_grants:  `select * from public.entitlement_grants`,
  daily_contributions: `select * from public.daily_contributions`,
};

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const c=new Client({connectionString:loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql').DATABASE_URL});
  await c.connect();
  await c.query('begin transaction isolation level repeatable read read only');
  let total=0;
  for(const [name,sql] of Object.entries(DUMPS)){
    const r=await c.query(sql);
    fs.writeFileSync(path.join(OUT,`${name}.json`), JSON.stringify(r.rows));
    console.log(`  ${name}: ${r.rowCount} rows`);
    total+=r.rowCount;
  }
  await c.query('rollback'); await c.end();
  console.log(`TOTAL: ${total} rows -> ${OUT}`);
})();
