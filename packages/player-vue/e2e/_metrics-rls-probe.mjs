// Diagnostic probe: can a real learner's JWT actually write learner_lego_metrics?
// Isolates the DB/RLS layer from the client-side VAD chain. Cleans up after itself.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const TESTER = 'thomas.cassidy+bumface@gmail.com'
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()

const svc = createClient(SB_URL, serviceKey)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: TESTER })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const { data: learner } = await svc.from('learners').select('id').eq('user_id', v.session.user.id).maybeSingle()
console.log('learner_id =', learner?.id)

const asLearner = createClient(SB_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${v.session.access_token}` } },
})

const PROBE_LEGO = 'S9999L99'
const PROBE_COURSE = 'rls_probe'

// 1. SELECT (hydrate path)
const sel = await asLearner.from('learner_lego_metrics').select('*').eq('learner_id', learner.id)
console.log('SELECT ->', sel.error ? `ERROR ${sel.error.code}: ${sel.error.message}` : `ok, ${sel.data.length} rows`)

// 2. mastery upsert (exactly LegoMetricsStore.upsertMany's payload shape)
const up = await asLearner.from('learner_lego_metrics').upsert([{
  learner_id: learner.id,
  lego_id: PROBE_LEGO,
  course_code: PROBE_COURSE,
  mastery_state: 'acquisition',
  consecutive_smooth: 0,
  consecutive_fast: 0,
  n_samples: 0,
  last_seen_at: new Date().toISOString(),
}], { onConflict: 'learner_id,lego_id' })
console.log('UPSERT mastery ->', up.error ? `ERROR ${up.error.code}: ${up.error.message} | ${up.error.details || ''} | ${up.error.hint || ''}` : 'ok')

// 3. series upsert
const ser = await asLearner.from('learner_lego_metrics').upsert([{
  learner_id: learner.id,
  lego_id: PROBE_LEGO,
  course_code: PROBE_COURSE,
  recent_latency_samples: [1.0, 1.2],
  mean_latency_ms: 1.1,
}], { onConflict: 'learner_id,lego_id' })
console.log('UPSERT series ->', ser.error ? `ERROR ${ser.error.code}: ${ser.error.message}` : 'ok')

// 4. evidence upsert
const ev = await asLearner.from('learner_lego_metrics').upsert([{
  learner_id: learner.id,
  lego_id: PROBE_LEGO,
  course_code: PROBE_COURSE,
  evidence_series: { values: [1], x: [1] },
}], { onConflict: 'learner_id,lego_id' })
console.log('UPSERT evidence ->', ev.error ? `ERROR ${ev.error.code}: ${ev.error.message}` : 'ok')

// verify + clean up
const check = await svc.from('learner_lego_metrics').select('*').eq('lego_id', PROBE_LEGO)
console.log('service-role sees probe rows:', check.data?.length, JSON.stringify(check.data?.[0] ?? null))
const del = await svc.from('learner_lego_metrics').delete().eq('lego_id', PROBE_LEGO).eq('course_code', PROBE_COURSE)
console.log('cleanup delete ->', del.error ? del.error.message : 'ok')
