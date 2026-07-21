// Reproduce the schools nav rendering bugs in a real headless Chromium:
//  (A) incoming page stacks BELOW the leaving one during the crossfade,
//      then snaps up when the old page unmounts (bottom-load-then-jump)
//  (B) container scroll position carries over between tabs (page doesn't
//      render "in place, scrolled to top")
//  (C) intermittent white page on tab switches
// Usage: node repro-nav.mjs <role> [cycles]   (role: school_admin|teacher|govt_admin)

import { readFileSync } from 'node:fs'

import { chromium } from '@playwright/test'

const role = process.argv[2] || 'school_admin'
const cycles = Number(process.argv[3] || 6)
const BASE = process.env.BASE_URL || 'http://localhost:4173'
const sessions = JSON.parse(readFileSync(new URL('./sessions.json', import.meta.url)))
const session = sessions[role]
if (!session) throw new Error(`no session for ${role}`)

const TABS = {
  school_admin: [
    ['/schools', '.dashboard-view'],
    ['/schools/classes', 'main.dashboard'],
    ['/schools/students', 'main.students'],
    ['/schools/teachers', 'main.teachers'],
    ['/schools/analytics', '.tiv-root'],
    ['/schools/settings', 'main.settings-screen'],
  ],
  teacher: [
    ['/schools', '.dashboard-view'],
    ['/schools/students', 'main.students'],
    ['/schools/analytics', '.tiv-root'],
  ],
  govt_admin: [
    ['/schools/all', 'main.schools-list-screen'],
    ['/schools/analytics', '.tiv-root'],
  ],
}[role]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(([key, value]) => {
  window.localStorage.setItem(key, value)
  // Minimal devtools hook stub: capture the app instance at app:init so the
  // harness can interrogate router/component state from outside.
  window.__VUE_DEVTOOLS_GLOBAL_HOOK__ = {
    enabled: true,
    events: new Map(),
    on() {}, once() {}, off() {},
    emit(event, ...args) { if (event === 'app:init') window.__VUE_APP__ = args[0] },
  }
  // Who writes the URL? Capture a stack for every history state change.
  window.__histlog = []
  for (const m of ['pushState', 'replaceState']) {
    const orig = History.prototype[m]
    History.prototype[m] = function (...a) {
      window.__histlog.push({ m, url: String(a[2] ?? ''), t: Math.round(performance.now()), stack: new Error().stack.split('\n').slice(2, 7).join(' | ') })
      return orig.apply(this, a)
    }
  }
}, ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(session)])

const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 300)))
let loadCount = 0
page.on('load', () => { loadCount++; console.log(`  [event] page LOAD #${loadCount} url=${page.url()}`) })
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`  [event] framenavigated ${f.url()}`) })

console.log(`\n=== ${role}: cold load ${TABS[0][0]} ===`)
await page.goto(BASE + TABS[0][0])
await page.waitForSelector(TABS[0][1], { timeout: 20000 })
// Router lifecycle probe (needs the devtools-hook diagnostic build).
await page.evaluate(() => {
  const app = window.__VUE_APP__
  const router = app?.config?.globalProperties?.$router
  if (!router) { window.__navlog = ['NO ROUTER']; return }
  const log = (window.__navlog = [])
  const t0 = performance.now()
  const stamp = (m) => log.push(`${Math.round(performance.now() - t0)}ms ${m}`)
  router.beforeEach((to, from) => { stamp(`beforeEach ${from.fullPath} -> ${to.fullPath}`) })
  router.afterEach((to, from, failure) => {
    stamp(`afterEach ${from.fullPath} -> ${to.fullPath} failure=${failure ? failure.type + ':' + String(failure).slice(0, 120) : 'none'} currentRoute=${router.currentRoute.value.fullPath} url=${location.pathname}`)
  })
  router.onError((err, to, from) => { stamp(`onError ${String(err).slice(0, 200)} to=${to?.fullPath} from=${from?.fullPath}`) })
})
console.log('cold load ok')

let whitePages = 0
let stackObserved = 0
let scrollCarryObserved = 0

for (let c = 0; c < cycles; c++) {
  for (let i = 0; i < TABS.length; i++) {
    const [fromPath, fromSel] = TABS[i]
    const [toPath, toSel] = TABS[(i + 1) % TABS.length]

    // Scroll the real scroll container down first (mimics the founder reading
    // a long page, then clicking a tab).
    await page.evaluate(() => {
      const el = document.querySelector('.schools-container')
      if (el) el.scrollTop = Math.min(600, el.scrollHeight - el.clientHeight)
    })
    const preScroll = await page.evaluate(() => document.querySelector('.schools-container')?.scrollTop ?? -1)

    // Click the router-link for the target. Playwright auto-waits for the
    // element — critical on the first nav after cold boot, when the tab set
    // renders only once the school context has resolved. (An earlier version
    // fell back to a raw history.pushState when the link wasn't there yet —
    // that bypasses vue-router entirely and manufactured a fake "wedge".)
    await page.locator(`.schools-topbar a[href="${toPath}"]`).first().click()

    // Sample the incoming page's position + container scroll over the
    // transition window (fade is 200ms).
    const samples = []
    for (let t = 0; t < 6; t++) {
      const s = await page.evaluate(([toSel, fromSel]) => {
        const container = document.querySelector('.schools-container')
        const incoming = document.querySelector(toSel)
        const leaving = document.querySelector(fromSel)
        return {
          scrollTop: container?.scrollTop ?? -1,
          incomingTop: incoming ? incoming.getBoundingClientRect().top : null,
          bothPresent: !!(incoming && leaving && incoming !== leaving),
        }
      }, [toSel, fromSel])
      samples.push(s)
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(700) // let everything settle

    const settled = await page.evaluate(([toSel, fromSel]) => {
      const container = document.querySelector('.schools-container')
      const el = document.querySelector(toSel)
      const text = (el?.textContent || '').trim()
      return {
        scrollTop: container?.scrollTop ?? -1,
        present: !!el,
        textLen: text.length,
        topWhenSettled: el ? el.getBoundingClientRect().top : null,
        url: location.pathname,
        leavingStillPresent: !!document.querySelector(fromSel),
        errorCard: !!document.querySelector('.schools-error-card'),
        topbar: !!document.querySelector('.schools-topbar'),
      }
    }, [toSel, fromSel])

    const stacked = samples.some((s) => s.bothPresent && s.incomingTop !== null && s.incomingTop > 700)
    if (stacked) stackObserved++
    if (preScroll > 0 && settled.scrollTop > 0) scrollCarryObserved++
    if (!settled.present || settled.textLen < 20) {
      whitePages++
      await page.screenshot({ path: `./white-${role}-c${c}-${toPath.replace(/\//g, '_')}.png` })
      // Interrogate the live app via the devtools hook (diagnostic build).
      const diag = await page.evaluate(() => {
        try {
          const app = window.__VUE_APP__
          const router = app?.config?.globalProperties?.$router
          const route = router?.currentRoute?.value
          const out = {
            appExists: !!app,
            routeFullPath: route?.fullPath,
            routeName: String(route?.name ?? ''),
            matchedComponents: route?.matched?.map((m) => m.components?.default?.name || m.components?.default?.__name || '?'),
          }
          // Walk instance tree to find the RouterView inside SchoolsContainer
          // and report what it is actually rendering + its update state.
          const walk = (inst, depth, acc) => {
            if (!inst || depth > 25 || acc.found) return
            const name = inst.type?.name || inst.type?.__name || ''
            if (name === 'SchoolsContainer') acc.container = true
            if (acc.container && (inst.type?.name === 'RouterView' || inst.type?.__name === 'RouterView' || inst.type?.displayName === 'RouterView')) {
              acc.found = true
              acc.rvDepth = depth
              return
            }
            const child = inst.subTree
            const visit = (vnode, d) => {
              if (!vnode || acc.found || d > 40) return
              if (vnode.component) { walk(vnode.component, depth + 1, acc); return }
              if (Array.isArray(vnode.children)) for (const c of vnode.children) visit(c, d + 1)
            }
            visit(child, 0)
          }
          const acc = { container: false, found: false }
          walk(app._instance, 0, acc)
          out.rvFound = acc.found
          // Force a root-down update to see if the tree renders the new route
          // (distinguishes "dropped update job" from "router state stale").
          return out
        } catch (e) { return { err: String(e) } }
      })
      console.log('  DIAG:', JSON.stringify(diag))
      const navlog = await page.evaluate(() => window.__navlog || [])
      console.log('  NAVLOG:'); for (const l of navlog) console.log('    ' + l)
      const histlog = await page.evaluate(() => (window.__histlog || []).slice(-6))
      console.log('  HISTLOG:'); for (const h of histlog) console.log(`    ${h.t}ms ${h.m} -> ${h.url}\n      ${h.stack}`)
      // Poke test: force a global reactive nudge via router.replace to the
      // SAME location (no-op nav) — does the view appear?
      const poke = await page.evaluate(async () => {
        const app = window.__VUE_APP__
        const router = app?.config?.globalProperties?.$router
        if (!router) return { ok: false }
        try { await router.replace(router.currentRoute.value.fullPath) } catch (e) { return { err: String(e).slice(0, 120) } }
        await new Promise((r) => setTimeout(r, 300))
        return { ok: true, incomingNow: !!document.querySelector('main.dashboard') }
      })
      console.log('  POKE(same-route replace):', JSON.stringify(poke))
    }

    console.log(
      `cycle ${c} ${fromPath} -> ${toPath}: stackedBelow=${stacked} ` +
      `(incomingTop samples: ${samples.map((s) => s.incomingTop === null ? '·' : Math.round(s.incomingTop)).join(',')}) ` +
      `scroll pre=${preScroll} settled=${settled.scrollTop} white=${!settled.present || settled.textLen < 20} ` +
      `url=${settled.url} leavingStill=${settled.leavingStillPresent} errCard=${settled.errorCard} topbar=${settled.topbar}`
    )
  }
}

console.log(`\nSUMMARY ${role}: stacking=${stackObserved} scrollCarry=${scrollCarryObserved} whitePages=${whitePages}`)
if (consoleErrors.length) {
  console.log('console errors (first 10):')
  for (const e of consoleErrors.slice(0, 10)) console.log('  ', e)
}
await browser.close()
