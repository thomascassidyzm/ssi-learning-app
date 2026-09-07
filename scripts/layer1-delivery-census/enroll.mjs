import { all } from './q.mjs'
import fs from 'node:fs'
const e = await all('course_enrollments?select=learner_id,course_id,last_completed_round_index,highest_completed_round_index,last_completed_lego_id,highest_completed_lego_id,highest_completed_seed,last_practiced_at,completed_pod_rounds')
console.error('enrollments', e.length)
const l = await all('learners?select=id,user_id,display_name,verified_emails,is_demo,is_internal,created_at')
console.error('learners', l.length)
fs.writeFileSync(process.env.CS_SCRATCH+'/enroll.json', JSON.stringify(e))
fs.writeFileSync(process.env.CS_SCRATCH+'/learners.json', JSON.stringify(l))
