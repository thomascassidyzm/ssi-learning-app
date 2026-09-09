import { chromium } from '@playwright/test'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(() => {
  localStorage.setItem('ssi-last-course', 'ita_for_eng')
  localStorage.setItem('ssi_learning_position_ita_for_eng', JSON.stringify({
    legoId: 'S0003L01', seedId: 'S0003', seedNumber: 3, cycleId: null,
    itemInRound: 0, lastUpdated: Date.now(), courseCode: 'ita_for_eng',
  }))
})
await page.goto('http://localhost:5173/?course=ita_for_eng', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
const b = page.locator('.center-btn').first(); if (await b.count()) await b.click().catch(()=>{})
for (let i = 1; i <= 6; i++) {
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `/tmp/come-round-${i}.png` })
}
await browser.close()
console.log('done')
