#!/usr/bin/env node
/**
 * SSi DEMO DATA SUITE GENERATOR
 * =============================
 * Builds realistic, RLS-correct school demo scenarios (Irish / Japanese /
 * Welsh) and is fully idempotent: every run RESETS all is_demo data first,
 * then regenerates. Sack-and-rebuild any which way, any time.
 *
 *   node scripts/demo-data/generate-demo-suite.cjs            # reset + generate
 *   node scripts/demo-data/generate-demo-suite.cjs --reset-only
 *
 * DONE PROPERLY (vs the old 2026-02 demo data):
 *  - Staff (admins/teachers) are REAL Supabase auth users -> dashboards
 *    populate through the real RLS policies, and you can log in live as the
 *    demo teacher/admin (email OTP to the + addresses below, or password
 *    via API). Students get uuid-shaped synthetic identities (no auth user
 *    needed — they never log in; visibility maps via learners.user_id).
 *  - Progress lives in BOTH models consistently: the live cursor
 *    (course_enrollments) AND the count tables dashboards read
 *    (seed_progress / lego_progress).
 *  - Everything carries is_demo=true -> excluded from every global
 *    aggregate (daily_contributions trigger, weekly_leaderboard,
 *    get_community_contribution) per migration 20260610_feat_17.
 *  - Engagement follows the Russell-2024 shape: ~20% high / 50% mid / 30%
 *    low, with activity recency to match (sparklines look real).
 *
 * Credentials are written to ~/Desktop/SSi-demo-credentials-<date>.md
 * (never committed).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

// ---------- env ----------
function loadEnv(p){const o={};try{for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch{}return o}
const env = {
  ...loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env'),
  ...loadEnv(path.join(__dirname, '../../.env')),
  ...loadEnv(path.join(__dirname, '../../.env.local')),
  ...loadEnv('/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql'),
}
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const SVC = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
const DATABASE_URL = env.DATABASE_URL
const { Client } = require(fs.existsSync(path.join(__dirname,'../../node_modules/pg')) ? 'pg' : '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/node_modules/pg')

const STAFF_PASSWORD = 'SSiDemo2026!'
const EMAIL_BASE = 'thomas.cassidy'   // gmail plus-addressing: OTP codes land in Tom's inbox
const emailFor = (scenario, role) => `${EMAIL_BASE}+demo.${scenario}.${role}@gmail.com`

// ---------- seeded PRNG (reproducible suites) ----------
let seed = 20260610
function rnd(){ seed|=0; seed=(seed+0x6D2B79F5)|0; let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296 }
const pick=a=>a[Math.floor(rnd()*a.length)]
const between=(lo,hi)=>lo+Math.floor(rnd()*(hi-lo+1))
const uuid=()=>{const h='0123456789abcdef';let s='';for(let i=0;i<36;i++){if(i===8||i===13||i===18||i===23)s+='-';else if(i===14)s+='4';else if(i===19)s+=h[8+Math.floor(rnd()*4)];else s+=h[Math.floor(rnd()*16)]}return s}

// ---------- scenarios ----------
const IRISH_FIRST=['Aoife','Cian','Saoirse','Oisín','Niamh','Fionn','Caoimhe','Darragh','Róisín','Tadhg','Clodagh','Eoin','Aisling','Cathal','Méabh','Rónán','Sadhbh','Donncha','Laoise','Páidí','Gráinne','Lorcán','Bláthnaid','Séamus','Éabha','Colm']
const IRISH_LAST=['Ní Bhriain','Ó Sé','Ní Cheallaigh','Ó Murchú','Ní Dhomhnaill','Ó Conaill','Ní Mháille','Ó Riain','Ní Ghallchóir','Ó Flaithearta','Nic Gearailt','Ó Dálaigh']
const JP_STUDENT_FIRST=['Oliver','Sophie','Harry','Isla','Jack','Emily','Noah','Ava','Leo','Mia','Ethan','Grace','Lucas','Chloe','Max','Lily','Daniel','Zoe','Ben','Ella','Sam','Ruby','Alex','Freya']
const JP_STUDENT_LAST=['Bennett','Clarke','Davies','Foster','Greene','Harper','Knight','Lawson','Mercer','Norris','Palmer','Quinn']
const WELSH_FIRST=['Gwen','Rhys','Cerys','Dylan','Ffion','Owain','Seren','Ieuan','Lowri','Macsen','Nia','Tomos','Elin','Gethin','Mali','Osian','Catrin','Llŷr','Beca','Iolo','Anwen','Deio','Heledd','Gruff']
const WELSH_LAST=['Williams','Jones','Evans','Davies','Thomas','Roberts','Hughes','Morgan','Owen','Price','Rees','Griffiths']

const SCENARIOS=[
  {
    key:'irish', courseCode:'gle_for_eng',
    group:{ name:'Gaelscoileanna Píolótach' },
    school:{ name:'Gaelscoil na Mara', region:'ireland' },
    admin:{ name:'Síle Ní Bhriain' },
    teachers:[{ name:'Aoife Ní Cheallaigh' },{ name:'Pádraig Ó Sé' }],
    classes:[
      { name:'Rang a Trí',     teacher:0, students:24, classSeed:14 },
      { name:'Rang a Ceathair',teacher:1, students:23, classSeed:9  },
      { name:'Rang a Cúig',    teacher:0, students:25, classSeed:21 },
    ],
    names:[IRISH_FIRST, IRISH_LAST],
  },
  {
    key:'japanese', courseCode:'jpn_for_eng',
    group:null,
    school:{ name:'Sakura International School', region:'japan' },
    admin:{ name:'Yuki Tanaka' },
    teachers:[{ name:'Kenji Sato' },{ name:'Hana Yamamoto' }],
    classes:[
      { name:'Year 7 Blue', teacher:0, students:22, classSeed:11 },
      { name:'Year 8 Red',  teacher:1, students:24, classSeed:17 },
    ],
    names:[JP_STUDENT_FIRST, JP_STUDENT_LAST],
  },
  {
    key:'welsh', courseCode:'cym_n_for_eng',
    group:null,
    school:{ name:'Ysgol Gynradd y Garn', region:'wales' },
    admin:{ name:'Eleri Williams' },
    teachers:[{ name:'Gareth Jones' },{ name:'Mari Evans' }],
    classes:[
      { name:'Blwyddyn 5', teacher:0, students:26, classSeed:13 },
      { name:'Blwyddyn 6', teacher:1, students:24, classSeed:19 },
    ],
    names:[WELSH_FIRST, WELSH_LAST],
  },
]

// engagement distribution (Russell 2024: engagement > aptitude; majority modest)
function studentStage(classSeed){
  const r=rnd()
  if(r<0.20) return { seeds: between(Math.max(classSeed,8), classSeed+18), sessions: between(18,36), recencyDays: between(0,2)  }  // high
  if(r<0.70) return { seeds: between(Math.max(3,classSeed-6), classSeed+3), sessions: between(7,17),  recencyDays: between(1,6)  }  // mid
  return        { seeds: between(1, Math.max(2,Math.floor(classSeed/2))),   sessions: between(2,6),   recencyDays: between(7,21) }  // low
}

// ---------- auth admin helpers ----------
async function authReq(method, p, body){
  const r=await fetch(SUPABASE_URL+p,{method,headers:{apikey:SVC,Authorization:`Bearer ${SVC}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
  let j=null;try{j=await r.json()}catch{}
  return {status:r.status, body:j}
}
async function ensureAuthUser(email){
  const cu=await authReq('POST','/auth/v1/admin/users',{email,password:STAFF_PASSWORD,email_confirm:true})
  if(cu.body?.id) return cu.body.id
  // exists -> find it
  const ls=await authReq('GET','/auth/v1/admin/users?page=1&per_page=1000')
  const u=(ls.body?.users||[]).find(x=>x.email===email)
  if(!u) throw new Error(`auth user neither created nor found: ${email} (${cu.status})`)
  return u.id
}
async function deleteDemoAuthUsers(){
  const ls=await authReq('GET','/auth/v1/admin/users?page=1&per_page=1000')
  const demos=(ls.body?.users||[]).filter(u=>u.email&&u.email.includes('+demo.'))
  for(const u of demos) await authReq('DELETE',`/auth/v1/admin/users/${u.id}`)
  return demos.length
}

// ---------- main ----------
;(async()=>{
  if(!SUPABASE_URL||!SVC||!DATABASE_URL){ console.error('missing env (SUPABASE_URL / service key / DATABASE_URL)'); process.exit(1) }
  const resetOnly=process.argv.includes('--reset-only')
  const db=new Client({connectionString:DATABASE_URL}); await db.connect()
  const q=(sql,params)=>db.query(sql,params)

  // ---- RESET: wipe every trace of is_demo data, then demo auth users ----
  console.log('— RESET is_demo data —')
  await q('begin')
  const r1=await q(`delete from public.user_tags where added_by='demo-suite'`)
  const r2=await q(`delete from public.classes where school_id in (select id from public.schools where is_demo)`)
  const r3=await q(`delete from public.schools where is_demo`)
  const r4=await q(`delete from public.groups where is_demo`)
  const r5=await q(`delete from public.learners where is_demo`)
  await q('commit')
  const nAuth=await deleteDemoAuthUsers()
  console.log(`  tags:${r1.rowCount} classes:${r2.rowCount} schools:${r3.rowCount} groups:${r4.rowCount} learners:${r5.rowCount} authUsers:${nAuth}`)
  if(resetOnly){ await db.end(); console.log('reset-only done'); return }

  const creds=[`# SSi demo suite credentials — generated ${new Date().toISOString().slice(0,10)}`,
               `Password for ALL staff (API/password login): ${STAFF_PASSWORD}`,
               `App login: email OTP — codes arrive at ${EMAIL_BASE}@gmail.com via + addressing.`,'']
  let totals={students:0,sessions:0,seedRows:0,legoRows:0,classSessions:0}

  for(const sc of SCENARIOS){
    console.log(`\n— SCENARIO: ${sc.key} (${sc.courseCode}) —`)
    // staff auth users (trigger auto-creates learners rows)
    const adminEmail=emailFor(sc.key,'admin')
    const adminUid=await ensureAuthUser(adminEmail)
    const teacherUids=[]
    for(let i=0;i<sc.teachers.length;i++){
      teacherUids.push(await ensureAuthUser(emailFor(sc.key,`teacher${i+1}`)))
    }
    creds.push(`## ${sc.school.name} (${sc.courseCode})`,
               `- school admin: ${sc.admin.name} — ${adminEmail}`,
               ...sc.teachers.map((t,i)=>`- teacher: ${t.name} — ${emailFor(sc.key,`teacher${i+1}`)}`),'')

    await q('begin')
    // upgrade the trigger-created staff learners rows
    await q(`update public.learners set display_name=$1, educational_role='school_admin', is_demo=true where user_id=$2`,[sc.admin.name,adminUid])
    for(let i=0;i<teacherUids.length;i++)
      await q(`update public.learners set display_name=$1, educational_role='teacher', is_demo=true where user_id=$2`,[sc.teachers[i].name,teacherUids[i]])

    // org
    let groupId=null
    if(sc.group){
      groupId=uuid()
      await q(`insert into public.groups (id, name, is_demo) values ($1,$2,true)`,[groupId,sc.group.name])
    }
    const schoolId=uuid()
    await q(`insert into public.schools (id, school_name, admin_user_id, region_code, teacher_join_code, admin_join_code, group_id, is_demo)
             values ($1,$2,$3,$4,$5,$6,$7,true)`,
      [schoolId, sc.school.name, adminUid, sc.school.region, `DEMO-${sc.key.toUpperCase().slice(0,2)}-T`, `DEMO-${sc.key.toUpperCase().slice(0,2)}-A`, groupId])
    await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'admin','demo-suite')`,
      [adminUid,`SCHOOL:${schoolId}`])
    for(const t of teacherUids)
      await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'school',$2,'teacher','demo-suite')`,
        [t,`SCHOOL:${schoolId}`])

    const now=Date.now(), DAY=86400000
    const termStart=new Date('2026-04-20T08:00:00Z').getTime()

    for(let ci=0;ci<sc.classes.length;ci++){
      const cls=sc.classes[ci]
      const classId=uuid()
      const teacherUid=teacherUids[cls.teacher]
      const classLego=`S${String(cls.classSeed).padStart(4,'0')}L0${between(1,3)}`
      await q(`insert into public.classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, last_lego_id, is_active)
               values ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [classId,schoolId,teacherUid,cls.name,sc.courseCode,`DEMO-${sc.key.toUpperCase().slice(0,2)}-${ci+3}`,cls.classSeed,classLego])

      // class-play history: teacher-led sessions over the past month
      const nCs=between(6,14)
      for(let k=0;k<nCs;k++){
        const st=new Date(now-between(0,30)*DAY-between(0,6)*3600000)
        const dur=between(900,2100)
        await q(`insert into public.class_sessions (class_id, teacher_user_id, start_lego_id, end_lego_id, started_at, ended_at, cycles_completed, duration_seconds)
                 values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [classId,teacherUid,`S${String(Math.max(1,cls.classSeed-2)).padStart(4,'0')}L01`,classLego,st.toISOString(),new Date(st.getTime()+dur*1000).toISOString(),Math.floor(dur/11),dur])
        totals.classSessions++
      }

      // students
      for(let si=0;si<cls.students;si++){
        const name=`${pick(sc.names[0])} ${pick(sc.names[1])}`
        const lid=uuid(), suid=uuid()
        const stage=studentStage(cls.classSeed)
        const lastPracticed=new Date(now-stage.recencyDays*DAY-between(0,8)*3600000)
        await q(`insert into public.learners (id, user_id, display_name, educational_role, is_demo, created_at)
                 values ($1,$2,$3,'student',true,$4)`,
          [lid,suid,name,new Date(termStart).toISOString()])
        await q(`insert into public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by) values ($1,'class',$2,'student','demo-suite')`,
          [suid,`CLASS:${classId}`])

        // cursor model (the LIVE progress the player uses)
        const seeds=stage.seeds
        const lastLego=`S${String(seeds).padStart(4,'0')}L0${between(1,4)}`
        const minutes=Math.round(seeds*between(9,15))
        await q(`insert into public.course_enrollments
                 (learner_id, course_id, enrolled_at, last_practiced_at, total_practice_minutes,
                  last_completed_lego_id, highest_completed_lego_id, highest_completed_seed,
                  last_completed_round_index, highest_completed_round_index, current_cycle_index, welcome_played)
                 values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$8,0,true)`,
          [lid,sc.courseCode,new Date(termStart+between(0,3)*DAY).toISOString(),lastPracticed.toISOString(),minutes,lastLego,seeds,seeds*3])

        // count model (what schools dashboards COUNT)
        const seedRows=[], legoRows=[]
        for(let s=1;s<=seeds;s++){
          const sid=`S${String(s).padStart(4,'0')}`
          const introducedAt=new Date(termStart+((lastPracticed.getTime()-termStart)*(s/seeds))).toISOString()
          seedRows.push([lid,sid,sc.courseCode,(s%3)+1,true,introducedAt])
          const nLegos=between(3,4)
          for(let g=1;g<=nLegos;g++)
            legoRows.push([lid,`${sid}L${String(g).padStart(2,'0')}`,sc.courseCode,(s%3)+1,between(2,8),between(1,13),between(2,12),s<seeds-4,introducedAt])
        }
        for(let i=0;i<seedRows.length;i+=200){
          const chunk=seedRows.slice(i,i+200)
          const vals=chunk.map((_,j)=>`($${j*6+1},$${j*6+2},$${j*6+3},$${j*6+4},$${j*6+5},$${j*6+6})`).join(',')
          await q(`insert into public.seed_progress (learner_id, seed_id, course_id, thread_id, is_introduced, introduced_at) values ${vals}`,chunk.flat())
        }
        for(let i=0;i<legoRows.length;i+=150){
          const chunk=legoRows.slice(i,i+150)
          const vals=chunk.map((_,j)=>`($${j*9+1},$${j*9+2},$${j*9+3},$${j*9+4},$${j*9+5},$${j*9+6},$${j*9+7},$${j*9+8},$${j*9+9})`).join(',')
          await q(`insert into public.lego_progress (learner_id, lego_id, course_id, thread_id, fibonacci_position, skip_number, reps_completed, is_retired, last_practiced_at) values ${vals}`,chunk.flat())
        }
        totals.seedRows+=seedRows.length; totals.legoRows+=legoRows.length

        // session history (is_demo -> daily_contributions trigger skips these)
        const span=Math.max(1,lastPracticed.getTime()-termStart)
        for(let k=0;k<stage.sessions;k++){
          const st=new Date(termStart+rnd()*span)
          const dur=between(480,1500)
          const items=Math.floor(dur/60*between(4,6))
          await q(`insert into public.sessions (learner_id, course_id, started_at, ended_at, duration_seconds, items_practiced, points_earned)
                   values ($1,$2,$3,$4,$5,$6,$6)`,
            [lid,sc.courseCode,st.toISOString(),new Date(st.getTime()+dur*1000).toISOString(),dur,items])
        }
        totals.sessions+=stage.sessions; totals.students++
      }
      console.log(`  class ${cls.name}: ${cls.students} students`)
    }
    await q('commit')
  }
  await db.end()

  const credPath=path.join(os.homedir(),'Desktop',`SSi-demo-credentials-${new Date().toISOString().slice(0,10)}.md`)
  fs.writeFileSync(credPath,creds.join('\n'))
  console.log(`\nDONE: ${totals.students} students, ${totals.sessions} sessions, ${totals.seedRows} seed rows, ${totals.legoRows} lego rows, ${totals.classSessions} class sessions`)
  console.log(`credentials -> ${credPath}`)
})().catch(e=>{ console.error('FATAL:',e.message); process.exit(1) })
