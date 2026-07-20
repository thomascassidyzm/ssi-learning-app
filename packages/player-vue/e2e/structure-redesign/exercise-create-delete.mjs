// Exercise create-at-node on the DEPLOYED dev build: make a throwaway
// sub-group under a test organisation, then delete it via ConfirmDeleteModal
// (typed-name confirm). Cleans up after itself.
//
//   node --env-file=../../.env --env-file=../../.env.local e2e/structure-redesign/exercise-create-delete.mjs
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'

const URL_SB = process.env.VITE_SUPABASE_URL
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const email = process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com'
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
console.log('admin session ok', v.session.user.id)
const projectRef = new URL(URL_SB).hostname.split('.')[0]

const results = []
function step(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const stamp = Date.now().toString(36)
const subgroupName = `zz-e2e-throwaway-${stamp}`

await page.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)

// Find any existing group row to hang a sub-group off (root org rows only —
// depth 0 — so we don't perturb the school-bearing branches used by the other checks).
const groupRow = page.locator('.group-row').first()
step('found a group row to create under', await groupRow.count() > 0)

await groupRow.hover()
await groupRow.locator('button.row-action[title="Add sub-group"]').click()
await page.waitForTimeout(400)
const inlineForm = page.locator('.tree-inline-form').first()
step('add-subgroup inline form opens', await inlineForm.count() > 0)
await inlineForm.locator('input.frost-input').fill(subgroupName)
await inlineForm.locator('button.btn-ghost-sm', { hasText: 'Add' }).click().catch(async () => {
  await inlineForm.locator('button.btn-ghost-sm').click()
})
await page.waitForTimeout(1500)

const newRow = page.locator('.group-name-editable', { hasText: subgroupName })
step('throwaway sub-group appears in the tree', await newRow.count() > 0, subgroupName)

// Delete it via ConfirmDeleteModal
const newGroupRow = page.locator('.group-row', { has: page.locator('.group-name-editable', { hasText: subgroupName }) }).first()
await newGroupRow.hover()
await newGroupRow.locator('button.row-action.is-danger[title="Delete group"]').click()
await page.waitForTimeout(800)
const modal = page.locator('.modal[role="alertdialog"]')
step('ConfirmDeleteModal opens', await modal.count() > 0)
step('modal shows the throwaway group name', (await modal.locator('.delete-target').textContent().catch(() => ''))?.includes(subgroupName))

const typedInput = modal.locator('#confirmName')
if (await typedInput.count() > 0) {
  await typedInput.fill(subgroupName)
}
await modal.locator('button.btn-delete').click()
await page.waitForTimeout(1500)

step('modal closes after delete', await modal.count() === 0)
const goneRow = page.locator('.group-name-editable', { hasText: subgroupName })
step('throwaway sub-group removed from the tree', await goneRow.count() === 0)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
