// Ad-hoc live verification: the org plan/trial/upgrade surface on the member
// node home (/org/:id), driven as a REAL Cardiff Council leader against the
// deployed dev URL. Same mint-session technique as verify-org-tree.mjs.
//
// Asserts:
//   1. /org/:cardiffId renders the node home (org name visible).
//   2. The trial banner renders with days-remaining + an Upgrade CTA → /org/upgrade.
//   3. /org/upgrade renders the upgrade surface (checkout lane reachable).
//   4. The header role badge (dressing leak check): logs its current text.
//
// Env: SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY,
//      VITE_SUPABASE_ANON_KEY. BASE_URL defaults to the dev git-branch alias.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const CARDIFF_GROUP_ID = 'c778ad64-5110-4f50-93a7-8a308198caa5'
const LEADER_EMAIL = process.env.LEADER_EMAIL || 'persona-3871a533-eec2-433a-8f25-54267deefba2@invite.saysomethingin.app'
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
  const session = await mintSession(LEADER_EMAIL)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(([key, value, roleKey, roleValue]) => {
    window.localStorage.setItem(key, value)
    window.localStorage.setItem(roleKey, roleValue)
  }, [
    `sb-${projectRef}-auth-token`, JSON.stringify(session),
    'ssi-user-role', JSON.stringify({ platformRole: null, educationalRole: 'govt_admin' }),
  ])
  const page = await ctx.newPage()

  await page.goto(`${BASE}/org/${CARDIFF_GROUP_ID}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const nameVisible = await page.getByText('Cardiff Council', { exact: false }).first().isVisible().catch(() => false)
  step('node home renders Cardiff Council', nameVisible)

  const banner = page.locator('.org-trial-banner')
  const bannerVisible = await banner.isVisible().catch(() => false)
  const bannerText = bannerVisible ? (await banner.innerText()).replace(/\s+/g, ' ').trim() : ''
  step('trial banner visible', bannerVisible, bannerText)
  step('banner says days left', /\d+ days? left in your organisation's free trial/.test(bannerText), bannerText)

  const cta = page.locator('.org-trial-cta')
  const ctaVisible = await cta.isVisible().catch(() => false)
  step('Upgrade CTA present', ctaVisible)

  const badge = await page.locator('.role-badge, [class*="role"]').first().innerText().catch(() => '(no badge found)')
  console.log(`INFO — header role badge text: ${JSON.stringify(badge)}`)
  const govtLeak = await page.getByText('Govt Admin', { exact: true }).count()
  step('no "Govt Admin" dressing leak', govtLeak === 0, `${govtLeak} occurrence(s)`)

  await page.screenshot({ path: 'org-trial-surface-node-home.png', fullPage: false })

  if (ctaVisible) {
    await cta.click()
    await page.waitForTimeout(2500)
    const url = page.url()
    step('CTA lands on /org/upgrade', url.includes('/org/upgrade'), url)
    const upgradeBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)
    const hasPlanUi = /upgrade|per seat|month|annual|premium/i.test(upgradeBody)
    step('upgrade surface shows plan content', hasPlanUi, upgradeBody.slice(0, 200))
    await page.screenshot({ path: 'org-trial-surface-upgrade.png', fullPage: false })
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`)
  process.exitCode = failed.length ? 1 : 0
} finally {
  await browser.close()
}
