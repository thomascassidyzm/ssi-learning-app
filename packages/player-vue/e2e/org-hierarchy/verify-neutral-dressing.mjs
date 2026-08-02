// Live verification of the NEUTRAL DRESSING (founder ruling 2026-08-02:
// "a council is not a school") against the deployed dev URL. Mints a real
// ssi_admin session (same technique as verify-org-tree.mjs), opens the
// Cardiff Council org Tom created on dev, and asserts zero ed-speak:
// neutral stat tiles, no school/teacher/class lenses, no Add-a-school verb,
// invite roles defaulting to Group leader.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const ORG_ID = process.env.ORG_ID || 'c778ad64-5110-4f50-93a7-8a308198caa5' // Cardiff Council
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

const results = []
function step(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`)
}

const browser = await chromium.launch()
try {
  const session = await mintSession(ADMIN_EMAIL)
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  await ctx.addInitScript(([key, value, roleKey, roleValue]) => {
    window.localStorage.setItem(key, value)
    window.localStorage.setItem(roleKey, roleValue)
  }, [`sb-${projectRef}-auth-token`, JSON.stringify(session), 'ssi-user-role', JSON.stringify({ platformRole: 'ssi_admin', educationalRole: null })])
  const page = await ctx.newPage()

  await page.goto(`${BASE}/admin/groups/${ORG_ID}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.identity-name', { timeout: 20000 })
  await page.waitForTimeout(1000)

  step('org identity renders', (await page.locator('.identity-name').textContent())?.trim() === 'Cardiff Council')

  const statWords = (await page.locator('.stat-word').allTextContents()).map((s) => s.trim())
  step('neutral stat tiles', JSON.stringify(statWords) === JSON.stringify(['Practice hours', 'Groups', 'Learners']), statWords.join(' · '))

  const chips = (await page.locator('.chip').allTextContents()).map((s) => s.trim())
  step('neutral lenses only', JSON.stringify(chips) === JSON.stringify(['Directly below', 'All groups']), chips.join(' · '))

  const verbs = (await page.locator('.verb').allTextContents()).map((s) => s.trim())
  step('no Add-a-school verb', !verbs.includes('Add a school'), verbs.join(' · '))
  step('Add-a-group verb present', verbs.includes('Add a group'))

  const bodyText = await page.locator('.node-home').innerText()
  step('zero ed-speak on the page', !/Teacher|Classes|School\b/.test(bodyText), (bodyText.match(/Teacher|Classes|School\b/g) || []).join(','))

  await page.click('.verb:has-text("Invite a person")')
  await page.waitForTimeout(300)
  const roleValue = await page.locator('.verb-form select').first().inputValue()
  const roleOptions = (await page.locator('.verb-form select option').allTextContents()).map((s) => s.trim())
  step('invite defaults to Group leader', roleValue === 'leader', roleValue)
  step('no Teacher invite option', !roleOptions.includes('Teacher') && !roleOptions.includes('School leader'), roleOptions.join(' · '))

  await page.screenshot({ path: 'e2e/org-hierarchy/neutral-dressing-cardiff.png', fullPage: true })
} finally {
  await browser.close()
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
