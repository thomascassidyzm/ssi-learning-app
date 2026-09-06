import fs from 'node:fs'
const S=process.env.CS_SCRATCH
const act=JSON.parse(fs.readFileSync(S+'/activation.json'))
const enroll=JSON.parse(fs.readFileSync(S+'/enroll.json'))
const learners=JSON.parse(fs.readFileSync(S+'/learners.json'))
const l1=JSON.parse(fs.readFileSync(S+'/l1plays.json'))
const rc=JSON.parse(fs.readFileSync(S+'/rc.json'))
const L=new Map(learners.map(l=>[l.id,l]))
const name=id=>{const l=L.get(id);if(!l)return 'learner:'+id.slice(0,8);return (l.verified_emails?.[0]||l.display_name||id.slice(0,8))}
const isTest=id=>{const l=L.get(id); if(!l) return false; const e=(l.verified_emails?.[0]||'')+' '+(l.display_name||''); return l.is_demo||/ssi-internal\.test|e2e-|@example\.|^test-|@invite\.saysomethingin\.app/i.test(e)}
// L1 ship date: earliest L1 play at/above its course activation
let ship=null
for(const r of l1){const A=act[r.c]?.activation; if(A&&r.pr>=A&&(!ship||r.t<ship))ship=r.t}
console.error('L1 ship marker (earliest at-or-above-activation play):',ship)
const SHIP=ship
// per (course,learner): rounds completed at/above activation since SHIP
const eligPlay=new Map()
for(const r of rc){const A=act[r.c]?.activation; if(!A||r.ri==null)continue; if(r.ri<A)continue; if(r.t<SHIP)continue
  const k=r.c+'|'+r.l; const o=eligPlay.get(k)||{n:0,first:r.t,last:r.t,minR:r.ri,maxR:r.ri}; o.n++;o.last=r.t;o.minR=Math.min(o.minR,r.ri);o.maxR=Math.max(o.maxR,r.ri);eligPlay.set(k,o)}
// observed L1 at/above activation
const obs=new Map(); const guest=new Map(); const cheat=new Map()
for(const r of l1){const A=act[r.c]?.activation
  if(!r.l){guest.set(r.c,(guest.get(r.c)||0)+1);continue}
  const k=r.c+'|'+r.l; const o=obs.get(k)||{real:0,cheat:0,laps:new Set(),minR:1e9,maxR:0,last:null}
  if(A&&r.pr>=A){o.real++;o.laps.add(r.s+'|'+r.pr);o.minR=Math.min(o.minR,r.pr);o.maxR=Math.max(o.maxR,r.pr);o.last=r.t}
  else {o.cheat++; cheat.set(r.c,(cheat.get(r.c)||0)+1)}
  obs.set(k,o)}
const pos=new Map(); for(const e of enroll) pos.set(e.course_id+'|'+e.learner_id,e)
const courses=new Map()
const addc=(c,l)=>{if(!courses.has(c))courses.set(c,new Set());courses.get(c).add(l)}
for(const e of enroll) if(!isTest(e.learner_id)) addc(e.course_id,e.learner_id)
for(const r of l1) if(r.l&&!isTest(r.l)) addc(r.c,r.l)
const rows=[]
for(const [c,set] of courses){
  const A=act[c]?.activation
  const people=[...set].map(l=>{
    const e=pos.get(c+'|'+l)||{}
    const round=Math.max(e.highest_completed_round_index??0,e.last_completed_round_index??0)
    const o=obs.get(c+'|'+l)||{real:0,cheat:0,laps:new Set(),maxR:0,minR:0,last:null}
    const ep=eligPlay.get(c+'|'+l)
    return {l,name:name(l),round,last:(e.last_practiced_at||'').slice(0,10),real:o.real,cheat:o.cheat,laps:o.laps.size,minR:o.minR===1e9?0:o.minR,maxR:o.maxR,l1last:(o.last||'').slice(0,10),eligPlayed:ep?ep.n:0,eligWindow:ep?`${ep.minR}-${ep.maxR} to ${ep.last.slice(0,10)}`:''}
  }).sort((a,b)=>b.round-a.round)
  const delivering=people.filter(p=>p.real>0)
  const provenActive=people.filter(p=>p.eligPlayed>0)
  const furthest=people[0]
  let verdict,cause=''
  if(!A){verdict='CANNOT TELL';cause='course catalogue has <30 seeds — the rule can never activate'}
  else if(delivering.length>0) verdict='DELIVERING'
  else if(provenActive.length>0){verdict='NOT DELIVERING';cause='cause undetermined'}
  else {verdict='CANNOT TELL'; cause = people.some(p=>p.round>=A)
    ? `no learner has completed a round at/above ${A} since Layer-1 shipped (${SHIP.slice(0,10)}) — high-water marks predate it`
    : `furthest learner is at round ${furthest?.round??0}, ${A-(furthest?.round??0)} short of activation ${A}`}
  rows.push({course:c,activation:A,learners:people.length,verdict,cause,furthest:furthest?`${furthest.name} @${furthest.round}`:'-',
    delivering:delivering.map(p=>`${p.name} rounds ${p.minR}-${p.maxR}, ${p.laps} cups / ${p.real} plays, last ${p.l1last}`),
    silentActive:people.filter(p=>p.real===0&&p.eligPlayed>0).map(p=>`${p.name} @${p.round}: ${p.eligPlayed} rounds completed at ${p.eligWindow}, 0 L1 plays`),
    guestPlays:guest.get(c)||0, cheatPlays:cheat.get(c)||0, people})
}
const order={'DELIVERING':0,'NOT DELIVERING':1,'CANNOT TELL':2}
rows.sort((a,b)=>order[a.verdict]-order[b.verdict]||(b.activation||0)-(a.activation||0))
fs.writeFileSync(S+'/final.json',JSON.stringify(rows,null,1))
console.table(rows.map(r=>({course:r.course,act:r.activation,people:r.learners,verdict:r.verdict,deliv:r.delivering.length,silentActive:r.silentActive.length,guest:r.guestPlays,cheat:r.cheatPlays})))
