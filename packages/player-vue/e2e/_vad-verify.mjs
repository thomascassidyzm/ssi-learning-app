// Live verification of the Voice & pause board on the dev deployment.
// Mints an ssi_admin session with the service key (same pattern as
// packages/player-vue/e2e/_metrics-signedin-walk.mjs), opens /admin/stats?board=vad
// and reads the rendered numbers off the served page.
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const ADMIN = 'thomas.cassidy+admin001@gmail.com'
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()

const svc = createClient(SB_URL, serviceKey)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: ADMIN })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const session = v.session
console.log('minted admin session for', ADMIN)

const dataDir = homedir() + '/.tmp-vad/profile'
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const ctx = await chromium.launchPersistentContext(dataDir, { viewport: { width: 1440, height: 1400 } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
await ctx.addInitScript(([key, sess]) => {
  localStorage.setItem(key, JSON.stringify(sess))
  localStorage.setItem('ssi-has-played', 'true')
}, [`sb-${projectRef}-auth-token`, session])

const page = ctx.pages()[0] || await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)) })

await page.goto(BASE + '/admin/stats?board=vad', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
console.log('url after load:', page.url())

const tabs = await page.locator('.board-tab-label').allInnerTexts()
console.log('board tabs:', JSON.stringify(tabs))

if (!tabs.includes('Voice & pause')) {
  console.log('NOT DEPLOYED YET — no Voice & pause tab')
  await ctx.close(); process.exit(2)
}

await page.locator('.board-tab', { hasText: 'Voice & pause' }).click().catch(() => {})
await page.waitForSelector('.vad-uptake-read', { timeout: 60000 })
await page.waitForTimeout(2000)

const school = await page.locator('.vad-select option[selected], .vad-select').first().inputValue().catch(() => '')
console.log('--- UPTAKE TILE ---')
console.log((await page.locator('.vad-uptake').innerText()).trim())
console.log('--- SCHOOL SELECTED ---', await page.locator('.vad-select').evaluate(el => el.options[el.selectedIndex]?.text).catch(() => school))
console.log('--- SCOPE CHIPS ---', (await page.locator('.vad-chip').allInnerTexts()).join(' | '))
console.log('--- FIGURE TITLES ---', (await page.locator('.fig-title, h3, h2').allInnerTexts()).slice(0, 12).join(' | '))
console.log('--- PROSODY PANEL ---')
console.log((await page.locator('.vad-metrics').innerText().catch(() => '(none)')).trim())
console.log('--- CLASS TABLE (first rows) ---')
console.log((await page.locator('table').first().innerText().catch(() => '(none)')).split('\n').slice(0, 10).join('\n'))
console.log('--- LEARNER TABLE (first rows) ---')
console.log((await page.locator('.vad-table').innerText().catch(() => '(none)')).split('\n').slice(0, 8).join('\n'))

const body = await page.locator('.vad').innerText()
console.log('--- NaN/undefined check ---', /NaN|undefined|Infinity/.test(body) ? 'FOUND: ' + body.match(/.{0,40}(NaN|undefined|Infinity).{0,40}/)[0] : 'clean')

await page.screenshot({ path: homedir() + '/.tmp-vad/vad-board.png', fullPage: true })
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none')
await ctx.close()
