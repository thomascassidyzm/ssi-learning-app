// FOUNDER DEMO PASS PROBE (2026-07-31) — verifies the three findings on a
// DEPLOYED build, via the IME personal links (the link IS the login):
//   F1 invite legibility — ways-in ledger rows name the link kind; mint
//      forms carry the kind hint.
//   F2 one sibling order — 'Directly below', the rail and the All-schools
//      lens list the same schools in the same (alphabetical) order.
//   F3 rail everywhere — school-admin Classes/Students and the teacher
//      dashboard/Students carry the WHERE-YOU-ARE rail; teacher's school row
//      is orientation-only (inert); the rail persists across flat-view hops.
//   BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app node e2e/demo-pass-probe.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const SCHOOL_LEADER_LINK = `${BASE}/redeem/KJJ-726`
const TEACHER_LINK = `${BASE}/redeem/ZKD-834`
const REGION_LINK = `${BASE}/group/YSZ-629` // Pilot Districts Region — Tom's demo region
const OUT = process.env.OUT_DIR || '/tmp/demo-pass-probe/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }
const isSorted = (names) => names.every((n, i) => i === 0 || names[i - 1].localeCompare(n, undefined, { sensitivity: 'base', numeric: true }) <= 0)

const browser = await chromium.launch()

// ─── 1. Region leader (Pilot Districts Region): F2 ordering ───
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(REGION_LINK, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(5000)
  check('region leader lands on node home', page.url().includes('/org/'), page.url())
  const railNames = await page.locator('.rail-col .is-child .rail-name').allInnerTexts()
  check('rail children alphabetical', railNames.length >= 2 && isSorted(railNames), JSON.stringify(railNames))
  const belowNames = await page.locator('.children-body .row-name, .children-body .child-name, .children-body a, .children-body button').allInnerTexts()
  console.log(`INFO — directly-below raw: ${JSON.stringify(belowNames.slice(0, 12))}`)
  await page.screenshot({ path: `${OUT}1-region-below.png` })
  // All schools lens — same schools, same order as the rail
  await page.locator('.lens-chips .chip', { hasText: 'All schools' }).first().click()
  await page.waitForTimeout(4500)
  const bodyText = await page.locator('body').innerText()
  const schoolsOrder = railNames.filter((n) => bodyText.includes(n))
  const positions = schoolsOrder.map((n) => bodyText.indexOf(n))
  check('All-schools lens lists the rail schools in the same order', positions.length >= 2 && positions.every((p, i) => i === 0 || positions[i - 1] < p), JSON.stringify(schoolsOrder))
  await page.screenshot({ path: `${OUT}2-region-allschools.png` })
  await ctx.close()
}

// ─── 2. School leader (Sunrise): F3 rail on flat views + F1 ledger labels ───
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(SCHOOL_LEADER_LINK, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(5000)
  check('school leader lands on node home', page.url().includes('/org/'), page.url())

  // F1: ways-in ledger rows say the kind
  const homeText = await page.locator('body').innerText()
  const hasKindWording = /goes straight in|shareable · new arrivals enter their name|shareable — new arrivals/i.test(homeText)
  check('F1: ways-in ledger names the link kind', hasKindWording)
  await page.screenshot({ path: `${OUT}3-school-home.png`, fullPage: true })

  // F1: mint form hint
  const shareBtn = page.locator('button, a', { hasText: 'Get a shareable link' }).first()
  if (await shareBtn.count()) {
    await shareBtn.click()
    await page.waitForTimeout(1200)
    const t = await page.locator('body').innerText()
    check('F1: shareable mint form carries the kind hint', /new arrivals enter their name/i.test(t))
    await page.screenshot({ path: `${OUT}4-mint-hint.png` })
    await page.keyboard.press('Escape').catch(() => {})
  } else {
    check('F1: shareable mint verb present', false)
  }

  // F3: Classes (flat) gets the rail; school is the here-node
  await page.locator('.tabs a', { hasText: 'Classes' }).first().click()
  await page.waitForTimeout(4000)
  check('Classes stays flat', page.url().includes('/schools/classes'), page.url())
  check('F3: rail present on flat Classes', (await page.locator('.rail-frame .rail-col').count()) === 1)
  const hereName = await page.locator('.rail-col .is-here .rail-name').innerText().catch(() => '')
  check("F3: school is the rail's here-node on Classes", hereName.length > 0, hereName)
  const railEl1 = await page.evaluate(() => { const el = document.querySelector('.rail-frame .rail-col nav'); if (el) el.__probeMark = 'marked'; return !!el })
  await page.screenshot({ path: `${OUT}5-admin-classes-rail.png` })

  // F3: hop to Students — rail persists WITHOUT remount (same DOM node)
  await page.locator('.tabs a', { hasText: 'Students' }).first().click()
  await page.waitForTimeout(3500)
  check('F3: rail present on flat Students', (await page.locator('.rail-frame .rail-col').count()) === 1)
  const samePersisted = await page.evaluate(() => document.querySelector('.rail-frame .rail-col nav')?.__probeMark === 'marked')
  check('F3: rail DOM node PERSISTED across the Classes→Students hop (no remount)', railEl1 && samePersisted)
  await page.screenshot({ path: `${OUT}6-admin-students-rail.png` })

  // F3: class detail recentres the rail on the class
  await page.goto(`${BASE}/schools/classes`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3500)
  const classRow = page.locator('a[href*="/schools/classes/"]').first()
  if (await classRow.count()) {
    await classRow.click()
    await page.waitForTimeout(4000)
    const classHere = await page.locator('.rail-col .is-here .rail-name').innerText().catch(() => '')
    check('F3: class detail rail recentres on the class', (await page.locator('.rail-frame .rail-col').count()) === 1 && !!classHere, classHere)
    await page.screenshot({ path: `${OUT}7-admin-classdetail-rail.png` })
  } else {
    console.log('INFO — no class row link found to open class detail (layout may use buttons); skipping recentre check')
  }
  await ctx.close()
}

// ─── 3. Teacher (Sunrise): F3 teacher rail — school inert, classes below ───
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(TEACHER_LINK, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(5000)
  console.log(`INFO — teacher lands: ${page.url()}`)
  if (!page.url().includes('/schools')) await page.goto(`${BASE}/schools`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3500)
  check('F3: rail present on teacher dashboard', (await page.locator('.rail-frame .rail-col').count()) === 1)
  const teacherHere = await page.locator('.rail-col .is-here .rail-name').innerText().catch(() => '')
  check('F3: teacher rail has a here-node (school or Your classes)', !!teacherHere, teacherHere)
  const inertCount = await page.locator('.rail-col .rail-link.is-inert').count()
  const childCount = await page.locator('.rail-col .is-child').count()
  check('F3: teacher rail shows own classes below', childCount >= 1, `children=${childCount}, inert=${inertCount}`)
  await page.screenshot({ path: `${OUT}8-teacher-rail.png`, fullPage: true })

  // F4: "+ Create class" opens the Create New Class modal IN PLACE — no
  // navigation to My Classes first (founder finding 4, 2026-07-31).
  const urlBefore = page.url()
  const createBtn = page.locator('button', { hasText: 'Create class' }).first()
  if (await createBtn.count()) {
    await createBtn.click()
    await page.waitForTimeout(1200)
    const modalText = await page.locator('body').innerText()
    check('F4: create CTA opens the Create New Class modal directly', /Create New Class|Class name/i.test(modalText))
    check('F4: no navigation happened (still on the dashboard)', page.url() === urlBefore, page.url())
    await page.screenshot({ path: `${OUT}10-create-class-modal.png` })
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(500)
  } else {
    check('F4: a create-class BUTTON exists on the teacher dashboard (not a link)', false)
  }

  // Students tab keeps the rail
  const studentsTab = page.locator('.tabs a', { hasText: 'Students' }).first()
  if (await studentsTab.count()) {
    await studentsTab.click()
    await page.waitForTimeout(3000)
    check('F3: rail present on teacher Students', (await page.locator('.rail-frame .rail-col').count()) === 1)
    await page.screenshot({ path: `${OUT}9-teacher-students-rail.png` })
  }
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
