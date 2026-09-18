#!/usr/bin/env node
/**
 * #857 acceptance test — prove through the DEPLOYED PRODUCTION API that a
 * Paddle refund closes access.
 *
 * Production (saysomethingin.app) runs `main`, whose resolver filters
 * user_entitlements on expires_at alone. Asserting timestamps in the database
 * proves nothing about production; this script asserts what production's own
 * resolver ANSWERS, via GET /api/admin/effective-access?learner_id=<id> — the
 * endpoint that runs api/_utils/resolveEntitlements.ts on the shared database.
 *
 * It writes synthetic rows to the LIVE database (learner + subscription, prefix
 * cs857_verify_*), drives them through main's exact webhook UPDATEs, and deletes
 * every one of them at the end, proving by a final SELECT that none survive. It
 * never touches a real learner's rows.
 */
const fs = require('fs')
const path = require('path')
const DASH = path.join(process.env.HOME, 'SSi/ssi-dashboard-v7-clean')
const { Client } = require(path.join(DASH, 'node_modules/pg'))

const HOST = process.env.HOST || 'https://saysomethingin.app'
const ADMIN_EMAIL = 'thomas.cassidy+e2e-admin@gmail.com'
const TAG = 'cs857_verify_' + Math.random().toString(36).slice(2, 8)

function envOf(file, keys) {
  const t = fs.readFileSync(path.join(DASH, file), 'utf8')
  const out = {}
  for (const k of keys) {
    const m = t.match(new RegExp('^' + k + '=(.*)$', 'm'))
    if (m) out[k] = m[1].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const log = []
function say(line) { console.log(line); log.push(line) }

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function main() {
  const e = envOf('.env', ['VITE_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'])
  const SUPA = e.VITE_SUPABASE_URL || e.SUPABASE_URL
  const SERVICE = e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SERVICE_KEY
  const ANON = e.VITE_SUPABASE_ANON_KEY || e.SUPABASE_ANON_KEY
  if (!SUPA || !SERVICE || !ANON) throw new Error('missing Supabase keys in ssi-dashboard-v7-clean/.env')

  const ver = await (await fetch(HOST + '/version.json')).json()
  say(`${HOST}/version.json → ${JSON.stringify(ver)}`)
  check('production is the build this fix is aimed at (main, ea0683f)',
    ver.buildBranch === 'main' && ver.buildNumber === 'ea0683f')

  // ── admin session (token never printed) ────────────────────────────────
  const link = await (await fetch(SUPA + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: ADMIN_EMAIL }),
  })).json()
  const otp = link.properties?.email_otp || link.email_otp
  if (!otp) throw new Error('could not mint admin OTP: ' + JSON.stringify(link).slice(0, 200))
  const sess = await (await fetch(SUPA + '/auth/v1/verify', {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: ADMIN_EMAIL, token: otp }),
  })).json()
  if (!sess.access_token) throw new Error('could not exchange OTP: ' + JSON.stringify(sess).slice(0, 200))
  say('minted an ssi_admin session for the "e2e admin (harness)" account (token redacted)')

  const ask = async (learnerId) => {
    const r = await fetch(`${HOST}/api/admin/effective-access?learner_id=${learnerId}`, {
      headers: { Authorization: 'Bearer ' + sess.access_token },
    })
    const body = await r.json()
    return { status: r.status, body }
  }
  const openPaddle = (res) => (res.body.entitlements || []).filter((x) => !res.body.derived?.includes(x.id))

  const c = new Client({ connectionString: (fs.readFileSync(path.join(DASH, '.env.psql'), 'utf8').match(/postgresql:\/\/[^\s"']+/) || [])[0] })
  await c.connect()
  const made = { learners: [], subs: [] }
  try {
    const mk = async (suffix, periodEndSql) => {
      const ref = TAG + '_' + suffix
      const learner = (await c.query(
        `INSERT INTO public.learners (user_id, display_name, is_internal)
         VALUES (gen_random_uuid()::text, $1, true) RETURNING id`, [ref])).rows[0].id
      made.learners.push(learner)
      const sub = (await c.query(
        `INSERT INTO public.subscriptions
           (learner_id, provider, provider_subscription_id, provider_customer_id,
            status, cancel_at_period_end, plan_id, plan_name, current_period_end)
         VALUES ($1,'paddle',$2,'ctm_'||$2,'active',false,'pri_x','SSi Premium',${periodEndSql})
         RETURNING id`, [learner, ref])).rows[0].id
      made.subs.push(sub)
      return { learner, sub, ref }
    }
    const grantRow = async (ref) => (await c.query(
      `SELECT expires_at, revoked_at FROM public.user_entitlements WHERE source='paddle' AND source_ref=$1`,
      [ref])).rows[0]

    // BEFORE: every live paddle grant, row by row.
    const before = (await c.query(
      `SELECT id, expires_at, revoked_at FROM public.user_entitlements
         WHERE source='paddle' AND source_ref NOT LIKE 'cs857%' ORDER BY id`)).rows
    say(`\nbaseline: ${before.length} live paddle grants captured`)

    // ── A. refunded annual ────────────────────────────────────────────────
    say('\n=== A. synthetic annual subscriber ===')
    const A = await mk('a', "now() + interval '1 year'")
    let g = await grantRow(A.ref)
    say(`grant mirrored: expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)
    let r = await ask(A.learner)
    say(`GET /api/admin/effective-access?learner_id=${A.learner} → ${r.status} ${JSON.stringify(r.body)}`)
    check('PRODUCTION shows access OPEN while the subscription is active', r.status === 200 && openPaddle(r).length === 1)

    say("\n-- main's exact refund UPDATE (status='cancelled', cancel_at_period_end=true, updated_at=now()) --")
    await c.query(`UPDATE public.subscriptions SET status='cancelled', cancel_at_period_end=true, updated_at=now() WHERE id=$1`, [A.sub])
    g = await grantRow(A.ref)
    say(`grant now: expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)
    r = await ask(A.learner)
    say(`GET … → ${r.status} ${JSON.stringify(r.body)}`)
    check('PRODUCTION shows access CLOSED after the refund', r.status === 200 && openPaddle(r).length === 0)

    say('\n-- replay 1: held-plan-shaped subscription.updated (base fields only, status active) --')
    await c.query(`UPDATE public.subscriptions SET status='active', current_period_end=current_period_end,
      cancel_at_period_end=false, provider='paddle', provider_customer_id=provider_customer_id, updated_at=now()
      WHERE id=$1`, [A.sub])
    r = await ask(A.learner)
    say(`GET … → ${r.status} ${JSON.stringify(r.body)}`)
    check('PRODUCTION still CLOSED after a held-plan-shaped replay', openPaddle(r).length === 0)

    say('\n-- replay 2: full upsert-shaped write (base + plan fields, status active) --')
    await c.query(`UPDATE public.subscriptions SET status='active', plan_id='pri_x', plan_name='SSi Premium',
      current_period_end=current_period_end, cancel_at_period_end=false,
      provider_customer_id=provider_customer_id, updated_at=now() WHERE id=$1`, [A.sub])
    r = await ask(A.learner)
    say(`GET … → ${r.status} ${JSON.stringify(r.body)}`)
    check('PRODUCTION still CLOSED after a full upsert-shaped replay', openPaddle(r).length === 0)
    say("(Paddle after a full refund sends subscription.canceled, i.e. status 'cancelled'; " +
        "these two replays use status='active' deliberately — the hardest case, and the exact " +
        "shape of main's reverse-adjustment write.)")

    // ── B. period-end cancellation keeps paid access ──────────────────────
    say('\n=== B. second synthetic subscriber, period-end cancellation ===')
    const B = await mk('b', "now() + interval '90 days'")
    await c.query(`UPDATE public.subscriptions SET status='cancelled', cancel_at_period_end=false, updated_at=now() WHERE id=$1`, [B.sub])
    g = await grantRow(B.ref)
    say(`grant now: expires_at=${g.expires_at} revoked_at=${g.revoked_at}`)
    r = await ask(B.learner)
    say(`GET /api/admin/effective-access?learner_id=${B.learner} → ${r.status} ${JSON.stringify(r.body)}`)
    check('PRODUCTION keeps paid access OPEN through a period-end cancellation', openPaddle(r).length === 1)

    // ── C. live rows untouched ────────────────────────────────────────────
    const after = (await c.query(
      `SELECT id, expires_at, revoked_at FROM public.user_entitlements
         WHERE source='paddle' AND source_ref NOT LIKE 'cs857%' ORDER BY id`)).rows
    const same = after.length === before.length && after.every((x, i) =>
      x.id === before[i].id && String(x.expires_at) === String(before[i].expires_at) &&
      String(x.revoked_at) === String(before[i].revoked_at))
    check('every live paddle grant unchanged, row by row (expires_at and revoked_at)', same,
      `${after.length} rows compared`)
  } finally {
    // ── CLEAN UP ──────────────────────────────────────────────────────────
    say('\n=== cleanup ===')
    await c.query(`DELETE FROM public.user_entitlements WHERE source='paddle' AND source_ref LIKE $1`, [TAG + '%'])
    await c.query(`DELETE FROM public.subscriptions WHERE provider_subscription_id LIKE $1`, [TAG + '%'])
    await c.query(`DELETE FROM public.learners WHERE display_name LIKE $1`, [TAG + '%'])
    const left = (await c.query(
      `SELECT (SELECT count(*) FROM public.learners WHERE display_name LIKE 'cs857%')
            + (SELECT count(*) FROM public.subscriptions WHERE provider_subscription_id LIKE 'cs857%')
            + (SELECT count(*) FROM public.user_entitlements WHERE source_ref LIKE 'cs857%') AS n`)).rows[0].n
    check('nothing with the cs857 prefix remains in learners, subscriptions or user_entitlements',
      Number(left) === 0, `${left} rows found`)
    await c.end()
  }

  const failed = results.filter((r) => !r.ok)
  say(`\n${failed.length === 0 ? 'GREEN' : 'RED'} — ${results.length - failed.length}/${results.length} passed`)
  if (process.env.TRANSCRIPT) fs.writeFileSync(process.env.TRANSCRIPT, log.join('\n') + '\n')
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('verify error:', e.message); process.exit(2) })
