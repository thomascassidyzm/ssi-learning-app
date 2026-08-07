// Probe: what language options does the /schools1 heritage picker offer?
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-gpu', '--disable-dev-shm-usage'] })
const p = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage()
await p.goto('https://saysomethingin.app/schools1', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(6000)
await p.locator('button.ob-known').click()
await p.waitForTimeout(1500)
const opts = await p.locator('.ob-known-opt').allInnerTexts()
console.log('OPTIONS:', JSON.stringify(opts, null, 1))
await browser.close()
