// Pull the supporting tables for the active-population definition and per-feature reads.
import fs from 'node:fs'
import { rest, all } from './_db.mjs'

const dir = new URL('.', import.meta.url).pathname
const save = (name, rows) => { fs.writeFileSync(dir + name, JSON.stringify(rows)); console.log(name, rows.length) }

save('_cache-learners.json', await all('learners',
  'id,user_id,display_name,created_at,educational_role,platform_role,is_demo,is_internal,is_class_entity,preferences,dashboard_courses,welcome_played_at,invite_code_id'))
save('_cache-sessions.json', await all('sessions',
  'id,learner_id,course_id,started_at,ended_at,duration_seconds,items_practiced'))
save('_cache-enrollments.json', await all('course_enrollments', '*'))
save('_cache-metrics.json', (await rest('learner_lego_metrics?select=*&limit=10000')).rows)
save('_cache-grants.json', (await rest('entitlement_grants?select=*')).rows)
save('_cache-invites.json', (await rest('invite_codes?select=*')).rows)
