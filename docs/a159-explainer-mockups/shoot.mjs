import { chromium } from '/home/tomcassidy/wt-a123/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.mjs'
const base = 'file://' + process.cwd() + '/mockups.html'
const shots = [
  ['current', '?only=current'],
  ['a', '?only=a'],
  ['b', '?only=b'],
  ['c-collapsed', '?only=c&collapsed=1'],
  ['c-open', '?only=c'],
]
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN })
for (const [name, q] of shots) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await p.goto(base + q)
  await p.waitForTimeout(400)
  await p.screenshot({ path: `shot-${name}.png`, fullPage: true })
  await p.close()
}
const p = await b.newPage({ viewport: { width: 1560, height: 1200 }, deviceScaleFactor: 1.5 })
await p.goto(base)
await p.waitForTimeout(400)
await p.screenshot({ path: 'shot-sidebyside.png', fullPage: true })
await b.close()
console.log('ok')
