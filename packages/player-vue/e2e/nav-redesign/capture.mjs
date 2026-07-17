// Nav before/after screenshot harness — drives the dev server with the
// dev-only e2e role/context hooks (no real auth). Usage:
//   node nav-shots.mjs <outdir> <tag>   e.g. node nav-shots.mjs docs/redesign before
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5173'
const [, , outdir = '/tmp/nav-shots', tag = 'before'] = process.argv
mkdirSync(outdir, { recursive: true })

const WIDTHS = [
  ['desktop', 1440, 900],
  ['tablet', 768, 900],
  ['phone', 390, 844],
]

const SCHOOL_NAME = 'Ysgol Gyfun Gymraeg Bro Morgannwg Caerdydd'

async function setPersona(page, { platform, educational, schoolName }) {
  await page.evaluate(([p, e, s]) => {
    window.__setSchoolsE2ERole(p, e)
    if (s) {
      window.__setSchoolsE2EUser({
        user_id: 'e2e-user-1',
        learner_id: 'e2e-learner-1',
        display_name: 'Sian Morgan',
        educational_role: e,
        platform_role: p,
        school_name: s,
      })
    }
  }, [platform, educational, schoolName])
}

const browser = await chromium.launch()
const scenarios = [
  {
    name: 'schools-teacher',
    url: '/schools',
    persona: { platform: null, educational: 'teacher', schoolName: SCHOOL_NAME },
    waitFor: '.schools-topbar',
  },
  {
    name: 'schools-admin',
    url: '/schools',
    persona: { platform: null, educational: 'school_admin', schoolName: SCHOOL_NAME },
    waitFor: '.schools-topbar',
  },
  {
    name: 'admin-setup',
    url: '/admin/structure',
    persona: { platform: 'ssi_admin', educational: null, schoolName: null },
    waitFor: '.admin-topbar',
  },
]

for (const sc of scenarios) {
  for (const [label, w, h] of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    // Prime hooks before app boot decisions: load root first, set, then navigate.
    await page.goto(BASE + sc.url, { waitUntil: 'domcontentloaded' })
    await setPersona(page, sc.persona)
    await page.goto(BASE + sc.url, { waitUntil: 'networkidle' }).catch(() => {})
    await setPersona(page, sc.persona)
    await page.waitForSelector(sc.waitFor, { timeout: 15000 }).catch((e) => {
      console.log(`WARN ${sc.name}@${label}: ${e.message.split('\n')[0]}`)
    })
    await page.waitForTimeout(800)
    const file = `${outdir}/${tag}-${sc.name}-${label}.png`
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: Math.min(h, 360) } })
    console.log('wrote', file)
    await page.close()
  }
}
await browser.close()
