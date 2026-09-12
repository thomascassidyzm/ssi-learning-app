// Job #379: Tom's sequence, headless. Online on a deployed build as a signed-in
// learner, pin the course, start the Offline Mode download, wait, read the
// listening snapshot from IndexedDB, then go OFFLINE, reload, open Listening
// Mode and read the Dialogues list. PROBE_URL, SESSION_JSON, COURSE, OUT_DIR,
// TAG, DOWNLOAD_WAIT_MS.
import { chromium } from '@playwright/test'
import fs from 'fs'
const URL = process.env.PROBE_URL
const session = JSON.parse(fs.readFileSync(process.env.SESSION_JSON, 'utf8'))
const REF = process.env.SUPABASE_REF || 'swfvymspfxmnfhevgdkg'
const OUT_DIR = process.env.OUT_DIR || '.'
const TAG = process.env.TAG || 'offline'
const DL_WAIT = Number(process.env.DOWNLOAD_WAIT_MS || 120000)
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
await ctx.addInitScript(({ ref, sess, course }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess))
  localStorage.setItem('ssi-last-course', course)
  localStorage.setItem('ssi-last-course-origin', 'chosen')
}, { ref: REF, sess: session, course: process.env.COURSE })
const page = await ctx.newPage()
const logs = [], jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => { const t = m.text(); if (/Listening|servedPod|Offline|offline|pod|Pod|bundle/.test(t)) logs.push(`${m.type()}: ${t.slice(0, 200)}`) })
const readMeta = () => page.evaluate(async (course) => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('ssi-listening-meta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  try {
    const db = await open()
    const names = Array.from(db.objectStoreNames)
    if (!names.includes('meta')) return { stores: names }
    const tx = db.transaction('meta', 'readonly'); const st = tx.objectStore('meta')
    const keys = await new Promise((res) => { const r = st.getAllKeys(); r.onsuccess = () => res(r.result) })
    const v = await new Promise((res) => { const r = st.get(course); r.onsuccess = () => res(r.result) })
    return { keys, entry: v ? { podSlug: v.podSlug, podRows: (v.podRows || []).length, coreSeeds: (v.coreSeeds || []).length, clipTexts: Object.keys(v.clipTexts || {}).length, contentStamp: v.contentStamp, stale: v.stale || null, keysOfEntry: Object.keys(v) } : null }
  } catch (e) { return { error: String(e) } }
}, process.env.COURSE)
// How many of the snapshot's pod clips (every slot) are in the persistent
// audio cache right now — the "pods first" fetch-ahead, measured.
const readPodAudioCoverage = () => page.evaluate(async (course) => {
  const open = (name) => new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  try {
    const mdb = await open('ssi-listening-meta')
    const meta = await new Promise((res) => { const r = mdb.transaction('meta').objectStore('meta').get(course); r.onsuccess = () => res(r.result) })
    if (!meta) return { podClips: 0, cached: 0 }
    const ids = new Set()
    const rows = [...(meta.podRows || []), ...((meta.extraPods || []).flatMap((e) => e.podRows || []))]
    for (const r of rows) for (const v of [r.target_audio_id, r.known_audio_id, r.explainer_audio_id, ...(r.sentence_audio_ids || []), ...(r.sentence_known_audio_ids || []), ...(r.takeg_audio_ids || [])]) if (v) ids.add(v)
    for (const b of meta.bookends || []) if (b.id) ids.add(b.id)
    for (const v of Object.values(meta.fineKnowns || {})) if (v) ids.add(v)
    const adb = await open('ssi-audio-cache-v2')
    const keys = await new Promise((res) => { const r = adb.transaction('audio').objectStore('audio').getAllKeys(); r.onsuccess = () => res(r.result) })
    const have = new Set(keys.map(String))
    let cached = 0; for (const id of ids) if (have.has(id)) cached++
    return { podClips: ids.size, cached, totalCached: keys.length, extraPods: (meta.extraPods || []).map((e) => `${e.slug}:${(e.podRows || []).length}`) }
  } catch (e) { return { error: String(e) } }
}, process.env.COURSE)
const readList = async (label) => {
  const o = { label }
  const trig = page.locator('.mode-trigger').first()
  o.modeTriggerFound = await trig.count()
  if (!o.modeTriggerFound) return o
  await trig.click({ timeout: 5000 }).catch((e) => (o.trigError = String(e).slice(0, 120)))
  await page.waitForTimeout(1500)
  const items = page.locator('.tray-item')
  o.trayItems = await items.allInnerTexts().catch(() => [])
  const listen = items.filter({ hasText: /listen/i }).first()
  if (await listen.count()) await listen.click({ timeout: 5000 }).catch((e) => (o.listenError = String(e).slice(0, 120)))
  await page.locator('.scene-card, .scene-empty, .scene-list-wrap .error, .view-tab').first().waitFor({ state: 'visible', timeout: 60000 }).catch((e) => (o.waitError = String(e).slice(0, 100)))
  await page.waitForTimeout(4000)
  o.viewTabs = await page.locator('.view-tab').allInnerTexts().catch(() => [])
  o.sceneCards = await page.locator('.scene-card').count()
  o.groupHeadings = await page.locator('.scene-group-heading').allInnerTexts().catch(() => [])
  o.sceneEmpty = await page.locator('.scene-empty').allInnerTexts().catch(() => [])
  o.bodyHead = await page.evaluate(() => document.body.innerText.slice(0, 220).replace(/\n+/g, ' | '))
  await page.screenshot({ path: `${OUT_DIR}/${TAG}-${label}.png` }).catch(() => {})
  return o
}
const out = { url: URL }
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
out.version = await page.evaluate(() => fetch('/version.json').then((r) => r.json())).catch((e) => String(e))
await page.waitForTimeout(9000)
out.metaBefore = await readMeta()
// Start the Offline Mode download from the mode tray — unless SKIP_DOWNLOAD=1,
// which models a learner who only ever had the automatic download-ahead.
if (process.env.SKIP_DOWNLOAD === '1') { out.skippedDownload = true; await page.waitForTimeout(Number(process.env.DOWNLOAD_WAIT_MS || 30000)) } else {
const trig = page.locator('.mode-trigger').first()
await trig.click({ timeout: 5000 }).catch((e) => (out.trigError = String(e).slice(0, 120)))
await page.waitForTimeout(1500)
const off = page.locator('.tray-item').filter({ hasText: /offline/i }).first()
out.offlineItemFound = await off.count()
if (out.offlineItemFound) await off.click({ timeout: 5000 }).catch((e) => (out.offError = String(e).slice(0, 120)))
await page.waitForTimeout(2500)
out.afterOfflineTap = await page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '))
await page.screenshot({ path: `${OUT_DIR}/${TAG}-offline-sheet.png` }).catch(() => {})
const dl = page.locator('.offline-depth-download').first()
out.downloadBtnFound = await dl.count()
if (out.downloadBtnFound) await dl.click({ timeout: 5000 }).catch((e) => (out.dlError = String(e).slice(0, 120)))
await page.waitForTimeout(DL_WAIT)
out.afterDownload = await page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '))
await page.screenshot({ path: `${OUT_DIR}/${TAG}-after-download.png` }).catch(() => {})
}
out.metaAfterDownload = await readMeta()
out.podAudioAfterOnline = await readPodAudioCoverage()
// Airplane mode. First the app as it stands (the connection drops mid-use),
// then a full reload through the service worker (the app reopened offline).
await ctx.setOffline(true)
out.swControlled = await page.evaluate(() => !!navigator.serviceWorker?.controller).catch(() => null)
out.offlineListLive = await readList('offline-live')
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => (out.reloadError = String(e).slice(0, 160)))
await page.waitForTimeout(12000)
out.offlineBodyHead = await page.evaluate(() => document.body.innerText.slice(0, 220).replace(/\n+/g, ' | ')).catch((e) => String(e))
out.offlineList = await readList('offline-list')
out.metaOffline = await readMeta().catch((e) => String(e))
out.podAudioOffline = await readPodAudioCoverage().catch((e) => String(e))
out.logs = logs.slice(-40); out.jsErrors = jsErrors
console.log(JSON.stringify(out, null, 1))
await browser.close()
