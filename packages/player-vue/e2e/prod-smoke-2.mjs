// Focused pass 2: real learner audio start + admin drill programme->region->school->class + insights.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
const BASE = 'https://saysomethingin.app'
const SHOTS = '/tmp/prod-smoke/shots'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })

// A) learner audio — click the round play button
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__audioPlays = []
    const orig = Audio.prototype.play
    Audio.prototype.play = function (...a) { window.__audioPlays.push(this.src || '(nosrc)'); return orig.apply(this, a) }
  })
  page.on('pageerror', (e) => console.log('LEARNER PAGE ERROR:', e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3000)
  // the round play control sits bottom-center of the nav bar
  await page.mouse.click(195, 796)
  await page.waitForTimeout(9000)
  const plays = await page.evaluate(() => window.__audioPlays).catch(() => [])
  console.log('audio plays after click:', plays.length, plays.slice(0, 3))
  await page.screenshot({ path: `${SHOTS}/04-learner-audio-started.png` })
  const body = (await page.textContent('body').catch(() => '')) || ''
  console.log('streak on player screen:', /streak/i.test(body))
  await ctx.close()
}

// B) admin drill + insights
const URL_SB = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'thomas.cassidy+admin001@gmail.com' })
const { data: v } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(v.session)])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('ADMIN PAGE ERROR:', e.message))
  await page.goto(`${BASE}/admin/schools/2db4ca40-75b2-4380-9d5d-a64f0503d0e6`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  const drillRow = async (label, shot) => {
    const t = Date.now()
    const row = page.locator(`text=${label}`).first()
    await row.click({ timeout: 6000 })
    await page.waitForTimeout(2500)
    console.log(shot, 'ms:', Date.now() - t, 'url:', page.url())
    await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: false })
  }
  try {
    await drillRow('Coastal Districts Region', '12-node-region')
    // pick first school row under the region: click first "→" row arrow area — use the below-this list rows
    const schoolRow = page.locator('.below-this tr, [class*="below"] tr, tbody tr').first()
    const schoolName = (await schoolRow.textContent().catch(() => ''))?.replace(/\s+/g, ' ').slice(0, 60)
    console.log('first school row:', schoolName)
    await schoolRow.click({ timeout: 6000 })
    await page.waitForTimeout(2500)
    console.log('13-node-school url:', page.url())
    await page.screenshot({ path: `${SHOTS}/13-node-school.png` })
    const classRow = page.locator('tbody tr').first()
    console.log('first class row:', (await classRow.textContent().catch(() => ''))?.replace(/\s+/g, ' ').slice(0, 60))
    await classRow.click({ timeout: 6000 })
    await page.waitForTimeout(2500)
    console.log('14-node-class url:', page.url())
    await page.screenshot({ path: `${SHOTS}/14-node-class.png` })
  } catch (e) { console.log('drill error:', e.message.slice(0, 120)) }

  // insights from wherever we are
  try {
    const t = Date.now()
    await page.locator('button:has-text("See insights"), a:has-text("See insights"), button:has-text("Insights")').first().click({ timeout: 5000 })
    await page.waitForTimeout(4000)
    console.log('insights ms:', Date.now() - t, 'url:', page.url())
    await page.screenshot({ path: `${SHOTS}/17-insights.png`, fullPage: true })
    const body = (await page.textContent('body').catch(() => '')) || ''
    console.log('window chips:', /7 days|30 days|7d|30d|this week|term/i.test(body), '| display names sniff:', body.replace(/\s+/g, ' ').slice(0, 260))
  } catch (e) { console.log('insights error:', e.message.slice(0, 120)) }
  await ctx.close()
}
await browser.close()
console.log('pass 2 done')
