// Inspect the mode tray (Turbo / Offline / Listening) in play-as-class mode
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

  // Try clicking Turbo and see if state actually changes
  const turboItem = page.locator('.tray-item', { hasText: 'Turbo' }).first()
  if (await turboItem.count()) {
    const beforeClass = await turboItem.getAttribute('class')
    const beforeIcon = await page.locator('.mode-trigger').first().getAttribute('class')
    await turboItem.click({ timeout: 5000 }).catch(e => console.log(`${label}: turbo NON-FORCE click error:\n`, e.message))
    await page.waitForTimeout(200)
    const midIcon = await page.locator('.mode-trigger').first().getAttribute('class')
    const exposedState = await page.evaluate(() => {
      const root = document.querySelector('.player-container')
      if (!root) return { found: false, reason: 'no .player-container' }
      const seen = new Set()
      const names = []
      // BFS through the component tree via subTree/component links
      function walk(inst, depth) {
        if (!inst || seen.has(inst) || depth > 12) return null
        seen.add(inst)
        names.push(inst.type?.__name || inst.type?.name || '?')
        if (inst.exposed && 'turboActive' in inst.exposed) return inst
        // children via subTree
        const kids = []
        const collect = (vnode) => {
          if (!vnode) return
          if (vnode.component) kids.push(vnode.component)
          if (Array.isArray(vnode.children)) vnode.children.forEach(c => { if (c && c.component) kids.push(c.component); if (c && c.children) collect(c) })
          else if (vnode.children && vnode.children.component) kids.push(vnode.children.component)
        }
        collect(inst.subTree)
        for (const k of kids) {
          const r = walk(k, depth + 1)
          if (r) return r
        }
        return null
      }
      const startInst = root.__vueParentComponent
      if (!startInst) return { found: false, reason: 'no __vueParentComponent on .player-container' }
      const found = walk(startInst, 0)
      if (found) {
        const ta = found.exposed.turboActive
        return { found: true, turboActive: ta && 'value' in ta ? ta.value : ta, names }
      }
      return { found: false, names }
    })
    console.log(`${label}: exposedState after click =`, JSON.stringify(exposedState))
    await page.waitForTimeout(400)
    // reopen tray since click closes it
    const triggerNow = page.locator('.mode-trigger').first()
    if (await triggerNow.isVisible().catch(() => false)) {
      await triggerNow.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(300)
      const afterItem = page.locator('.tray-item', { hasText: 'Turbo' }).first()
      const afterClass = await afterItem.getAttribute('class').catch(() => null)
      console.log(`${label}: turbo click beforeIcon="${beforeIcon}" midIcon="${midIcon}" before="${beforeClass}" after="${afterClass}"`)
    }
  }

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
