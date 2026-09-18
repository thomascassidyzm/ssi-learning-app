// Job #203 — BLOCKER 2 live proof of commit 2b462dd1a.
// loadScopedSessionRows() must count a class-account lesson ONCE (diary only),
// dropping the legacy class_sessions row for any class with class_learner_id,
// while a class WITHOUT a class account keeps its legacy row.
import fs from 'node:fs'
const BASE = process.env.BASE || 'https://saysomethingin.app'
const LABEL = process.env.LABEL || 'PRODUCTION'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8').match(/^(?:VITE_)?SUPABASE_ANON_KEY=(.+)$/m)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const q = (p, init) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...init }).then(async r => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } })
const ins = (t, body) => q(t, { method:'POST', headers:{...H, Prefer:'return=representation'}, body: JSON.stringify(body) })
const del = (p) => fetch(`${U}/rest/v1/${p}`, { method:'DELETE', headers:H }).then(r=>r.status)
const link = (email) => fetch(`${U}/auth/v1/admin/generate_link`, { method:'POST', headers:H, body: JSON.stringify({ type:'magiclink', email }) }).then(r=>r.json())
const delUser = (id) => fetch(`${U}/auth/v1/admin/users/${id}`, { method:'DELETE', headers: H }).then(r=>r.status)
const authUser = (id) => fetch(`${U}/auth/v1/admin/users/${id}`, { headers: H }).then(r=>r.status)
const fails = []
const check = (ok, what) => { console.log(`${ok?'PASS':'FAIL'}  ${what}`); if (!ok) fails.push(what) }
const stamp = Date.now().toString().slice(-7)
const rnd = () => Math.random().toString(36).slice(2,8).toUpperCase()

console.log(`BASE=${BASE}  (${LABEL})`)
console.log('version:', await fetch(`${BASE}/version.json`).then(r=>r.text()))

// ── course with real legos, read-only
const COURSE = 'spa_for_eng'
const legos = await q(`course_legos?course_code=eq.${COURSE}&select=lego_id,seed_number,lego_index&order=seed_number.asc,lego_index.asc&limit=6`)
if (!Array.isArray(legos) || legos.length < 5) throw new Error('no legos for '+COURSE+': '+JSON.stringify(legos).slice(0,200))
const L = legos.map(l=>l.lego_id)
console.log('course:', COURSE, 'legos:', L.join(','))

const created = []   // {t: table-or-auth, id, label}
const track = (t,id,label) => { created.push({t,id,label}); return id }

// ── the school admin
const ADM = `zz-203b-adm-${stamp}@ssi-probe.test`
const l1 = await link(ADM)
const v = await fetch(`${U}/auth/v1/verify`, { method:'POST', headers:{ apikey:ANON, 'Content-Type':'application/json' }, body: JSON.stringify({ type:'email', email:ADM, token: l1.email_otp }) }).then(r=>r.json())
if (!v.access_token) throw new Error('admin session failed: '+JSON.stringify(v))
track('auth', v.user.id, ADM)
const [admLearner] = await q(`learners?user_id=eq.${v.user.id}&select=id`)
track('learners', admLearner.id, ADM)
await q(`learners?id=eq.${admLearner.id}`, { method:'PATCH', headers:{...H, Prefer:'return=minimal'}, body: JSON.stringify({ educational_role:'school_admin', display_name:`ZZ203 probe admin ${stamp}` }) })
console.log('admin:', ADM, 'auth', v.user.id, 'learner', admLearner.id)

// ── the school node + school (is_test, so nothing real reads it as a peer)
const [node] = await ins('groups', { name:`ZZ203 Probe School ${stamp}`, type:'school', is_demo:false, is_test:true, name_confirmed:true })
track('groups', node.id, 'school node')
const [school] = await ins('schools', { school_name:`ZZ203 Probe School ${stamp}`, admin_user_id:v.user.id,
  teacher_join_code:`ZZT${rnd()}`, admin_join_code:`ZZA${rnd()}`, node_group_id:node.id, is_demo:false, is_test:true })
track('schools', school.id, 'probe school')
console.log('school:', school.id, 'node', node.id)

// ── the class ACCOUNT learner (class_learner_id) — a class entity, not a person
const [classAcct] = await ins('learners', { user_id:`zz203-class-${stamp}`, display_name:`ZZ203 class account ${stamp}`, is_class_entity:true })
track('learners', classAcct.id, 'class account')

// ── two classes: one WITH a class account (diary), one WITHOUT (legacy control)
const [cDiary] = await ins('classes', { school_id:school.id, group_id:node.id, class_name:`ZZ203 diary ${stamp}`,
  course_code:COURSE, student_join_code:`ZZD${rnd()}`, class_learner_id:classAcct.id, teacher_user_id:v.user.id })
track('classes', cDiary.id, 'diary class')
const [cLegacy] = await ins('classes', { school_id:school.id, group_id:node.id, class_name:`ZZ203 legacy ${stamp}`,
  course_code:COURSE, student_join_code:`ZZL${rnd()}`, class_learner_id:null, teacher_user_id:v.user.id })
track('classes', cLegacy.id, 'legacy class')
console.log('classes: diary', cDiary.id, ' legacy(control)', cLegacy.id)

// ── the DIARY: one lesson, 40 seconds of play-to-last-clip (the test's shape)
const lesson = Date.now() - 3 * 86_400_000
const ev = (dt, type, lego) => ({ learner_id: classAcct.id, course_code: COURSE, event_type: type,
  occurred_at: new Date(lesson + dt).toISOString(), env: 'probe',
  payload: type === 'audio_play' ? { durationMs: 0, legoId: lego } : {} })
const evs = await ins('player_events', [ ev(0,'tap_play',null), ev(10_000,'audio_play',L[0]), ev(20_000,'audio_play',L[2]), ev(40_000,'audio_play',L[4]) ])
check(Array.isArray(evs) && evs.length === 4, `4 diary events written for the class account (40s span)`)
for (const e of evs) track('player_events', e.id, 'diary event')

// ── the RECORDER: a class_sessions row on EACH class, 154 seconds
const [csD] = await ins('class_sessions', { class_id:cDiary.id, teacher_user_id:v.user.id, start_lego_id:L[0], end_lego_id:L[4],
  started_at:new Date(lesson + 10_000).toISOString(), ended_at:new Date(lesson + 164_000).toISOString(), duration_seconds:154, cycles_completed:5 })
track('class_sessions', csD.id, 'diary-class recorder row')
const [csL] = await ins('class_sessions', { class_id:cLegacy.id, teacher_user_id:v.user.id, start_lego_id:L[0], end_lego_id:L[4],
  started_at:new Date(lesson + 10_000).toISOString(), ended_at:new Date(lesson + 164_000).toISOString(), duration_seconds:154, cycles_completed:5 })
track('class_sessions', csL.id, 'legacy-class recorder row')
console.log('recorder rows: 154s on each class')

// ── hit PRODUCTION as the school admin
const call = async (id) => {
  const url = `${BASE}/api/groups/${id}/rate-compare?window=all_time`
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${v.access_token}` } })
  const body = await r.json().catch(()=>null)
  console.log(`   GET ${url} -> ${r.status}  classMinutes=${JSON.stringify(body?.week?.entity?.classMinutes)}`)
  return { status:r.status, body }
}
console.log('\n── the class WITH a class account: the lesson must count ONCE')
const rD = await call(cDiary.id)
check(rD.status === 200, 'diary class: 200 from the production insights endpoint')
const got = rD.body?.week?.entity?.classMinutes
const DIARY_MIN = 40/60, DOUBLE_MIN = (40+154)/60
check(typeof got === 'number' && Math.abs(got - DIARY_MIN) < 0.05,
  `diary class counts ONCE: classMinutes=${got} ≈ ${DIARY_MIN.toFixed(2)} (diary 40s alone), not ${DOUBLE_MIN.toFixed(2)} (40s+154s double count)`)
check(typeof got === 'number' && Math.abs(got - DOUBLE_MIN) > 0.5, 'diary class is NOT the pre-fix double count')

console.log('\n── CONTROL: the class WITHOUT a class account keeps its legacy row')
const rL = await call(cLegacy.id)
check(rL.status === 200, 'control class: 200')
const gotL = rL.body?.week?.entity?.classMinutes
check(typeof gotL === 'number' && Math.abs(gotL - 154/60) < 0.05,
  `control class still counts its legacy class_sessions row: classMinutes=${gotL} ≈ ${(154/60).toFixed(2)}`)

// ── the recorder rows survive (kept for lesson identity, per the decision note)
const keptD = await q(`class_sessions?id=eq.${csD.id}&select=id,duration_seconds`)
check(Array.isArray(keptD) && keptD[0]?.duration_seconds === 154, 'the class_sessions record itself is untouched (kept for lesson identity)')

// ── TEARDOWN, FK order
console.log('\n── TEARDOWN')
const order = ['class_sessions','player_events','classes','schools','groups','learners','auth']
for (const t of order) for (const c of created.filter(x=>x.t===t)) {
  const st = t === 'auth' ? await delUser(c.id) : await del(`${t}?id=eq.${c.id}`)
  console.log(`  del ${t} ${c.id} ${c.label} -> ${st}`)
}
let residue = 0
for (const c of created) {
  if (c.t === 'auth') { if (await authUser(c.id) !== 404) { residue++; console.log('  RESIDUE auth', c.id) } ; continue }
  const r = await q(`${c.t}?id=eq.${c.id}&select=id`)
  if (Array.isArray(r) && r.length) { residue++; console.log('  RESIDUE', c.t, c.id) }
}
console.log(`TEARDOWN: ${created.length} rows created, ${residue} residue. ${residue===0 ? 'DELETION CONFIRMED — probe auth user, learners, school, node, classes, class_sessions and player_events are all gone.' : 'INCOMPLETE'}`)
check(residue === 0, 'teardown clean')
console.log(fails.length ? `\nRED — ${fails.length} check(s) failed:\n  ${fails.join('\n  ')}` : `\nGREEN — on ${LABEL}, a class-account lesson counts once and an account-less class keeps its legacy row`)
process.exitCode = fails.length ? 1 : 0
