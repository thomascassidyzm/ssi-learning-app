// Job #553: on a deployed build, as a signed-in role-holder, rewrite the app's
// own fresh listening snapshot into the PRE-#544 shape (the Senedd pod recorded
// as the served pod, no pod-1 anywhere), go offline, open Listening Mode and
// read the pod cards. The fix under test: the Senedd pod is listed under its
// own title, never as "Pod 1", and nothing downloaded goes dark.
// PROBE_URL, SESSION_JSON, COURSE, OUT_DIR, TAG, CHROME_BIN, TOPIC_SLUG.
import { chromium } from '@playwright/test'
import fs from 'fs'
const URL = process.env.PROBE_URL
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const OUT_DIR = process.env.OUT_DIR || '.'
const TAG = process.env.TAG || 'shot'
const COURSE = process.env.COURSE
const TOPIC_SLUG = process.env.TOPIC_SLUG || 'senedd-s4c-steve'
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(({ ref, sess, course }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess))
  localStorage.setItem('ssi-last-course', course)
  localStorage.setItem('ssi-last-course-origin', 'chosen')
}, { ref: REF, sess: session, course: COURSE })
const page = await ctx.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
const shot = (name) => page.screenshot({ path: `${OUT_DIR}/${TAG}-${name}.png` }).catch(() => {})
const out = { url: URL, course: COURSE }

const openListening = async () => {
  const trig = page.locator('.mode-trigger').first()
  const found = await trig.count()
  if (!found) return { modeTriggerFound: 0 }
  const r = { modeTriggerFound: found }
  await trig.click({ timeout: 5000 }).catch((e) => (r.trigError = String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  const listen = page.locator('.tray-item').filter({ hasText: /listen/i }).first()
  if (await listen.count()) await listen.click({ timeout: 5000 }).catch((e) => (r.listenError = String(e).slice(0, 120)))
  await page.locator('.scene-card, .scene-empty, .scene-list-wrap .error').first().waitFor({ state: 'visible', timeout: 60000 }).catch((e) => (r.waitError = String(e).slice(0, 100)))
  await page.waitForTimeout(6000)
  r.podCards = await page.locator('.pod-card').allInnerTexts().catch(() => [])
  r.sceneCards = await page.locator('.scene-card:not(.pod-card)').count()
  r.errors = await page.locator('.scene-list-wrap .error').allInnerTexts().catch(() => [])
  return r
}
const readSnapshot = (course) => page.evaluate(async (c) => {
  try {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('ssi-listening-meta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const entry = await new Promise((res, rej) => { const t = db.transaction('meta').objectStore('meta').get(c); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error) })
  db.close()
  return entry ? { podSlug: entry.podSlug, podTitle: entry.podTitle, podRows: entry.podRows.length, extraPods: (entry.extraPods || []).map((e) => [e.slug, e.title, (e.podRows || []).length, e.addressed]), preFixServedSlug: entry.preFixServedSlug } : null
  } catch (e) { return { error: String(e), href: location.href } }
}, course)

// 1. Online boot: the app writes its own (post-#544) snapshot and warms the SW.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
out.online = await openListening()
await shot('online')
// The first visit only INSTALLS the service worker; an offline reload is
// served from it only once it controls the page. Wait for it, reload online.
out.swReady = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active)).catch((e) => String(e))
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(9000)
out.swControlled = await page.evaluate(() => !!navigator.serviceWorker.controller)
out.freshSnapshot = await readSnapshot(COURSE)

// 2. Rewrite it into the PRE-#544 shape: topic pod in the served slot, no pod-1.
out.rewrite = await page.evaluate(async ({ c, slug }) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('ssi-listening-meta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const get = () => new Promise((res, rej) => { const t = db.transaction('meta').objectStore('meta').get(c); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error) })
  const entry = await get()
  if (!entry) return 'no snapshot to rewrite'
  const topic = (entry.extraPods || []).find((e) => e.slug === slug)
  if (!topic) return `no ${slug} extra in the fresh snapshot: ${JSON.stringify((entry.extraPods || []).map((e) => e.slug))}`
  const old = { ...entry, podSlug: slug, podTitle: topic.title || undefined, podRows: topic.podRows, extraPods: [] }
  delete old.preFixServedSlug
  await new Promise((res, rej) => { const t = db.transaction('meta', 'readwrite').objectStore('meta').put(old, c); t.onsuccess = () => res(); t.onerror = () => rej(t.error) })
  db.close()
  return `rewritten: served=${slug}, ${topic.podRows.length} rows, extras=[]`
}, { c: COURSE, slug: TOPIC_SLUG })
out.oldShapeSnapshot = await readSnapshot(COURSE)

// 3. Offline: reload from the SW, open Listening Mode, read the cards.
await ctx.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => (out.reloadError = String(e).slice(0, 160)))
await page.waitForTimeout(9000)
out.offline = await openListening()
await shot('offline')
out.offlineSnapshotAsRead = await readSnapshot(COURSE)
out.verdict = {
  noCardSaysPod1: !out.offline.podCards?.some((t) => /\bPod 1\b/.test(t)),
  topicCardUnderOwnTitle: !!out.offline.podCards?.some((t) => /Senedd/i.test(t)),
  nothingDark: (out.offline.podCards?.length || 0) > 0,
}
out.jsErrors = jsErrors
console.log(JSON.stringify(out, null, 1))
await browser.close()
