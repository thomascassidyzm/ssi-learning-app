import { all } from './q.mjs'
const rows = await all('player_events?select=occurred_at,course_code,learner_id,user_id,payload,env&event_type=eq.pod_lap_start&order=occurred_at.asc')
console.error('rows', rows.length)
const by = new Map()
for (const r of rows) {
  const l1 = r.payload?.isLayer1
  const k = r.course_code
  if (!by.has(k)) by.set(k, {l1true:0,l1false:0,l1undef:0,learnersL1:new Set(),guestL1:0,first:null,last:null,maxRound:0})
  const b = by.get(k)
  if (l1 === true) { b.l1true++; if (r.learner_id) b.learnersL1.add(r.learner_id); else b.guestL1++
    b.first = b.first ?? r.occurred_at; b.last = r.occurred_at
    b.maxRound = Math.max(b.maxRound, r.payload?.podRound||0) }
  else if (l1 === false) b.l1false++
  else b.l1undef++
}
const out = [...by.entries()].map(([c,b])=>({course:c,l1_laps:b.l1true,pod_laps:b.l1false,pre_flag:b.l1undef,l1_learners:b.learnersL1.size,l1_guest_laps:b.guestL1,l1_first:b.first,l1_last:b.last,l1_maxRound:b.maxRound}))
out.sort((a,b)=>b.l1_laps-a.l1_laps)
console.log(JSON.stringify(out,null,1))
