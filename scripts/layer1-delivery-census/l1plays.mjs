import { all } from './q.mjs'
import fs from 'node:fs'
const rows = await all('player_events?select=occurred_at,course_code,learner_id,user_id,session_id,payload,env&event_type=eq.audio_play&payload->>stage=eq.0&order=occurred_at.asc', 1000)
console.error('L1 plays', rows.length)
fs.writeFileSync(process.env.CS_SCRATCH+'/l1plays.json', JSON.stringify(rows.map(r=>({t:r.occurred_at,c:r.course_code,l:r.learner_id,s:r.session_id,pr:r.payload?.podRound,si:r.payload?.sentenceIdx,role:r.payload?.role,env:r.env}))))
console.error('written')
