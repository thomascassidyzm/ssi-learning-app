// IME invite pack (2026-07-20) — mint six role-scoped links from the IME demo
// tree on DEPLOYED dev, redeem each in a fresh incognito context, screenshot
// the capture screen + the landing surface + the account identity. Evidence
// for docs/the-view/ime-invite-pack.md.
//   node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/ime-invite-pack.mjs            (from packages/player-vue)
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/ime-invite-pack/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

// IME demo tree (discovered live 2026-07-20)
const PROGRAMME = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a' // IME Demo Programme
const REGION = 'd01926e1-b1f4-4e3f-bae5-f03f2dbe15c9' // Pilot Districts Region
const SCHOOL_NODE = '741e9b6e-9542-4ac4-9d28-e29471ceaf41' // Sunrise Public School, Pune (node)
const CLASS_JOIN = 'DEMO-IME0-3' // Grade 6A, Sunrise (registered by repair script)

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })

// Admin session for the mint API calls
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const adminToken = v.session.access_token

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

async function mint(nodeId, role) {
  const resp = await fetch(`${BASE}/api/groups/${nodeId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ role, limits: {} }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(`mint ${role}@${nodeId}: ${data.error || resp.status}`)
  return data // { code, id, url }
}

// ── Mint the six links ──
const links = {}
links.group_leader = await mint(PROGRAMME, 'leader')
links.subgroup_leader = await mint(REGION, 'leader')
links.school_leader = await mint(SCHOOL_NODE, 'school_leader')
links.teacher = await mint(SCHOOL_NODE, 'teacher')
links.student = { code: CLASS_JOIN, url: `${BASE}/redeem/${CLASS_JOIN}` }
links.learner = await mint(REGION, 'student')
// The mint API derives origin from the request host; normalise onto BASE.
for (const k of Object.keys(links)) {
  const path = links[k].url.replace(/^https?:\/\/[^/]+/, '')
  links[k].url = `${BASE}${path}`
}
console.log('LINKS:', JSON.stringify(links, null, 2))
writeFileSync(`${OUT}links.json`, JSON.stringify(links, null, 2))

const browser = await chromium.launch()
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 70, fullPage: false })

const PERSONAS = {
  group_leader: { name: 'Imogen Marsh (demo)', email: 'thomas.cassidy+ime-lead@gmail.com' },
  subgroup_leader: { name: 'Rhodri Vaughan (demo)', email: 'thomas.cassidy+ime-region@gmail.com' },
  school_leader: { name: 'Carys Puw (demo)', email: 'thomas.cassidy+ime-schoollead@gmail.com' },
  teacher: { name: 'Gethin Rees (demo)', email: 'thomas.cassidy+ime-teacher@gmail.com' },
  student: { name: 'Alys (demo)' },
  learner: { name: 'Begw (demo)' },
}

async function redeemNamed(key, expectHeadingRe, expectLandingPath) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(links[key].url, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('#redeem-name, #redeem-pupil-name', { timeout: 30000 })
  const body = await p.locator('body').innerText()
  check(`${key}: capture heading names role+place`, expectHeadingRe.test(body), body.slice(0, 200).replace(/\n/g, ' '))
  check(`${key}: no OTP input on screen`, !(await p.locator('#redeem-otp').count()))
  await shot(p, `${key}-1-capture`)

  const persona = PERSONAS[key]
  if (await p.locator('#redeem-pupil-name').count()) {
    check(`${key}: pupil form has NO email field`, !(await p.locator('#redeem-details-email').count()))
    await p.fill('#redeem-pupil-name', persona.name)
  } else {
    await p.fill('#redeem-name', persona.name)
    await p.fill('#redeem-details-email', persona.email)
  }
  await p.locator('form button[type=submit]').click()

  // Success screen (4s auto-redirect) — click Continue to move on immediately.
  await p.getByText("You're all set!", { exact: false }).or(p.getByText('ready', { exact: false })).or(p.getByText('joined', { exact: false })).first().waitFor({ timeout: 45000 }).catch(() => {})
  const cont = p.locator('button.btn--continue')
  if (await cont.count()) await cont.click()
  await p.waitForURL((u) => u.pathname.startsWith(expectLandingPath) && !u.pathname.startsWith('/redeem') && !u.pathname.startsWith('/group'), { timeout: 45000 }).catch(() => {})
  await p.waitForTimeout(5000)
  check(`${key}: lands on ${expectLandingPath}`, new URL(p.url()).pathname.startsWith(expectLandingPath), p.url())
  await shot(p, `${key}-2-landing`)

  // Identity evidence: staff shells carry the avatar user menu with the name.
  if (await p.locator('.user-trigger').count()) {
    await p.locator('.user-trigger').first().click().catch(() => {})
    await p.waitForTimeout(600)
    const shellText = await p.locator('body').innerText()
    check(`${key}: shell shows the captured name`, shellText.includes(persona.name.replace(' (demo)', '')) || shellText.includes(persona.name), '')
    await shot(p, `${key}-3-account`)
  } else {
    await shot(p, `${key}-3-account`)
  }

  // DB truth: the account is real — name + (for named roles) typed email.
  const { data: users } = await svc.auth.admin.listUsers({ perPage: 200 })
  const u = persona.email
    ? users.users.find((x) => x.email === persona.email)
    : users.users.find((x) => x.user_metadata?.display_name === persona.name)
  check(`${key}: auth account exists`, !!u, persona.email || persona.name)
  if (u) {
    if (persona.email) check(`${key}: REAL email on account (no link-uuid ghost)`, u.email === persona.email, u.email)
    check(`${key}: display_name captured`, (u.user_metadata?.display_name || '') === persona.name, u.user_metadata?.display_name)
    const { data: learner } = await svc.from('learners').select('display_name, educational_role, needs_verification').eq('user_id', u.id).maybeSingle()
    console.log(`  DB: ${key} → auth ${u.email} · learners.display_name="${learner?.display_name}" · role=${learner?.educational_role}`)
  }
  await ctx.close()
  return links[key].url
}

// ── The six redeems ──
await redeemNamed('group_leader', /invited to lead IME Demo Programme/i, '/schools')
await redeemNamed('subgroup_leader', /invited to lead Pilot Districts Region/i, '/schools')
await redeemNamed('school_leader', /help lead Sunrise Public School/i, '/schools')
await redeemNamed('teacher', /invited as a teacher at Sunrise Public School/i, '/schools')
await redeemNamed('student', /joining Grade 6A/i, '/')
await redeemNamed('learner', /joining Pilot Districts Region/i, '/')

await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
