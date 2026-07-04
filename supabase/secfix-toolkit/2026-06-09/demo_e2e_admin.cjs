// Demo-suite e2e: sign in as the Irish demo school admin with a REAL JWT and
// replay the schools dashboard's exact read shapes through live PostgREST.
const fs=require('fs');
function loadEnv(p){const o={};try{for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}}catch{} return o;}
const env={...loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env'),
           ...loadEnv('/Users/tomcassidy/SSi/ssi-learning-app/.env'),
           ...loadEnv('/Users/tomcassidy/SSi/ssi-learning-app/.env.local')};
const BASE=env.VITE_SUPABASE_URL||env.SUPABASE_URL;
const ANON=env.VITE_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY;
const results=[]; const ok=(n,p,d)=>results.push({n,p,d});
async function req(p, tok){
  const r=await fetch(BASE+p,{headers:{apikey:ANON,Authorization:`Bearer ${tok}`}});
  let j=null; try{j=await r.json();}catch{}
  return {status:r.status, body:j};
}
(async()=>{
  const si=await fetch(BASE+'/auth/v1/token?grant_type=password',{method:'POST',
    headers:{apikey:ANON,'Content-Type':'application/json'},
    body:JSON.stringify({email:'thomas.cassidy+demo.irish.admin@gmail.com',password:'SSiDemo2026!'})});
  const tok=(await si.json()).access_token;
  ok('sign in as Irish demo admin (real JWT)', !!tok, si.status);

  const sch=await req(`/rest/v1/schools?school_name=eq.Gaelscoil%20na%20Mara&select=id,school_name,is_demo`,tok);
  const schoolId=sch.body?.[0]?.id;
  ok('sees own school', !!schoolId, `n=${sch.body?.length}`);

  const cls=await req(`/rest/v1/classes?school_id=eq.${schoolId}&select=id,class_name`,tok);
  ok('sees 3 classes', cls.body?.length===3, `n=${cls.body?.length}`);
  const classId=cls.body?.[0]?.id;

  const teach=await req(`/rest/v1/user_tags?tag_value=eq.SCHOOL:${schoolId}&role_in_context=eq.teacher&select=user_id`,tok);
  ok('TeachersView: sees 2 teachers via RLS', teach.body?.length===2, `n=${teach.body?.length}`);

  const students=await req(`/rest/v1/user_tags?tag_value=eq.CLASS:${classId}&select=user_id`,tok);
  ok('ClassDetail: sees class students via RLS', students.body?.length>=20, `n=${students.body?.length}`);

  const suid=students.body?.[0]?.user_id;
  const lr=await req(`/rest/v1/learners?user_id=eq.${suid}&select=id,display_name`,tok);
  const lid=lr.body?.[0]?.id;
  ok('sees student learner row (name)', !!lid, lr.body?.[0]?.display_name||'-');

  const enr=await req(`/rest/v1/course_enrollments?learner_id=eq.${lid}&select=course_id,total_practice_minutes,last_completed_lego_id`,tok);
  ok('StudentProgress: sees student enrollment cursor', enr.body?.length===1, JSON.stringify(enr.body?.[0]||{}).slice(0,90));

  const sp=await req(`/rest/v1/seed_progress?learner_id=eq.${lid}&is_introduced=eq.true&select=course_id`,tok);
  ok('StudentProgress: sees student seeds', sp.body?.length>=1, `seeds=${sp.body?.length}`);

  const ses=await req(`/rest/v1/sessions?learner_id=eq.${lid}&select=started_at,duration_seconds&limit=5`,tok);
  ok('Analytics: sees student sessions', ses.body?.length>=1, `n=${ses.body?.length}`);

  const cs=await req(`/rest/v1/class_sessions?class_id=eq.${classId}&select=started_at,cycles_completed&limit=5`,tok);
  ok('Class activity: sees class_sessions', cs.body?.length>=1, `n=${cs.body?.length}`);

  // scoping: the demo admin must NOT see real learners' data
  const real=await req(`/rest/v1/sessions?learner_id=eq.b05406f6-57d9-423b-9e44-756701253721&select=id&limit=1`,tok);
  ok('CANNOT see real learners sessions', real.status===200&&real.body?.length===0, `n=${real.body?.length}`);
  const reall=await req(`/rest/v1/learners?id=eq.b05406f6-57d9-423b-9e44-756701253721&select=id`,tok);
  ok('CANNOT see real learners row', reall.status===200&&reall.body?.length===0, `n=${reall.body?.length}`);

  console.log('\n===== DEMO SUITE E2E (Irish admin, real JWT) =====');
  let all=true; for(const r of results){ if(!r.p)all=false; console.log(`  ${r.p?'✅':'❌'} ${r.n} — ${r.d}`);}
  console.log(`  ----\n  ${all?'ALL GREEN ✅':'HAS RED ❌'}`);
})();
