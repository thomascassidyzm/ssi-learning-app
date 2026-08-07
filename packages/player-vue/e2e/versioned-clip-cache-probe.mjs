// VERSIONED-CLIP CACHE PROBE — does a swapped clip actually reach a learner?
//
// Tom's acceptance criterion (2026-08-07): the per-clip versioned ref
// (`<uuid>.v<N>`) only buys anything if the learner app CONSUMES the ref the
// course data hands it at every playback site. A site that self-constructs a
// URL from a bare id keeps playing the pre-swap bytes forever, because
// /api/audio/:id sets `Cache-Control: public, max-age=31536000, immutable`
// and IndexedDB `ssi-audio-cache-v2` keys by the ref STRING.
//
// Course under test: fra_for_eng. 57 clips carry audio_revision=2, and they sit
// on SEED 1 LEGOs 1-5 (je veux / parler / français / avec toi / maintenant) —
// so round 1 is guaranteed to touch several. Verified live via service-role
// query, 2026-08-07.
//
// Four phases:
//   COLD        fresh profile, nothing primed — do the requests carry .v2?
//   WARM        prime ssi-audio-cache-v2 with a BOGUS blob under the BARE uuid,
//               and prime the HTTP cache with the bare-uuid URL, then play.
//               If the key really changed, the bogus blob is never served.
//   SCRIPT-V9   plant a pre-fix (bare-uuid) script under the OLD v9 cache key.
//   SCRIPT-V10  plant a pre-fix (bare-uuid) script under the CURRENT v10 key
//               with the audio-stamp marker faked to the live value, i.e. both
//               invalidation lanes deliberately defeated. The honest worst case.
//
// Usage:
//   LD_LIBRARY_PATH=$HOME/.pwlibs/root/usr/lib/x86_64-linux-gnu \
//   CHROME_BIN=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
//   node e2e/versioned-clip-cache-probe.mjs
//
// Prints a JSON block per phase and a final verdict object.

import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const COURSE = 'fra_for_eng'
const PLAY_MS = Number(process.env.PLAY_MS || 75000)

// The clip Tom named. audio_revision=2; v2 = 9216 bytes, v1 = 9504 bytes.
const NAMED_CLIP = '02cb6246-aef6-4880-ac88-039f5b579522'

// All 57 revised fra_for_eng clip ids (audio_revision=2), pulled live via
// service-role query 2026-08-07 and frozen here so the probe needs no DB creds.
const REVISED_IDS = new Set(
  JSON.parse(fs.readFileSync(new URL('./fixtures/fra-revised-ids.json', import.meta.url), 'utf8'))
)

// Seed-1 revised clips — the ones a learner hits in round 1. Used for priming.
const SEED1_IDS = [
  '54355041-0114-4d7e-86ed-4c5fd471b1c0', // je
  'e3fc37e2-8f8a-4b02-b858-362a9be2bb1a', // français
  '1ee9da19-8e36-4965-b3a1-6dc9d8edc8c5', // veux
  NAMED_CLIP, // avec toi
]

const launchOpts = { args: ['--no-sandbox'] }
if (process.env.CHROME_BIN) launchOpts.executablePath = process.env.CHROME_BIN
const browser = await chromium.launch(launchOpts)

const bare = (ref) => ref.split('.v')[0]

/** Attach request/response/console capture to a page. */
function instrument(page) {
  const audio = [] // { ref, url, status, bytes, fromCache }
  const console_ = []
  page.on('console', (m) => {
    const t = m.text()
    if (/\[InstantPlayback\]|\[ScriptCache\]|\[generateLearningScript\]|\[AudioCache\]/.test(t)) {
      console_.push(t.slice(0, 300))
    }
  })
  page.on('response', async (res) => {
    const m = res.url().match(/\/api\/audio\/([0-9a-f-]+(?:\.v\d+)?)(?:\?|$)/i)
    if (!m) return
    let bytes = null
    try {
      bytes = (await res.body()).length
    } catch {
      /* body already gone */
    }
    audio.push({
      ref: m[1],
      url: res.url(),
      status: res.status(),
      bytes,
      fromCache: !!(await res.serverAddr().catch(() => null)) === false,
    })
  })
  return { audio, console_ }
}

/** Drive a guest through course selection into round 1 of French. */
async function playFrench(page, label) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)

  const picker = page.locator('.course-name--tappable')
  if (await picker.count()) {
    const name = (await picker.first().innerText().catch(() => '')).trim()
    if (!name.toLowerCase().includes('french')) {
      await picker.first().click()
      await page.waitForSelector('.course-row', { timeout: 20000 }).catch(() => {})
      const row = page.locator('.course-row:has-text("French")').first()
      if (await row.count()) {
        const hasVariants = await row.evaluate((el) => el.classList.contains('has-variants'))
        if (hasVariants) {
          await row.click()
          await page.waitForSelector('.course-row.variant', { timeout: 8000 }).catch(() => {})
          await page.locator('.course-row.variant:has-text("English")').first().click()
        } else {
          await row.click()
        }
      }
    }
  }
  await page.waitForTimeout(4000)
  const courseNow = (await page.locator('.course-name--tappable').first().textContent().catch(() => '')) || ''
  console.log(`[${label}] course = "${courseNow.trim()}"`)

  for (const sel of [
    'button:has-text("Ready when you are")',
    '.play-button',
    'button[aria-label*="lay"]',
    '.player-start',
  ]) {
    const el = page.locator(sel).first()
    if (await el.count()) {
      await el.click({ timeout: 4000 }).catch(() => {})
      break
    }
  }
  await page.waitForTimeout(PLAY_MS)
  return courseNow.trim()
}

/** Summarise one phase's audio traffic against the revised set. */
function summarise(audio) {
  const revisedSeen = audio.filter((a) => REVISED_IDS.has(bare(a.ref)))
  const stamped = revisedSeen.filter((a) => a.ref.includes('.v'))
  const bareHits = revisedSeen.filter((a) => !a.ref.includes('.v'))
  const named = audio.filter((a) => bare(a.ref) === NAMED_CLIP)
  return {
    totalAudioResponses: audio.length,
    revisedClipResponses: revisedSeen.length,
    stamped: stamped.length,
    BARE_revised: bareHits.length,
    bareRefs: [...new Set(bareHits.map((a) => a.ref))].slice(0, 10),
    stampedRefs: [...new Set(stamped.map((a) => a.ref))].slice(0, 12),
    namedClip: named.map((a) => ({ ref: a.ref, status: a.status, bytes: a.bytes })),
  }
}

/** Read every key + size in ssi-audio-cache-v2. */
const dumpAudioCache = (page) =>
  page.evaluate(async () => {
    const open = () =>
      new Promise((res, rej) => {
        const r = indexedDB.open('ssi-audio-cache-v2')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
    try {
      const db = await open()
      if (!db.objectStoreNames.contains('audio')) return []
      return await new Promise((res) => {
        const rows = []
        const tx = db.transaction('audio', 'readonly').objectStore('audio').openCursor()
        tx.onsuccess = (e) => {
          const c = e.target.result
          if (!c) return res(rows)
          rows.push({ id: c.value.id, size: c.value.size })
          c.continue()
        }
        tx.onerror = () => res(rows)
      })
    } catch {
      return []
    }
  })

const results = {}
const PHASES = (process.env.PHASES || 'cold,warm,script').split(',')

// ───────────────────────────────── PHASE 1: COLD ─────────────────────────────
if (PHASES.includes('cold')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const { audio, console_ } = instrument(page)
  await playFrench(page, 'COLD')
  results.cold = summarise(audio)
  results.cold.cacheKeysAfter = (await dumpAudioCache(page)).length
  console.log('\n=== COLD ===')
  console.log(JSON.stringify(results.cold, null, 1))
  console.log(console_.slice(0, 15).join('\n'))
  await ctx.close()
}

// ───────────────────── PHASE 2: WARM (primed stale caches) ───────────────────
if (PHASES.includes('warm')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()

  // Get onto the origin so IndexedDB + HTTP cache are same-origin.
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)

  const primed = await page.evaluate(async (ids) => {
    // 1. HTTP cache: fetch the BARE uuid so the immutable response is stored
    //    under that URL — exactly the state of a learner from before the swap.
    const http = []
    for (const id of ids) {
      try {
        const r = await fetch(`/api/audio/${id}`)
        const b = await r.blob()
        http.push({ id, status: r.status, bytes: b.size })
      } catch (e) {
        http.push({ id, error: String(e) })
      }
    }
    // 2. IndexedDB: plant an unmistakable BOGUS blob under the BARE uuid key.
    //    If anything ever plays it, the key did not change.
    const open = () =>
      new Promise((res, rej) => {
        const r = indexedDB.open('ssi-audio-cache-v2', 1)
        r.onupgradeneeded = () => {
          const db = r.result
          if (!db.objectStoreNames.contains('audio')) {
            const s = db.createObjectStore('audio', { keyPath: 'id' })
            s.createIndex('by-lifecycle', 'lifecycle')
            s.createIndex('by-last-accessed', 'lastAccessedAt')
            s.createIndex('by-course', 'courseCode')
            s.createIndex('by-ephemeral-owner', 'ephemeralOwnerLegoId')
          }
        }
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
    const db = await open()
    const bogus = new Blob([new Uint8Array(4242).fill(66)], { type: 'audio/mpeg' })
    const now = Date.now()
    await new Promise((res) => {
      const tx = db.transaction('audio', 'readwrite')
      const st = tx.objectStore('audio')
      for (const id of ids) {
        st.put({
          id,
          blob: bogus,
          mimeType: 'audio/mpeg',
          size: 4242,
          lifecycle: 'persistent',
          courseCode: null,
          cachedAt: now,
          lastAccessedAt: now,
          ephemeralOwnerLegoId: null,
        })
      }
      tx.oncomplete = () => res()
      tx.onerror = () => res()
    })
    return { http, plantedBogusUnderBareIds: ids, bogusBytes: 4242 }
  }, SEED1_IDS)

  console.log('\n=== WARM: primed state ===')
  console.log(JSON.stringify(primed, null, 1))

  const { audio, console_ } = instrument(page)
  await playFrench(page, 'WARM')
  results.warm = summarise(audio)
  results.warm.primed = primed
  const keys = await dumpAudioCache(page)
  results.warm.cacheKeysForSeed1 = keys
    .filter((k) => SEED1_IDS.includes(bare(k.id)))
    .map((k) => `${k.id} (${k.size}B)`)
  results.warm.bogusStillOnlyCopy = results.warm.cacheKeysForSeed1.every((k) => k.includes('4242'))
  console.log('\n=== WARM ===')
  console.log(JSON.stringify(results.warm, null, 1))
  console.log(console_.slice(0, 20).join('\n'))
  await ctx.close()
}

// ────────────── PHASE 3+4: SCRIPT-CACHE downgrade (v9 key, v10 key) ──────────
for (const variant of (process.env.VARIANTS || 'v9,v10-stamp-defeated,v10-stamp-stale').split(',').filter((v) => PHASES.includes('script') && v)) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()

  // First a normal run so a real, correctly-stamped script exists to downgrade.
  const warmup = instrument(page)
  await playFrench(page, `PRE-${variant}`)
  const warmSummary = summarise(warmup.audio)

  // Now downgrade it: strip every `.vN` suffix from the cached script, and
  // re-key it as the variant demands.
  const down = await page.evaluate(
    async ({ variant, course }) => {
      const open = () =>
        new Promise((res, rej) => {
          const r = indexedDB.open('ssi-script-cache')
          r.onsuccess = () => res(r.result)
          r.onerror = () => rej(r.error)
        })
      const db = await open()
      if (!db.objectStoreNames.contains('scripts')) return { error: 'no scripts store' }
      const all = await new Promise((res) => {
        const out = []
        const st = db.transaction('scripts', 'readonly').objectStore('scripts')
        const kr = st.getAllKeys()
        kr.onsuccess = () => {
          const keys = kr.result
          const vr = st.getAll()
          vr.onsuccess = () => {
            keys.forEach((k, i) => out.push({ key: k, value: vr.result[i] }))
            res(out)
          }
          vr.onerror = () => res(out)
        }
        kr.onerror = () => res(out)
      })
      const entry = all.find((e) => String(e.key).endsWith(':' + course))
      if (!entry) return { error: 'no cached script for ' + course, keys: all.map((e) => e.key) }

      let stripped = 0
      const strip = (o) => {
        if (Array.isArray(o)) return o.map(strip)
        if (o && typeof o === 'object') {
          const out = {}
          for (const [k, v] of Object.entries(o)) out[k] = strip(v)
          return out
        }
        if (typeof o === 'string') {
          // The cached script stores FULL proxy URLs, e.g.
          // "/api/audio/2430014c-....v3" — not bare ref strings. Strip the
          // suffix wherever it appears inside the string.
          const out = o.replace(/([0-9a-f-]{36})\.v\d+/gi, (_, id) => {
            stripped++
            return id
          })
          return out
        }
        return o
      }
      const downgraded = strip(entry.value)
      const targetKey = variant === 'v9' ? `v9:${course}` : String(entry.key)

      await new Promise((res) => {
        const tx = db.transaction('scripts', 'readwrite')
        const st = tx.objectStore('scripts')
        if (variant === 'v9') {
          // Real-world shape: the pre-fix entry lived under v9 and NOTHING
          // lives under v10 yet.
          st.delete(entry.key)
          st.put(downgraded, targetKey)
        } else {
          // Adversarial: bare-uuid content sitting under the CURRENT key.
          st.put(downgraded, targetKey)
        }
        tx.oncomplete = () => res()
        tx.onerror = () => res()
      })

      // Defeat the audio-stamp lane for the v10 variant by claiming this
      // device already saw the live stamp. (The lane reads courses.audio_stamp
      // and compares to this localStorage marker.)
      const k = `ssi-audio-stamp-${course}`
      let stampMarker = null
      if (variant === 'v10-stamp-defeated') {
        // Leave whatever the previous run stored — that IS the live value, so
        // the lane sees no move and cannot fire. Worst case, by construction.
        stampMarker = localStorage.getItem(k)
      } else if (variant === 'v10-stamp-stale') {
        // Realistic future-swap shape: the device cached this script under the
        // CURRENT key before a swap, so its stored stamp predates the swap.
        localStorage.setItem(k, '2000-01-01T00:00:00.000000+00:00')
        stampMarker = localStorage.getItem(k)
      } else {
        localStorage.removeItem(k)
      }
      return { originalKey: entry.key, targetKey, suffixesStripped: stripped, stampMarker }
    },
    { variant, course: COURSE }
  )

  console.log(`\n=== SCRIPT-CACHE downgrade (${variant}) ===`)
  console.log(JSON.stringify(down, null, 1))

  const after = instrument(page)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  for (const sel of [
    'button:has-text("Ready when you are")',
    '.play-button',
    'button[aria-label*="lay"]',
    '.player-start',
  ]) {
    const el = page.locator(sel).first()
    if (await el.count()) {
      await el.click({ timeout: 4000 }).catch(() => {})
      break
    }
  }
  await page.waitForTimeout(PLAY_MS)

  results[`script_${variant}`] = {
    warmupHadStampedRefs: warmSummary.stamped,
    downgrade: down,
    after: summarise(after.audio),
    console: after.console_.slice(0, 20),
  }
  console.log(JSON.stringify(results[`script_${variant}`], null, 1))
  await ctx.close()
}

await browser.close()

const verdict = {
  coldPass: results.cold
    ? results.cold.revisedClipResponses > 0 && results.cold.BARE_revised === 0
    : 'skipped',
  warmPass: results.warm
    ? results.warm.revisedClipResponses > 0 &&
      results.warm.BARE_revised === 0 &&
      results.warm.namedClip.every((n) => n.bytes !== 4242)
    : 'skipped',
  scriptV9Pass: results.script_v9 ? results.script_v9.after.BARE_revised === 0 : 'skipped',
  scriptV10StampDefeated: results['script_v10-stamp-defeated']?.after ?? 'skipped',
  scriptV10StampStalePass: results['script_v10-stamp-stale']
    ? results['script_v10-stamp-stale'].after.BARE_revised === 0
    : 'skipped',
}
console.log('\n=== VERDICT ===')
console.log(JSON.stringify(verdict, null, 1))
fs.writeFileSync('/tmp/versioned-clip-cache-results.json', JSON.stringify(results, null, 1))
console.log('full results → /tmp/versioned-clip-cache-results.json')
