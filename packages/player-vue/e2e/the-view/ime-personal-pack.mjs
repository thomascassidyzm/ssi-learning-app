// IME PERSONAL pack (species 1) — 2026-07-20. Mint six PRE-PROVISIONED
// personal links from the IME demo tree on the deployed build, then verify
// each in a fresh incognito context: NO dialog of any kind, straight to the
// role surface, repeatable on a second click. Screenshots: landing per role.
//   BASE_URL=<deployment> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/ime-personal-pack.mjs         (from packages/player-vue)
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/ime-invite-pack/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const PROGRAMME = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a' // IME Demo Programme
const REGION = 'd01926e1-b1f4-4e3f-bae5-f03f2dbe15c9' // Pilot Districts Region
const SCHOOL_NODE = '741e9b6e-9542-4ac4-9d28-e29471ceaf41' // Sunrise Public School, Pune
const CLASS_ID = 'e2bbe2de-cada-4aed-908a-4b36d26ca95c' // Grade 6A (eng_for_hin)

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })

const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const adminToken = v.session.access_token

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

async function mintPersonal(nodeId, role, name, classId) {
  const resp = await fetch(`${BASE}/api/groups/${nodeId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ role, limits: {}, personal: { name, ...(classId ? { class_id: classId } : {}) } }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(`mint personal ${role}@${nodeId}: ${data.error || resp.status}`)
  return data // { code, url, account }
}

const SPECS = [
  ['programme_leader', PROGRAMME, 'leader', 'IME Programme Leader', null, '/schools'],
  ['region_leader', REGION, 'leader', 'IME Region Leader', null, '/schools'],
  ['school_leader', SCHOOL_NODE, 'school_leader', 'IME School Leader', null, '/schools'],
  ['teacher', SCHOOL_NODE, 'teacher', 'IME Teacher', null, '/schools'],
  ['student', SCHOOL_NODE, 'student', 'IME Student', CLASS_ID, '/'],
  ['learner', REGION, 'student', 'IME Learner', null, '/'],
]

const links = {}
for (const [key, node, role, name, classId] of SPECS) {
  links[key] = await mintPersonal(node, role, name, classId)
  console.log(`MINTED ${key}: ${links[key].code} → ${links[key].account?.email}`)
}
writeFileSync(`${OUT}personal-links.json`, JSON.stringify(links, null, 2))

const browser = await chromium.launch()
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 70, fullPage: false })

async function clickThrough(key, url, landingPath, name, secondPass = false) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  let sawDialog = false
  const dialogSelectors = '#redeem-name, #redeem-pupil-name, #redeem-details-email, #redeem-email, #redeem-otp, .redeem-card form'
  const watcher = setInterval(async () => {
    try { if (await p.locator(dialogSelectors).count()) sawDialog = true } catch { /* page nav */ }
  }, 300)
  await p.goto(url, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForURL((u) => u.pathname === landingPath || (landingPath === '/schools' && u.pathname.startsWith('/schools')), { timeout: 45000 }).catch(() => {})
  await p.waitForTimeout(landingPath === '/' ? 8000 : 5000)
  clearInterval(watcher)
  const tag = secondPass ? ' (2nd click)' : ''
  check(`${key}${tag}: ZERO dialog — no form ever rendered`, !sawDialog)
  const path = new URL(p.url()).pathname
  check(`${key}${tag}: lands on ${landingPath}`, landingPath === '/' ? path === '/' : path.startsWith(landingPath), p.url())
  if (!secondPass) {
    const body = await p.locator('body').innerText().catch(() => '')
    if (landingPath === '/schools') check(`${key}: shell shows "${name}"`, body.includes(name), '')
    if (key === 'student') check('student: player is on the CLASS course (English for Hindi speakers)', /for Hindi speakers/i.test(body), body.match(/for [A-Za-z]+ speakers/)?.[0] || '')
    await shot(p, `p-${key}-landing`)
  }
  await ctx.close()
}

for (const [key, , , name, , landing] of SPECS) {
  await clickThrough(key, links[key].url, landing, name)
}
// Repeatability: second fresh-context click on two representative links.
await clickThrough('programme_leader', links.programme_leader.url, '/schools', 'IME Programme Leader', true)
await clickThrough('student', links.student.url, '/', 'IME Student', true)

// Revocability: revoke a throwaway personal link and confirm it fails friendly.
{
  const throwaway = await mintPersonal(REGION, 'teacher', 'IME Revoke Test', null)
  await svc.from('invite_codes').update({ is_active: false }).eq('code', throwaway.code)
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(`${BASE}/redeem/${throwaway.code}`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(4000)
  const body = await p.locator('body').innerText().catch(() => '')
  check('revoked personal link fails friendly (no session, invalid message)', /invalid|no longer|expired/i.test(body), body.slice(0, 120))
  check('revoked personal link does NOT land on a dashboard', !new URL(p.url()).pathname.startsWith('/schools'), p.url())
  await ctx.close()
}

await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
