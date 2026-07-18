// Verify the unified Invites surface on the DEPLOYED dev build with a real
// admin session: the three create modes, the unified list, and the redirects
// from the three retired routes. Screenshots to /tmp/invites-shots/.
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const URL_SB = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const email = 'thomas.cassidy+admin001@gmail.com'
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
console.log('admin session ok', v.session.user.id)

const BASE = 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
mkdirSync('/tmp/invites-shots', { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(v.session)])
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

async function shot(name) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `/tmp/invites-shots/${name}.png`, fullPage: false })
  console.log('shot', name, '→', page.url())
}

// 1) canonical surface, org mode (default)
await page.goto(`${BASE}/admin/invites`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)
await shot('invites-desktop-org')

// 2) direct mode + demo mode via the chips (client-side, no reload)
await page.goto(`${BASE}/admin/invites?mode=direct`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(1500)
await shot('invites-desktop-direct')
await page.goto(`${BASE}/admin/invites?mode=demo`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(1500)
await shot('invites-desktop-demo')

// 3) the unified list (scroll to it)
await page.goto(`${BASE}/admin/invites`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)
const list = page.locator('text=/invites\\s*·/i').first()
try { await list.scrollIntoViewIfNeeded({ timeout: 3000 }) } catch {}
await page.mouse.wheel(0, 700)
await shot('invites-desktop-list')

// 4) redirects from the three retired routes
for (const [from, name] of [['/admin/access', 'redirect-access'], ['/admin/demos', 'redirect-demos'], ['/admin/try-links', 'redirect-trylinks']]) {
  await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(1200)
  console.log(name, ':', from, '→', page.url())
}

// 5) mobile
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}/admin/invites`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2000)
await shot('invites-mobile-org')
await page.goto(`${BASE}/admin/invites?mode=demo`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(1500)
await shot('invites-mobile-demo')
await page.mouse.wheel(0, 900)
await shot('invites-mobile-list')

await browser.close()
console.log('done')
