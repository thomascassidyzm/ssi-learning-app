// Ad-hoc local verification for the Organisations/group-tree admin UI
// (AdminStructure.vue + GroupTreeNode.vue), same technique as
// e2e/demo-schools: mint a real ssi_admin session via admin.generateLink +
// verifyOtp (no email sent), inject into localStorage, drive with
// Playwright against a LOCAL dev server. Creates one throwaway demo
// organisation with a nested sub-group and a school, verifies the tree
// renders at depth 2, then deletes everything it created.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error('missing Supabase env vars')

const svc = createClient(SUPABASE_URL, SERVICE)
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]

async function mintSession(email) {
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`generateLink(${email}) failed: ${error.message}`)
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
  if (verr) throw new Error(`verifyOtp(${email}) failed: ${verr.message}`)
  return v.session
}

async function injectSession(ctx, session, platformRole) {
  await ctx.addInitScript(([key, value, roleKey, roleValue]) => {
    window.localStorage.setItem(key, value)
    if (roleValue) window.localStorage.setItem(roleKey, roleValue)
  }, [`sb-${projectRef}-auth-token`, JSON.stringify(session), 'ssi-user-role', platformRole ? JSON.stringify({ platformRole, educationalRole: null }) : ''])
}

const results = []
function step(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`)
}

/** Poll a locator's count instead of a fixed sleep — client refetch after a delete/create can be slow on a cold serverless invocation. */
async function waitForCount(locator, predicate, timeoutMs = 8000) {
  const start = Date.now()
  let last = -1
  while (Date.now() - start < timeoutMs) {
    last = await locator.count()
    if (predicate(last)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return predicate(last)
}

let orgId = null
let subGroupId = null
let schoolId = null

const browser = await chromium.launch()
try {
  const session = await mintSession(ADMIN_EMAIL)
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  await injectSession(ctx, session, 'ssi_admin')
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  step('landed on admin structure', page.url().includes('/admin/structure'), page.url())

  // 1. Create a demo organisation (root group) — inline "+ Add organisation"
  await page.click('button:has-text("+ Add organisation")')
  const orgName = `ZZQA-Org-${Date.now()}`
  await page.fill('input[placeholder="Organisation name"]', orgName)
  await page.check('.root-inline-form input[type="checkbox"]')
  await page.click('.root-inline-form button:has-text("Add")')
  await page.waitForTimeout(1200)
  step('organisation created', await page.locator(`text=${orgName}`).count() > 0, orgName)

  const { data: orgRow } = await svc.from('groups').select('id, is_demo').eq('name', orgName).maybeSingle()
  orgId = orgRow?.id
  step('organisation row is_demo=true', orgRow?.is_demo === true, JSON.stringify(orgRow))

  // 2. Add a nested sub-group directly from the tree row
  const orgRowLocator = page.locator('.group-row', { hasText: orgName })
  await orgRowLocator.hover()
  await orgRowLocator.locator('button[title="Add sub-group"]').click()
  const subGroupName = `ZZQA-Region-${Date.now()}`
  await page.fill('input[placeholder="Sub-group name"]', subGroupName)
  await page.click('.tree-inline-form button:has-text("Add")')
  await page.waitForTimeout(1200)
  step('sub-group visible in tree', await page.locator(`text=${subGroupName}`).count() > 0, subGroupName)

  const { data: subGroupRow } = await svc.from('groups').select('id, parent_id, is_demo').eq('name', subGroupName).maybeSingle()
  subGroupId = subGroupRow?.id
  step('sub-group parented + inherited is_demo', subGroupRow?.parent_id === orgId && subGroupRow?.is_demo === true, JSON.stringify(subGroupRow))

  // 3. Add a school (entity) at the sub-group — the leaf, depth 2 under the org
  const subGroupRowLocator = page.locator('.group-row', { hasText: subGroupName })
  await subGroupRowLocator.hover()
  await subGroupRowLocator.locator('button[title="Add school here"]').click()
  const schoolName = `ZZQA-School-${Date.now()}`
  await page.fill('input[placeholder="School name"]', schoolName)
  await page.click('.tree-inline-form button:has-text("Add")')
  await page.waitForTimeout(2500)
  step('school entity visible in tree', await page.locator(`.entity-row:has-text("${schoolName}")`).count() > 0, schoolName)

  const { data: schoolRow } = await svc.from('schools').select('id, group_id, is_demo').eq('school_name', schoolName).maybeSingle()
  schoolId = schoolRow?.id
  step('school parented to sub-group + inherited is_demo', schoolRow?.group_id === subGroupId && schoolRow?.is_demo === true, JSON.stringify(schoolRow))

  await page.screenshot({ path: 'e2e/org-hierarchy/tree-screenshot.png', fullPage: true })
  step('screenshot captured', true, 'e2e/org-hierarchy/tree-screenshot.png')

  // 4. Delete the school entity via the ConfirmDeleteModal
  const entityRowLocator = page.locator('.entity-row', { hasText: schoolName })
  await entityRowLocator.hover()
  await entityRowLocator.locator('button[title="Delete school"]').click()
  await page.waitForTimeout(800)
  step('delete modal opened for school', await page.locator('.modal-title:has-text("Delete school")').count() > 0)
  await page.click('.btn-delete')
  const schoolGone = await waitForCount(page.locator(`.entity-row:has-text("${schoolName}")`), (n) => n === 0)
  step('school entity removed from tree', schoolGone)

  // 5. Delete the sub-group, then the org, via the same modal. DB truth is
  // the real assertion (schools/groups delete cascades server-side); the
  // tree-absence check is a UI-refresh sanity check on top of it.
  const subGroupRowLocator2 = page.locator('.group-row', { hasText: subGroupName })
  await subGroupRowLocator2.hover()
  await subGroupRowLocator2.locator('button[title="Delete group"]').click()
  await page.waitForTimeout(800)
  await page.click('.btn-delete')
  await page.waitForTimeout(1500)
  const { data: subGroupAfterDelete } = await svc.from('groups').select('id').eq('id', subGroupId).maybeSingle()
  step('sub-group deleted (DB truth)', !subGroupAfterDelete)
  const subGroupGone = await waitForCount(page.locator(`.group-row:has-text("${subGroupName}")`), (n) => n === 0)
  step('sub-group removed from tree', subGroupGone)

  const orgRowLocator2 = page.locator('.group-row', { hasText: orgName })
  await orgRowLocator2.hover()
  await orgRowLocator2.locator('button[title="Delete group"]').click()
  await page.waitForTimeout(800)
  await page.click('.btn-delete')
  await page.waitForTimeout(1500)
  const { data: orgAfterDelete } = await svc.from('groups').select('id').eq('id', orgId).maybeSingle()
  step('organisation deleted (DB truth)', !orgAfterDelete)
  const orgGone = await waitForCount(page.locator(`.group-row:has-text("${orgName}")`), (n) => n === 0)
  step('organisation removed from tree', orgGone)

  step('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
} catch (err) {
  step('unhandled error', false, err?.stack || String(err))
} finally {
  await browser.close()
  // Best-effort cleanup in case a UI step above failed before reaching delete.
  if (schoolId) await svc.from('schools').delete().eq('id', schoolId)
  if (subGroupId) await svc.from('groups').delete().eq('id', subGroupId)
  if (orgId) await svc.from('groups').delete().eq('id', orgId)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps passed`)
if (failed.length) process.exit(1)
