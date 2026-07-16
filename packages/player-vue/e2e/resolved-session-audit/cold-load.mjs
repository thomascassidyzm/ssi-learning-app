// Founder-priority bug-class regression: fresh-incognito, DIRECT-URL cold
// loads for every surface named in the fix brief. Each context has a real
// Supabase session in localStorage (so the app knows WHO is signed in) but
// NO role cache (`ssi-user-role`) — exactly the race the shared
// resolved-session gate exists to close. A pass means: the page settles on
// the requested route (or an intentional, documented redirect) with real
// content visible — never a bounce to the bare player, and never stuck on
// "Loading..." forever.
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const sessions = JSON.parse(readFileSync(new URL('./sessions.json', import.meta.url)))
const GOVT_GROUP_ID = 'ba23682c-6de8-4981-b479-258c4499adf4'

async function launch(role) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  await ctx.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value)
  }, ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sessions[role])])
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  return { browser, page, errors }
}

async function attempt(role, path, expect) {
  const { browser, page, errors } = await launch(role)
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1500) // let async resolution + any corrective redirect settle
    const finalPath = new URL(page.url()).pathname
    const selectorOk = expect.selector
      ? await page.locator(expect.selector).first().isVisible().catch(() => false)
      : true
    const pathOk = expect.pathIn ? expect.pathIn.includes(finalPath) : finalPath === path
    const ok = pathOk && selectorOk
    return { ok, finalPath, selectorOk, errors }
  } finally {
    await browser.close()
  }
}

const CASES = [
  { role: 'teacher', path: '/schools', expect: { pathIn: ['/schools'], selector: '.schools-container, .schools-dashboard, main' } },
  { role: 'school_admin', path: '/schools', expect: { pathIn: ['/schools'], selector: '.schools-container, .schools-dashboard, main' } },
  { role: 'govt_admin', path: '/schools', expect: { pathIn: ['/schools'], selector: '.schools-container, .schools-dashboard, main' } },
  { role: 'teacher', path: '/schools/analytics', expect: { pathIn: ['/schools/analytics'], selector: '.tiv-scroll, main' } },
  { role: 'school_admin', path: '/schools/analytics', expect: { pathIn: ['/schools/analytics'], selector: '.tiv-scroll, main' } },
  { role: 'school_admin', path: '/schools/upgrade', expect: { pathIn: ['/schools/upgrade'], selector: '.upgrade-cta, .upgrade-page' } },
  { role: 'ssi_admin', path: '/admin/users', expect: { pathIn: ['/admin/users'], selector: '.admin-main, main' } },
  { role: 'ssi_admin', path: '/admin/stats', expect: { pathIn: ['/admin/stats'], selector: '.admin-main, main' } },
  { role: 'ssi_admin', path: '/admin/demo-schools', expect: { pathIn: ['/admin/demo-schools'], selector: '.admin-main, main' } },
  { role: 'ssi_admin', path: `/admin/groups/${GOVT_GROUP_ID}`, expect: { pathIn: [`/admin/groups/${GOVT_GROUP_ID}`], selector: '.schools-container, main' } },
]

const RUNS = 3
let allGreen = true
for (const c of CASES) {
  const results = []
  for (let i = 0; i < RUNS; i++) {
    results.push(await attempt(c.role, c.path, c.expect))
  }
  const passCount = results.filter((r) => r.ok).length
  const line = `${passCount}/${RUNS} ${c.role.padEnd(12)} ${c.path}`
  if (passCount < RUNS) {
    allGreen = false
    console.log('FAIL ' + line)
    results.forEach((r, i) => console.log(`  run${i + 1}: finalPath=${r.finalPath} selectorOk=${r.selectorOk} consoleErrors=${JSON.stringify(r.errors.slice(0, 3))}`))
  } else {
    console.log('PASS ' + line)
  }
}
console.log(allGreen ? '\nALL GREEN' : '\nSOME FAILURES — see above')
process.exit(allGreen ? 0 : 1)
