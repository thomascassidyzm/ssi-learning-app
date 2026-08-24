// Pull the whole player_events spine (704k rows) by keyset on id, into a cache file.
// Only the columns the census + per-feature reads need. READ-ONLY.
import fs from 'node:fs'
import { rest } from './_db.mjs'

const OUT = new URL('./_cache-events.jsonl', import.meta.url).pathname
const PAGE = 20000
let last = 0, total = 0
const fh = fs.openSync(OUT, 'w')
for (;;) {
  const { rows } = await rest(`player_events?select=id,occurred_at,event_type,learner_id,user_id,course_code,device_type&order=id.asc&limit=${PAGE}&id=gt.${last}`)
  if (rows.length === 0) break
  for (const r of rows) fs.writeSync(fh, JSON.stringify(r) + '\n')
  total += rows.length
  last = rows[rows.length - 1].id
  process.stderr.write(`\r${total} rows (id<=${last})`)
  if (rows.length < PAGE) break
}
fs.closeSync(fh)
console.error(`\ndone: ${total} rows -> ${OUT}`)
