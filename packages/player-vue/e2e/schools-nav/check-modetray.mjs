// Inspect the mode tray (Offline / Listening) in play-as-class mode
// and in the staff-own Learn button flow, on a real running instance.
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const sessions = JSON.parse(readFileSync(new URL('./sessions.json', import.meta.url)))
const CLASS_ID = 'ecdbe16b-a89b-4603-a2cc-916c970bec4b' // Ang School Y7 Welsh (cym_for_eng_north)

async function launch(role) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
  await ctx.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value)
  }, ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sessions[role])])
  const page = await ctx.newPage()
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console:error]', msg.text()) })
  page.on('response', res => {
    if (res.status() >= 400) console.log(`[http ${res.status()}]`, res.url())
  })
  return { browser, page }
}

async function inspectTray(page, label) {
  // Wait for the player to actually mount + be ready
  await page.waitForSelector('.player-container .learning-player-root', { timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(3000)

  const activeCourse = await page.evaluate(() => {
    // best-effort: check for course selector / resting state
    return {
      hasLearningPlayer: !!document.querySelector('.learning-player-root'),
      hasCourseSelector: !!document.querySelector('.course-selector, .settings-overlay'),
    }
  })
  console.log(`--- ${label} --- activeCourse probe:`, JSON.stringify(activeCourse))

  const ancestorChain = await page.evaluate(() => {
    const el = document.querySelector('.bottom-nav')
    if (!el) return null
    const chain = []
    let cur = el
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur)
      chain.push({
        tag: cur.tagName, cls: (cur.className || '').toString().slice(0, 60),
        position: cs.position, zIndex: cs.zIndex, transform: cs.transform, filter: cs.filter, willChange: cs.willChange, contain: cs.contain,
      })
      cur = cur.parentElement
    }
    return chain
  })
  console.log(`${label}: ancestor chain of .bottom-nav:\n` + (ancestorChain || []).map(a => `  ${a.tag}.${a.cls} pos=${a.position} z=${a.zIndex} transform=${a.transform} filter=${a.filter} willChange=${a.willChange} contain=${a.contain}`).join('\n'))

  const triggerCount = await page.locator('.mode-trigger').count()
  const containerCount = await page.locator('.player-container').count()
  const botNavCount = await page.locator('.bottom-nav').count()
  console.log(`${label}: counts mode-trigger=${triggerCount} player-container=${containerCount} bottom-nav=${botNavCount}`)
  const trigger = page.locator('.mode-trigger').first()
  const triggerVisible = await trigger.isVisible().catch(() => false)
  console.log(`${label}: mode-trigger visible = ${triggerVisible}`)
  if (!triggerVisible) return

  await trigger.click()
  await page.waitForTimeout(400)

  const items = await page.locator('.tray-item').all()
  for (const item of items) {
    const name = await item.locator('.tray-name').textContent().catch(() => '?')
    const cls = await item.getAttribute('class')
    const disabled = await item.getAttribute('disabled')
    const opacity = await item.evaluate(el => getComputedStyle(el).opacity)
    const pointerEvents = await item.evaluate(el => getComputedStyle(el).pointerEvents)
    console.log(`${label}: item="${name?.trim()}" class="${cls}" disabled=${disabled} opacity=${opacity} pointerEvents=${pointerEvents}`)
  }

  // The Turbo row (and its exposed `turboActive` state) went with Turbo,
  // retired 2026-08-06. The tray's live rows are enumerated above; there is
  // no mode row left here to drive, so this probe is inspection-only.

  await page.screenshot({ path: `/tmp/modetray-${label.replace(/\W+/g, '_')}.png` })
}

// 1. Play-as-class as teacher
{
  const { browser, page } = await launch('teacher')
  await page.goto(BASE + `/schools/classes/${CLASS_ID}`)
  await page.waitForSelector('main.detail', { timeout: 20000 })
  const detailBtn = page.locator('.btn-play-lg', { hasText: /Play as class/ }).first()
  await detailBtn.waitFor({ state: 'visible', timeout: 15000 })
  await detailBtn.click()
  await page.waitForURL(/\/schools\/play\?class=/, { timeout: 15000 })
  await inspectTray(page, 'class-mode-teacher')
  await browser.close()
}

// 2. Staff-own Learn button (teacher's personal learning, not class)
{
  const { browser, page } = await launch('teacher')
  await page.goto(BASE + '/schools')
  await page.waitForTimeout(2000)
  const learnBtn = page.locator('a, button', { hasText: /^Learn$/ }).first()
  const hasLearnBtn = await learnBtn.count()
  console.log(`staff-learn: Learn button count = ${hasLearnBtn}`)
  if (hasLearnBtn) {
    const href = await learnBtn.getAttribute('href').catch(() => null)
    console.log('staff-learn: href =', href)
    await learnBtn.click()
    await page.waitForTimeout(3000)
    console.log('staff-learn: url after click =', page.url())
    await inspectTray(page, 'staff-own-learn')
  }
  await browser.close()
}

// 3. Baseline: normal solo learner path (non-schools) for comparison
{
  const { browser, page } = await launch('teacher')
  await page.goto(BASE + '/')
  await page.waitForTimeout(3000)
  await inspectTray(page, 'solo-learner-baseline')
  await browser.close()
}
