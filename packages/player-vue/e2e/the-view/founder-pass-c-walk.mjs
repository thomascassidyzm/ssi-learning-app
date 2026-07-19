// Founder pass C walk on DEPLOYED dev (2026-07-19): honest delete,
// up-affordance, tree declutter, zebra table. Proves, against the real
// deployment with a real admin session:
//   1. HONEST DELETE — a throwaway demo structure (programme → region +
//      legacy-attached school) is minted; the impact preview names the
//      sub-group that will be DELETED and the school that will be ORPHANED
//      to top level; the confirm modal shows those exact lines (screenshot);
//      the API delete then behaves exactly as warned (groups gone, school
//      survives ungrouped). NO real/IME data touched — only rows this
//      script mints itself, cleaned up at the end.
//   2. UP-AFFORDANCE — node home's map rail carries "All organisations"
//      back to /admin/structure at every depth (clicked, lands there).
//   3. TREE DECLUTTER — rows carry name + quiet label + one muted learner
//      figure; no inline mint forms; ⋯ = Rename/Change label/Delete.
//   4. ZEBRA — table lens screenshot with alternating row shading.
//
//   EXPECT_BUILD=<sha7> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/founder-pass-c-walk.mjs
//
// Screenshots land in docs/the-view/founder-pass-c/ (committed as evidence).
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/founder-pass-c/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const EXPECT = process.env.EXPECT_BUILD
if (EXPECT) {
  const { buildNumber } = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
  if (buildNumber !== EXPECT) { console.log(`FAIL — deploy gate: deployed=${buildNumber} expected=${EXPECT}`); process.exit(2) }
}

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
const accessToken = v.session.access_token
const authed = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// ── 1. Mint the throwaway structure (ours alone; cleaned up below) ──
const STAMP = `ZZ Pass-C ${new Date().toISOString().slice(11, 16)}`
async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: authed, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
const prog = await post('/api/groups', { name: `${STAMP} Programme`, type: 'programme', is_demo: true })
check('throwaway programme minted', prog.status < 300 && !!prog.body.group?.id, `${prog.status}`)
const progId = prog.body.group?.id
const region = await post('/api/groups', { name: `${STAMP} Region`, type: 'region', parent_id: progId, is_demo: true })
check('throwaway region minted under it', region.status < 300 && !!region.body.group?.id)
const regionId = region.body.group?.id
// create-school mints the school's own node (one-node model) → this school
// is IN the subtree and will be DELETED with it.
const school = await post('/api/admin/create-school', { school_name: `${STAMP} School`, group_id: regionId })
const schoolId = school.body.school?.id || school.body.school_id || school.body.id
check('node-backed throwaway school minted', school.status < 300, `${school.status} ${JSON.stringify(school.body).slice(0, 120)}`)
// a LEGACY-attach school (group_id only, no node) → survives delete, orphaned
// to top level. Minted directly (no endpoint creates this shape any more).
const { data: legacyRow, error: legacyErr } = await svc
  .from('schools')
  .insert({ school_name: `${STAMP} Legacy School`, group_id: regionId, is_test: true })
  .select('id')
  .single()
check('legacy-attach throwaway school minted (direct row)', !legacyErr && !!legacyRow?.id, legacyErr?.message || '')
const legacyId = legacyRow?.id

// ── 2. Impact preview tells the truth ──
const impResp = await fetch(`${BASE}/api/groups/${progId}`, { headers: authed })
const { impact } = await impResp.json()
console.log('impact:', JSON.stringify(impact))
check('impact counts region + school-node as deleted sub-groups',
  impact?.descendantGroupCount === 2 && (impact.descendantGroupNames || []).some((n) => n.includes('Region')))
check('impact names the deleted school', impact?.schoolCount === 1 && impact.schoolNames?.[0]?.includes('School'))
check('impact names the orphaned legacy school',
  impact?.orphanedSchoolCount === 1 && (impact.orphanedSchoolNames || []).some((n) => n.includes('Legacy')))

// ── 3. UI: the confirm modal shows the honest lines (screenshot) ──
const browser = await chromium.launch()
const desktop = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await desktop.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])

const page = await desktop.newPage()
await page.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForSelector('.structure-tree, .structure-table', { timeout: 25000 }).catch(() => {})
await page.fill('.structure-search-input', STAMP)
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}tree-decluttered-search.png`, fullPage: true })

// declutter assertions on the live DOM
const rowCount = await page.locator('.structure-row').count()
check('tree shows the throwaway rows', rowCount >= 2, `${rowCount} rows`)
check('no inline mint/invite forms on rows', (await page.locator('.structure-inline-form input[placeholder="Demo org name"]').count()) === 0)
const progRow = page.locator('.structure-row', { hasText: `${STAMP} Programme` }).first()
await progRow.locator('.overflow-toggle').click()
const menuItems = await page.locator('.overflow-item').allInnerTexts()
check('⋯ is maintenance-only', JSON.stringify(menuItems) === JSON.stringify(['Rename', 'Change label', 'Delete']), menuItems.join(' / '))
await page.locator('.overflow-item', { hasText: 'Delete' }).click()
await page.waitForSelector('.impact-list li', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}delete-warning-honest.png`, fullPage: false })
const modalText = await page.locator('[role="alertdialog"]').innerText().catch(() => '')
check('modal names the sub-group deletions', /permanently deletes 2 sub-groups/i.test(modalText) && modalText.includes(`${STAMP} Region`))
check('modal names the deleted school', /deletes 1 school and everything in them|deletes 1 school /i.test(modalText))
check('modal names the orphaned school + top level', /top level/i.test(modalText) && modalText.includes(`${STAMP} Legacy School`))
await page.locator('.btn-cancel').click().catch(() => {})

// ── 4. Zebra on the table lens ──
await page.locator('.lens-btn', { hasText: 'Table' }).click()
await page.waitForTimeout(1200)
await page.fill('.structure-search-input', '')
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}table-zebra.png`, fullPage: true })

// ── 5. Up-affordance from node home (every depth: region = depth 2) ──
const nodePage = await desktop.newPage()
await nodePage.goto(`${BASE}/admin/groups/${regionId}`, { waitUntil: 'networkidle' }).catch(() => {})
await nodePage.waitForSelector('.rail-up', { timeout: 25000 }).catch(() => {})
await nodePage.screenshot({ path: `${OUT}node-home-up-affordance.png`, fullPage: true })
check('rail carries "All organisations"', (await nodePage.locator('.rail-up').innerText().catch(() => '')).includes('All organisations'))
await nodePage.locator('.rail-up').click()
await nodePage.waitForTimeout(1500)
check('up control lands on /admin/structure', nodePage.url().includes('/admin/structure'), nodePage.url())

// phone: rail control still visible
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
await phone.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
const pp = await phone.newPage()
await pp.goto(`${BASE}/admin/groups/${regionId}`, { waitUntil: 'networkidle' }).catch(() => {})
await pp.waitForSelector('.rail-up', { timeout: 25000 }).catch(() => {})
await pp.screenshot({ path: `${OUT}node-home-up-affordance-phone.png`, fullPage: true })

// ── 6. Delete behaves exactly as warned, then full cleanup ──
const del = await fetch(`${BASE}/api/groups/${progId}`, { method: 'DELETE', headers: authed })
const delBody = await del.json().catch(() => ({}))
check('delete succeeds', del.ok, `${del.status} ${JSON.stringify(delBody).slice(0, 120)}`)
const { data: goneGroups } = await svc.from('groups').select('id').in('id', [progId, regionId])
check('programme + region rows gone', (goneGroups || []).length === 0)
if (schoolId) {
  const { data: nodeSchool } = await svc.from('schools').select('id').eq('id', schoolId).maybeSingle()
  check('node-backed school deleted with its node (as warned)', !nodeSchool)
}
if (legacyId) {
  const { data: orphan } = await svc.from('schools').select('id, group_id').eq('id', legacyId).maybeSingle()
  check('legacy school survives, ungrouped (as warned)', !!orphan && orphan.group_id === null, JSON.stringify(orphan))
  const { error: cleanupErr } = await svc.from('schools').delete().eq('id', legacyId)
  check('legacy throwaway cleaned up', !cleanupErr, cleanupErr?.message || '')
}

await browser.close()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS')
process.exit(failures ? 1 : 0)
