import { rest } from './q.mjs'
import fs from 'node:fs'
const rows=JSON.parse(fs.readFileSync(process.env.CS_SCRATCH+'/census.json'))
const out={}
for(const r of rows){
  const c=r.course
  const tot=await rest(`course_seeds?select=seed_number&course_code=eq.${c}&limit=1`,{count:'exact'})
  const wt=await rest(`course_seeds?select=seed_number&course_code=eq.${c}&target1_audio_id=not.is.null&limit=1`,{count:'exact'})
  const wk=await rest(`course_seeds?select=seed_number&course_code=eq.${c}&known_audio_id=not.is.null&limit=1`,{count:'exact'})
  const bk=await rest(`course_audio?select=role&course_code=eq.${c}&role=in.(bookend_listen_intro,bookend_listen_outro)&limit=1`,{count:'exact'})
  out[c]={seeds:tot.total,withTarget:wt.total,withKnown:wk.total,bookends:bk.total}
}
fs.writeFileSync(process.env.CS_SCRATCH+'/audio.json',JSON.stringify(out,null,1))
console.table(Object.entries(out).map(([c,v])=>({course:c,...v})))
