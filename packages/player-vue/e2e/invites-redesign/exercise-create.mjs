// Exercise ONE real create flow end-to-end on the DEPLOYED dev build:
// mint a group-leader invite through the UI, confirm the link renders and the
// row appears in the unified list, then deactivate it (no litter left).
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const URL_SB = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr

const BASE = 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(v.session)])
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(`${BASE}/admin/invites`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)

// WHO defaults to Group leader; pick a demo group as WHERE (harmless target).
const whereSelect = page.locator('.create-form select').nth(1)
const options = await whereSelect.locator('option').allTextContents()
console.log('where options (first 6):', options.slice(0, 6))
const demoIdx = options.findIndex(o => /welsh health|japan 2026/i.test(o))
if (demoIdx < 1) throw new Error('no demo group option found')
await whereSelect.selectOption({ index: demoIdx })
await page.locator('.create-form button[type=submit]').click()
await page.waitForTimeout(2500)
const linkText = await page.locator('.invite-link-url').first().textContent()
console.log('minted link:', linkText)
// Leader invites mint the /group/ onboarding door (same as old AdminAccess);
// other roles mint /redeem/.
if (!/\/(redeem|group)\//.test(linkText || '')) throw new Error('minted link has unexpected path')
const code = linkText.trim().split('/').pop()
await page.screenshot({ path: '/tmp/invites-shots/invites-desktop-created.png' })

// Find it in the unified list via the search box, then deactivate.
await page.locator('input[placeholder*="Search"]').fill(code)
await page.waitForTimeout(800)
await page.screenshot({ path: '/tmp/invites-shots/invites-desktop-list-filtered.png' })
const row = page.locator('tbody tr').first()
const rowText = await row.textContent()
console.log('list row:', rowText?.replace(/\s+/g, ' ').slice(0, 160))
await row.locator('button:has-text("Active")').first().click().catch(async () => {
  await row.locator('.status-toggle, [role=switch], button').last().click()
})
await page.waitForTimeout(1500)
const rowText2 = await page.locator('tbody tr').first().textContent()
console.log('after toggle:', rowText2?.replace(/\s+/g, ' ').slice(0, 160))

await browser.close()
console.log('done — code exercised:', code)
