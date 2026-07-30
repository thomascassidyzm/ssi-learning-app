// Screenshot the play-as-class identity fix on the DEPLOYED dev build.
// Founder critique (2026-07-18): play-as-class named the school + teacher +
// section chrome, but never WHICH class is live. Updated 2026-07-30 (founder:
// the big banner was obtrusive; the nav must persist): the class identity is
// now a SLIM chip inside the bar ("Playing as …"), school demoted, the
// section tabs KEPT, Learn dropped, exit obvious — persistent above the player.
//
// Run: node shoot-playasclass-identity.mjs   (needs sessions.json from
// mint-sessions.mjs; targets the dev alias unless BASE_URL is set).
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const sessions = JSON.parse(readFileSync(new URL('./sessions.json', import.meta.url)))
const OUT = new URL('../../../../docs/navbar-redesign/img/', import.meta.url)
const CLASS_ID = 'ecdbe16b-a89b-4603-a2cc-916c970bec4b' // Ang School Y7 Welsh (cym_n_for_eng)

const results = []
const check = (label, ok, extra = '') => {
  results.push([label, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`)
}

async function shoot(role, viewport, tag) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  await ctx.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value)
  }, ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sessions[role])])
  const page = await ctx.newPage()

  // Launch play-as-class the way a teacher does: from ClassDetail.
  await page.goto(BASE + `/schools/classes/${CLASS_ID}`)
  await page.waitForSelector('.detail', { timeout: 25000 })
  const detailBtn = page.locator('.btn-play-lg', { hasText: /Play as class/ }).first()
  await detailBtn.waitFor({ state: 'visible', timeout: 15000 })
  await detailBtn.click()
  await page.waitForURL(/\/schools\/play\?class=/, { timeout: 15000 })

  // The new identity element must render with the class name.
  const pac = page.locator('.pac-class').first()
  await pac.waitFor({ state: 'visible', timeout: 15000 })
  const name = (await pac.textContent())?.trim()
  check(`${role}/${tag}: bar names the class`, !!name, name)
  check(`${role}/${tag}: exit affordance present`, await page.locator('.pac-exit').isVisible())
  check(`${role}/${tag}: section tabs KEPT (nav persists in the player)`, (await page.locator('.schools-topbar nav.tabs').count()) === 1)

  // Let the player settle so the shot shows the bar sitting above a live player.
  await page.waitForSelector('.player-container', { timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: new URL(`addendum-playasclass-${tag}.png`, OUT).pathname })
  console.log(`  shot addendum-playasclass-${tag}.png`)
  await browser.close()
}

await shoot('teacher', { width: 1280, height: 800 }, 'desktop')
await shoot('teacher', { width: 390, height: 844 }, 'phone')

const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
