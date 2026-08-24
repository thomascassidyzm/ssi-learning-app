/**
 * Does renaming a school through the setup wizard rename what the LEADER sees?
 *
 * A school's dashboard heading reads its NODE (a `groups` row, synthesised
 * lazily the first time the dashboard is opened). api/school/update-profile.ts
 * writes `schools.school_name` only. So the order of events decides what she
 * sees:
 *
 *   rename BEFORE the node exists  → node is born with the new name → correct
 *   rename AFTER  the node exists  → node keeps the OLD name       → stale
 *
 * The second order is the real one for a leader who opens her dashboard, then
 * goes into the wizard and names her school. This probe forces that order.
 *
 * THROWAWAY ONLY — disposable rows, torn down at the end, no email, no payment.
 */
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://saysomethingin.app'
const svc = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim(), { auth: { persistSession: false } })

const STAMP = String(Date.now()).slice(-6)
const EMAIL = `thomas.cassidy+zz.order.${STAMP}@gmail.com`
const PASSWORD = 'SsiTest2026!'
const OLD = 'ZZ Order probe OLD (delete me)'
const NEW = `ZZ Order probe NEW ${STAMP} (delete me)`

const made = { user: null, learner: null, school: null, node: null }
let browser
const signIn = async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
  const sp = p.getByText(/save progress/i).first()
  if (await sp.isVisible().catch(() => false)) await sp.click().catch(() => {})
  await p.locator('input[type="email"]').first().waitFor({ timeout: 30000 })
  await p.locator('input[type="email"]').first().fill(EMAIL)
  await p.getByRole('button', { name: /continue|next|sign in/i }).first().click().catch(() => {})
  const up = p.getByText(/use password instead/i).first()
  await up.waitFor({ timeout: 20000 }).catch(() => {})
  if (await up.isVisible().catch(() => false)) await up.click().catch(() => {})
  await p.locator('input[type="password"]').first().fill(PASSWORD)
  await p.getByRole('button', { name: /sign in|continue|log in/i }).first().click().catch(() => {})
  await p.locator('input[type="password"]').first().waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {})
}

try {
  const { data: created } = await svc.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
  made.user = created.user.id
  const { data: learner } = await svc.from('learners').select('id').eq('user_id', made.user).single()
  made.learner = learner.id
  await svc.from('learners').update({ educational_role: 'school_admin' }).eq('id', made.learner)
  const { data: school } = await svc.from('schools').insert({
    admin_user_id: made.user, school_name: OLD, name_confirmed: false, is_test: true,
    platform_status: 'trial', trial_kind: 'free_1yr',
    platform_expires_at: new Date(Date.now() + 365 * 864e5).toISOString(),
  }).select('id').single()
  made.school = school.id
  await svc.from('user_tags').insert({ user_id: made.user, tag_type: 'school', tag_value: `SCHOOL:${school.id}`, role_in_context: 'admin', added_by: made.user })

  browser = await chromium.launch()
  const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const p1 = await ctx1.newPage()
  await signIn(p1)

  // STEP 1 — she opens her dashboard first. This synthesises the node.
  await p1.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
  await p1.waitForTimeout(6000)
  const { data: s1 } = await svc.from('schools').select('node_group_id').eq('id', made.school).single()
  made.node = s1.node_group_id
  const nodeName = made.node ? (await svc.from('groups').select('name').eq('id', made.node).single()).data?.name : null
  console.log(`after opening the dashboard: node_group_id=${made.node}  named "${nodeName}"`)

  // STEP 2 — she then names her school in the wizard.
  const { data: sess } = await createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_ANON_KEY.trim(), { auth: { persistSession: false } })
    .auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  const r = await fetch(`${BASE}/api/school/update-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
    body: JSON.stringify({ school_name: NEW, name_confirmed: true }),
  })
  console.log(`rename → HTTP ${r.status}`)
  const { data: s2 } = await svc.from('schools').select('school_name').eq('id', made.school).single()
  const nodeAfter = made.node ? (await svc.from('groups').select('name').eq('id', made.node).single()).data?.name : null
  console.log(`schools.school_name = "${s2.school_name}"`)
  console.log(`node groups.name    = "${nodeAfter}"`)

  // STEP 3 — a completely fresh browser. What does she read?
  const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage()
  await signIn(p2)
  await p2.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
  await p2.waitForTimeout(6000)
  await p2.screenshot({ path: '/home/tomcassidy/.tmpbig/wizard-shots/6-rename-after-node.png' })
  const heading = ((await p2.locator('h1').first().textContent().catch(() => '')) || '').trim()
  console.log(`\nFRESH browser heading: "${heading}"`)
  console.log(heading.includes(NEW)
    ? 'RESULT: correct — the rename reaches the heading.'
    : 'RESULT: STALE — she still reads the name she replaced.')
} catch (e) {
  console.log('probe error:', e.message)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (made.user) await svc.from('user_tags').delete().eq('user_id', made.user)
  if (made.school) await svc.from('schools').delete().eq('id', made.school)
  if (made.node) await svc.from('groups').delete().eq('id', made.node)
  if (made.learner) await svc.from('learners').delete().eq('id', made.learner)
  if (made.user) await svc.auth.admin.deleteUser(made.user)
  console.log('throwaway rows torn down.')
}
