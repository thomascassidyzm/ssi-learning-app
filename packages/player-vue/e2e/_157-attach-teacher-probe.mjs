// #157 live probe, part 2 — attach a teacher to the teacherless class using
// the EXISTING mechanism (invite a person as Teacher, then "Assign to a
// class" from the teachers lens). Nothing new was built for this half; the
// point of the probe is that the teacherless class is a first-class target
// for the flow that already works.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = process.env.SUPABASE_ANON_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const NODE = '5173cc61-ee87-4437-8b6c-b04d9f782e8d'
const EMAIL = 'zz-probe-147-1788786910@ssi-probe.test'
const CLASS_ID = process.env.CLASS_ID
const CLASS_NAME = process.env.CLASS_NAME
const TEACHER = process.env.TEACHER_NAME || `ZZ 157 Teacher ${Date.now().toString().slice(-5)}`
const OUT = '/home/tomcassidy/probe-157'
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const db = async (path) => (await fetch(`${U}/rest/v1/${path}`, { headers: H })).json()

const link = await (await fetch(`${U}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: `${BASE}/org/${NODE}` } }),
})).json()
const verified = await (await fetch(`${U}/auth/v1/verify`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
})).json()
const session = {
  access_token: verified.access_token, refresh_token: verified.refresh_token,
  expires_in: verified.expires_in, expires_at: Math.floor(Date.now()/1000) + (verified.expires_in || 3600),
  token_type: 'bearer', user: verified.user,
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
await page.addInitScript(([k, s]) => window.localStorage.setItem(k, JSON.stringify(s)),
  ['sb-swfvymspfxmnfhevgdkg-auth-token', session])
await page.goto(`${BASE}/org/${NODE}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)

// 1. Invite a teacher — the ordinary named-invite verb.
await page.getByRole('button', { name: 'Invite a person', exact: true }).first().click()
await page.waitForTimeout(1200)
await page.locator('[data-walk="invite-form-role"]').selectOption('teacher')
await page.locator('input[placeholder="Their name"]').fill(TEACHER)
await page.locator('[data-walk="invite-form-submit"]').click()
await page.waitForTimeout(5000)
await shot(page, '7-teacher-invited')

// 2. The school's staff list → "Assign to a class" on that teacher's row.
await page.goto(`${BASE}/schools/teachers`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await shot(page, '8-teachers-lens')
const row = page.locator('[data-walk="teacher-assign-classes"]')
console.log('assign buttons:', await row.count())
await row.first().click()
await page.waitForTimeout(2500)
await shot(page, '9-assign-modal')

// 3. Tick the teacherless class and save.
const item = page.locator('[data-walk="assign-classes-list"] li', { hasText: CLASS_NAME })
console.log('class row in modal:', await item.count())
await item.first().locator('input[type="checkbox"]').check()
await page.locator('[data-walk="assign-classes-save"]').click()
await page.waitForTimeout(5000)
await shot(page, '10-assigned')

const tags = await db(`user_tags?select=user_id,tag_value,role_in_context,removed_at&tag_value=eq.CLASS:${CLASS_ID}`)
const cls = await db(`classes?select=id,class_name,teacher_user_id&id=eq.${CLASS_ID}`)
console.log('class tags:', JSON.stringify(tags))
console.log('class row:', JSON.stringify(cls))
fs.writeFileSync(`${OUT}/attach-result.json`, JSON.stringify({ tags, cls, teacher: TEACHER }, null, 2))
await browser.close()
