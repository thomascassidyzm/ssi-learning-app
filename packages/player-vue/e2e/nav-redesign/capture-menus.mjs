import { chromium } from '@playwright/test'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch()

async function prep(page) {
  await page.goto(BASE + '/admin/setup', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => window.__setSchoolsE2ERole('ssi_admin', null))
  await page.goto(BASE + '/admin/setup', { waitUntil: 'networkidle' }).catch(() => {})
  await page.evaluate(() => window.__setSchoolsE2ERole('ssi_admin', null))
  await page.waitForSelector('.admin-topbar', { timeout: 15000 })
}

// Desktop: More menu open
let page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await prep(page)
await page.click('.tabs .nvm-trigger')
await page.waitForTimeout(400)
await page.screenshot({ path: '/tmp/nav-shots/after-admin-more-open-desktop.png', clip: { x: 700, y: 0, width: 740, height: 420 } })
await page.close()

// Tablet: collapsed menu open
page = await browser.newPage({ viewport: { width: 768, height: 900 } })
await prep(page)
await page.click('.tabs-collapsed .nvm-trigger')
await page.waitForTimeout(400)
await page.screenshot({ path: '/tmp/nav-shots/after-admin-menu-open-tablet.png', clip: { x: 300, y: 0, width: 468, height: 640 } })
await page.close()

// Phone: schools drawer open (teacher persona)
page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.goto(BASE + '/schools', { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  window.__setSchoolsE2ERole(null, 'school_admin')
  window.__setSchoolsE2EUser({
    user_id: 'e2e-user-1', learner_id: 'e2e-learner-1', display_name: 'Sian Morgan',
    educational_role: 'school_admin', platform_role: null,
    school_name: 'Ysgol Gyfun Gymraeg Bro Morgannwg Caerdydd',
  })
})
await page.waitForSelector('.schools-topbar', { timeout: 15000 })
await page.click('.nav-toggle')
await page.waitForTimeout(400)
await page.screenshot({ path: '/tmp/nav-shots/after-schools-drawer-open-phone.png', clip: { x: 0, y: 0, width: 390, height: 500 } })
await page.close()
await browser.close()
console.log('done')
