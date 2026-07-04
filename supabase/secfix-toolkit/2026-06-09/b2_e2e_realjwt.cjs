// B2 end-to-end with a REAL JWT: create a synthetic auth user via the admin
// API, sign in for a real token, replay the player's PostgREST calls, assert
// scoping, then clean up. Closes the simulated-claims gap.
const fs=require('fs');
function loadEnv(p){const o={};try{for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'');}}catch{} return o;}
const env={...loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env'),
           ...loadEnv('/Users/tomcassidy/SSi/ssi-learning-app/.env'),
           ...loadEnv('/Users/tomcassidy/SSi/ssi-learning-app/.env.local')};
const URL=env.VITE_SUPABASE_URL||env.SUPABASE_URL;
const ANON=env.VITE_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY;
const SVC=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_KEY;
const EMAIL='canary-e2e-b2@example.com', PASS='CanaryE2E!2026x';
const OTHER_LEARNER='b05406f6-57d9-423b-9e44-756701253721';
const results=[]; const ok=(n,p,d)=>{results.push({n,p,d});};

async function req(method, path, key, token, body, prefer){
  const r=await fetch(URL+path,{method,headers:{
    apikey:key, Authorization:`Bearer ${token||key}`,
    'Content-Type':'application/json', ...(prefer?{Prefer:prefer}:{})},
    body:body?JSON.stringify(body):undefined});
  let j=null; try{j=await r.json();}catch{}
  return {status:r.status, body:j};
}

(async()=>{
  let uid=null, lid=null;
  try{
    // 0. clean any prior leftover user
    const prior=await req('GET',`/auth/v1/admin/users?page=1&per_page=200`,SVC);
    const old=(prior.body?.users||[]).find(u=>u.email===EMAIL);
    if(old){ await req('DELETE',`/auth/v1/admin/users/${old.id}`,SVC); }
    await req('DELETE',`/rest/v1/learners?display_name=eq.Canary%20E2E`,SVC,null,null,'return=minimal');

    // 1. create + sign in
    const cu=await req('POST','/auth/v1/admin/users',SVC,null,{email:EMAIL,password:PASS,email_confirm:true});
    uid=cu.body?.id; ok('create auth user', !!uid, `status ${cu.status}`);
    const si=await req('POST','/auth/v1/token?grant_type=password',ANON,null,{email:EMAIL,password:PASS});
    const tok=si.body?.access_token; ok('sign in (real JWT)', !!tok, `status ${si.status}`);

    // 2. signup: an auth.users trigger auto-creates the learners row (discovered
    //    here — explains why authenticated never had a table INSERT grant). Verify
    //    the row exists and is visible with the real JWT; the client INSERT
    //    fallback should now 409 (conflict), not 401.
    const lr=await req('GET',`/rest/v1/learners?user_id=eq.${uid}&select=id`,ANON,tok);
    lid=lr.body?.[0]?.id;
    ok('signup: auth-trigger learner row exists + visible w/ own JWT', lr.status===200&&!!lid, `status ${lr.status} n=${lr.body?.length}`);
    const li=await req('POST','/rest/v1/learners',ANON,tok,{user_id:uid,display_name:'Canary E2E'},'return=representation');
    ok('signup: client INSERT fallback conflicts (409), not permission-denied', li.status===409, `status ${li.status}`);

    // 3. player: session INSERT + returning (fires daily_contributions trigger)
    const se=await req('POST','/rest/v1/sessions',ANON,tok,
      {learner_id:lid,course_id:'zho_for_eng',started_at:new Date().toISOString(),duration_seconds:0,items_practiced:0},'return=representation');
    ok('player: session INSERT w/ returning + trigger', se.status===201, `status ${se.status} ${JSON.stringify(se.body).slice(0,80)}`);

    // 4. own reads work
    const rs=await req('GET',`/rest/v1/sessions?learner_id=eq.${lid}&select=id`,ANON,tok);
    ok('own sessions readable', rs.status===200&&Array.isArray(rs.body)&&rs.body.length===1, `status ${rs.status} n=${rs.body?.length}`);

    // 5. SCOPING: other learners' data invisible with a real JWT
    const ro=await req('GET',`/rest/v1/sessions?learner_id=eq.${OTHER_LEARNER}&select=id&limit=1`,ANON,tok);
    ok('other learner sessions INVISIBLE', ro.status===200&&ro.body?.length===0, `status ${ro.status} n=${ro.body?.length}`);
    const rl=await req('GET',`/rest/v1/learners?select=id`,ANON,tok);
    ok('learners list = own row only', rl.status===200&&rl.body?.length===1, `status ${rl.status} n=${rl.body?.length}`);

    // 6. settings: own display_name PATCH
    const up=await req('PATCH',`/rest/v1/learners?user_id=eq.${uid}`,ANON,tok,{display_name:'Canary E2E 2'},'return=minimal');
    ok('own display_name PATCH', up.status===204, `status ${up.status}`);

    // 7. takeover: PATCH another learner's user_id -> must hit 0 rows
    const tk=await req('PATCH',`/rest/v1/learners?id=eq.${OTHER_LEARNER}`,ANON,tok,{display_name:'pwn'},'return=representation');
    ok('cannot touch another learner', tk.status===200&&tk.body?.length===0 || tk.status===404, `status ${tk.status} n=${tk.body?.length??'-'}`);
  } finally {
    // cleanup: learner row (cascades sessions) + auth user
    if(uid) await req('DELETE',`/rest/v1/learners?user_id=eq.${uid}`,SVC,null,null,'return=minimal');
    if(uid) await req('DELETE',`/auth/v1/admin/users/${uid}`,SVC);
    const chk=await req('GET',`/rest/v1/learners?or=(display_name.like.Canary%20E2E*,user_id.eq.${uid})&select=id`,SVC);
    ok('cleanup: synthetic user + learner removed', chk.status===200&&chk.body?.length===0, `remaining=${chk.body?.length}`);
  }
  console.log('\n===== B2 REAL-JWT END-TO-END =====');
  let all=true; for(const r of results){ if(!r.p)all=false; console.log(`  ${r.p?'✅':'❌'} ${r.n} — ${r.d}`);}
  console.log(`  ----\n  ${all?'ALL GREEN ✅':'HAS RED ❌'}`);
})();
