#!/usr/bin/env node
/**
 * One-off, job #758 (Tom's addition 2026-09-15 00:16Z): after the teacher-play sweep applied,
 * tell each school leader, in plain English, what was copied for their classes. The five
 * teachers already hold the sweep's own notice with one-tap Undo and get nothing more.
 * Idempotent on dedupe_key. Same env as tools/copy-teacher-play-sweep.mjs.
 *   node --experimental-strip-types --import ./tools/ts-extension-resolver.mjs tools/leader-notice-teacher-play-sweep-2026-09-15.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { sendUserMessage } from '../api/_utils/userMessages.ts'

const url = (process.env.SUPABASE_URL || '').trim(), key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1) }
const svc = createClient(url, key)

const NOTICES = [
  { leader: 'angharadjones (Angharad), Ysgol Cas-gwent Chepstow School', schoolId: '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255', recipientUserId: '96105179-6598-4f2b-9281-a1d28270581b',
    title: '11E and 11H now show where each class actually is',
    body: 'We noticed a couple of your teachers had been practising signed in as themselves rather than as their class, so the class looked as if it had not started. We have copied that practice across to the class accounts for 11E and 11H, so the dashboards now show where each class actually is. Each teacher has a note in their inbox with an Undo if they would rather we had not. Nothing else has changed.' },
  { leader: 'Miss Morris, Ysgol Gyfun Tredegar', schoolId: '468d8132-c1ff-4e0d-8cf8-8ee786d60c95', recipientUserId: 'e6296a68-b157-4889-b147-716e8c5accbb',
    title: '10R now shows where the class actually is',
    body: 'We noticed Miss Smith had been practising signed in as herself rather than as her class, so 10R looked as if it had not started. We have copied that practice across to the class account for 10R, so the dashboard now shows where the class actually is. Miss Smith has a note in her inbox with an Undo if she would rather we had not. Nothing else has changed.' },
  { leader: 'hughesr310, Ysgol Gyfun Tredegar', schoolId: '1389a525-e04a-45d3-a718-9403ea2e48e1', recipientUserId: '1e94f8ac-b9c3-4094-8c22-605cb433a5f0',
    title: 'SR now shows where the class actually is',
    body: 'We noticed Mrs Ruttley had been practising signed in as herself rather than as her class, so SR looked as if it had not started. We have copied that practice across to the class account for SR, so the dashboard now shows where the class actually is. Mrs Ruttley has a note in her inbox with an Undo if she would rather we had not. Nothing else has changed.' },
  { leader: 'Anna Aggleton, Ysgol Gyfun Trefynwy / Monmouth Comprehensive School', schoolId: '5ec6cb90-f25c-4bc9-9e63-b4a93317737b', recipientUserId: '1220e7e9-af78-486e-826b-77fdca29b675',
    title: '7GSN now shows where the class actually is',
    body: 'We noticed Mr Snelgrove had been practising signed in as himself rather than as his class, so 7GSN looked as if it had not started. We have copied that practice across to the class account for 7GSN, so the dashboard now shows where the class actually is. Mr Snelgrove has a note in his inbox with an Undo if he would rather we had not. Nothing else has changed.' },
]

for (const n of NOTICES) {
  const r = await sendUserMessage(svc, { recipientUserId: n.recipientUserId, source: 'class_play_copied', title: n.title, body: n.body,
    dedupeKey: `leader_notice:copy-teacher-play-sweep-2026-09-14:${n.schoolId}` })
  console.log(`${r.sent ? 'sent' : 'not sent'}  ${n.leader}  ${r.id || ''} ${r.error || (r.sent ? '' : '(dedupe: already there)')}`)
}
