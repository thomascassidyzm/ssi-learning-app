import { rest, all } from './q.mjs'
import fs from 'node:fs'
const enroll = JSON.parse(fs.readFileSync(process.env.CS_SCRATCH+'/enroll.json'))
const l1 = JSON.parse(fs.readFileSync(process.env.CS_SCRATCH+'/l1plays.json'))
const courses = new Set([...enroll.map(e=>e.course_id), ...l1.map(r=>r.c)])
const out = {}
for (const c of [...courses].sort()) {
  // first 1500 legos ordered by (seed_number, lego_index) — enough for 30 seeds
  const { data } = await rest(`course_legos?select=seed_number,lego_index&course_code=eq.${c}&order=seed_number.asc,lego_index.asc&limit=1500`)
  if (!data.length) { out[c] = { activation: null, note: 'no course_legos rows' }; continue }
  const lastOrd = new Map(); let ord = 0
  for (const r of data) { ord++; lastOrd.set(r.seed_number, ord) }
  const ords = [...lastOrd.entries()].sort((a,b)=>a[1]-b[1])
  const act = ords.length >= 30 ? ords[29][1] : null
  // total seeds + total legos for context
  const tot = await rest(`course_legos?select=id&course_code=eq.${c}&limit=1`, {count:'exact'})
  out[c] = { activation: act, seed30: ords[29]?.[0] ?? null, seedsInWindow: ords.length, totalLegos: tot.total }
}
fs.writeFileSync(process.env.CS_SCRATCH+'/activation.json', JSON.stringify(out,null,1))
console.table(Object.entries(out).map(([c,v])=>({course:c,...v})))
