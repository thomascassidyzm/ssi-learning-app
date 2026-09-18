// Job #202 — the two door checks the #195 proof does not assert, live on a
// deployed build: the password prompt is the first thing a new head sees, and
// Resend cools for a minute and says the earlier code stops working.
//   BASE=https://saysomethingin.app EMAIL=head@zz.test node e2e/_202-door-password-resend-prod.mjs
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const EMAIL = process.env.EMAIL
if (!EMAIL) { console.error('EMAIL is required'); process.exit(1) }
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth:{persistSession:false} })
const results = []
const check = (n, ok, d='') => { results.push({ n, ok: !!ok }); console.log(`${ok?'PASS':'FAIL'} ${n}${d?' — '+d:''}`) }
const ledger = { userId: null, schoolId: null }

const browser = await chromium.launch({ args:['--disable-gpu','--no-sandbox'], ...(process.env.PW_EXEC?{executablePath:process.env.PW_EXEC}:{}) })
const p0 = null
const p = await (await browser.newContext({ viewport:{width:1200,height:900} })).newPage()
p.on('console', (m) => { if (m.type()==='error') console.log('CONSOLE', m.text().slice(0,160)) })
p.on('response', async (r) => { if (/\/auth\/v1\/otp|\/api\/auth\//.test(r.url())) console.log('AUTH', r.url().split('supabase.co')[1]||r.url(), '->', r.status()) })
try {
  await p.goto(`${BASE}/schools1`, { waitUntil:'domcontentloaded', timeout:60000 })
  await p.waitForTimeout(6000)
  try {
    await p.locator('.fs-trigger').first().click({ timeout:5000 }); await p.waitForTimeout(600)
    const opt = p.locator('[role=option], .fs-option, .fs-opt, .fs-item, .fs-list button, .fs-menu button').first()
    if (await opt.count()) await opt.click({ timeout:5000 })
    await p.waitForTimeout(1000)
  } catch {}
  await p.locator('#ob-email').fill(EMAIL)
  await p.locator('button', { hasText:/Set up my school/ }).first().click()
  try { await p.waitForURL(u => /\/org\/|\/schools(?!1)/.test(u.toString()), { timeout:90000 }) } catch {}
  await p.waitForTimeout(8000)
  const { data: l0 } = await admin.auth.admin.generateLink({ type:'magiclink', email: EMAIL })
  ledger.userId = l0?.user?.id
  const { data: school } = await admin.from('schools').select('id').eq('admin_user_id', ledger.userId).maybeSingle()
  ledger.schoolId = school?.id
  check('door landed in the dashboard with no code typed', /\/org\/|\/schools(?!1)/.test(p.url()), p.url())

  // 1. The password step, first thing.
  const body = (await p.locator('body').innerText()).replace(/\s+/g,' ')
  const gate = await p.locator('text=/Set a password/i').count()
  check('password step is on screen at first entry', gate > 0, body.slice(0, 160))
  check('password step says why it exists', /never depends on an email getting through|A password takes ten seconds/i.test(body))
  await p.screenshot({ path:`${process.env.CS_SCRATCH}/202-password-first.png`, fullPage:true })

  // 2. Resend cooldown in the mailbox banner. Escape the password gate first.
  const notNow = p.locator('button', { hasText:/Not now|Maybe later|Close/ }).first()
  if (await notNow.count()) { await notNow.click().catch(()=>{}); await p.waitForTimeout(1500) }
  await p.keyboard.press('Escape').catch(()=>{}); await p.waitForTimeout(1500)
  const banner = p.locator('.mailbox-banner')
  check('mailbox banner is on the dashboard', await banner.count() > 0)
  const resend = banner.locator('button.mailbox-banner__link').first()
  const label0 = (await resend.innerText().catch(()=>'')).trim()
  check('Resend is offered on arrival', /Send a fresh code$/.test(label0), `label="${label0}"`)
  // Tap it: the cooldown is a property of a SEND, not of the page load.
  console.log('resend visible/enabled:', await resend.isVisible().catch(()=>null), await resend.isEnabled().catch(()=>null))
  await resend.evaluate((el) => el.click()).catch((e)=>console.log('click err', e.message))
  await p.waitForTimeout(6000)
  const st = (await banner.locator('.mailbox-banner__status').allInnerTexts().catch(()=>[])).join('|')
  console.log('RESEND STATUS:', st)
  const label1 = (await resend.innerText().catch(()=>'')).trim()
  const disabled1 = await resend.isDisabled().catch(()=>null)
  check('Resend cools down after a send', /Send a fresh code in \d+s/.test(label1) && disabled1 === true,
    `label="${label1}" disabled=${disabled1}`)
  const secs = Number((label1.match(/(\d+)s/)||[])[1] || 0)
  check('the cooldown is about a minute', secs > 40 && secs <= 60, `${secs}s left`)
  await p.waitForTimeout(5000)
  const label2 = (await resend.innerText().catch(()=>'')).trim()
  const secs2 = Number((label2.match(/(\d+)s/)||[])[1] || 0)
  check('the counter ticks down', secs2 > 0 && secs2 < secs, `${secs}s -> ${secs2}s`)
  const bannerText = (await banner.innerText().catch(()=>'')).replace(/\s+/g,' ')
  check('it says the earlier code stops working',
    /stops? working|earlier code|newest|latest code/i.test(bannerText), bannerText.slice(0,240))
  await p.screenshot({ path:`${process.env.CS_SCRATCH}/202-resend-cooldown.png`, fullPage:true })
} catch (e) { console.log('PROBE ERROR', e?.message || e) } finally {
  await browser.close()
  if (ledger.userId) { await admin.from('invite_codes').delete().eq('created_by', ledger.userId); await admin.from('possession_mint_attempts').delete().eq('email', EMAIL.toLowerCase()) }
  if (ledger.schoolId) { await admin.from('school_domain_claims').delete().eq('school_id', ledger.schoolId).then(()=>{},()=>{}); await admin.from('classes').delete().eq('school_id', ledger.schoolId); await admin.from('schools').delete().eq('id', ledger.schoolId) }
  if (ledger.userId) { await admin.from('user_tags').delete().eq('user_id', ledger.userId); await admin.from('learners').delete().eq('user_id', ledger.userId); await admin.auth.admin.deleteUser(ledger.userId).catch(()=>{}) }
  const { data: gone } = ledger.userId ? await admin.auth.admin.getUserById(ledger.userId) : { data:{ user:null } }
  const { data: sgone } = ledger.schoolId ? await admin.from('schools').select('id').eq('id', ledger.schoolId).maybeSingle() : { data:null }
  console.log('TEARDOWN: auth user gone =', !gone?.user, '; school gone =', !sgone)
  console.log('SUMMARY:', results.filter(r=>r.ok).length, '/', results.length, 'passed')
}
