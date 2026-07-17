// Verify the redesigned nav on the DEPLOYED dev build with a real admin session.
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
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(v.session)])
const page = await ctx.newPage()

// 1) find a school id from the admin setup page? Query DB directly instead.
const { data: schools } = await admin.from('schools').select('id, school_name').ilike('school_name','%chepstow%').limit(5)
console.log('schools:', schools?.map(s => s.school_name))
const school = schools?.[0]

// 2) admin read-view — the founder's original complaint surface
await page.goto(`${BASE}/admin/schools/${school.id}`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)
const pill = await page.locator('.app-escape').count()
console.log('app-escape pill on read-view =', pill)
await page.screenshot({ path: '/tmp/nav-shots/deployed-admin-readview-desktop.png', clip: { x: 0, y: 0, width: 1440, height: 260 } })
await page.setViewportSize({ width: 768, height: 900 })
await page.waitForTimeout(600)
await page.screenshot({ path: '/tmp/nav-shots/deployed-admin-readview-tablet.png', clip: { x: 0, y: 0, width: 768, height: 260 } })
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(600)
await page.screenshot({ path: '/tmp/nav-shots/deployed-admin-readview-phone.png', clip: { x: 0, y: 0, width: 390, height: 260 } })
await browser.close()
console.log('done')
