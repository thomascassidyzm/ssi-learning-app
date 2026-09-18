/** Read-only by default. Load Popty env; apply only a reviewed post-migration snapshot. */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) throw new Error('Supabase URL and service key required')
const db = createClient(url, key, { auth: { persistSession: false } })
if (process.env.DRY_RUN === 'false') {
  if (!process.env.SNAPSHOT_PATH) throw new Error('Reviewed SNAPSHOT_PATH required')
  const rows = JSON.parse(readFileSync(process.env.SNAPSHOT_PATH, 'utf8'))
  const { data, error } = await db.rpc('backfill_paddle_grants', { p_rows: rows })
  if (error) throw error
  console.log(`Inserted ${data} grants; existing grants preserved`)
} else {
  const { data, error } = await db.from('subscriptions').select('*').eq('provider', 'paddle')
  if (error) throw error
  const candidates = data.filter(s => ['active', 'cancelled'].includes(s.status))
  const complete = candidates.filter(s => s.provider_subscription_id && s.learner_id && s.current_period_end && s.created_at)
  const gaps = candidates.filter(s => !complete.includes(s))
  const report = '# Paddle grant backfill — live read-only dry run\n\n' + new Date().toISOString() +
    '\n\nNo database or Paddle writes. All grants use source paddle and catalogue-wide access, matching the existing resolver.\n\n' +
    '| Learner | Paddle subscription | Status | Starts | Expires |\n|---|---|---|---|---|\n' +
    complete.map(s => `| ${s.learner_id} | ${s.provider_subscription_id} | ${s.status} | ${s.created_at} | ${s.current_period_end} |`).join('\n') +
    '\n\n## Explicit gaps\n\n' + gaps.map(s => `- ${s.provider_subscription_id}: ${s.status}, period end ${s.current_period_end ?? 'missing'}. Excluded; no historical expiry invented.`).join('\n') +
    '\n\nApply after schema migration: repeat dry run with SNAPSHOT_PATH, review the report, then DRY_RUN=false with that snapshot. The RPC locks and checks each subscription against the snapshot; any change aborts the whole batch. It never overwrites an existing grant.\n'
  if (process.env.REPORT_PATH) writeFileSync(process.env.REPORT_PATH, report)
  if (process.env.SNAPSHOT_PATH) writeFileSync(process.env.SNAPSHOT_PATH, JSON.stringify(complete, null, 2))
  console.log(report)
}
