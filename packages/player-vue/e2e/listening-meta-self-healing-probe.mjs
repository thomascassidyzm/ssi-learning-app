// Self-healing listening-snapshot probe (2026-08-24).
//
// Proves, on the DEPLOYED artifact and against the LIVE DB, that a device
// holding the pre-repair Pod 1 split arrays heals itself with nobody bumping
// a constant:
//
//   1. Seed a LEGACY `v3:ita_for_eng` IndexedDB entry carrying the doctored
//      PRE-repair scene-15 arrays and an old contentStamp — i.e. exactly the
//      state a real device shipped into on 2026-08-24.
//   2. Boot the app as an entitled fresh client (read-only generateLink /
//      verifyOtp — NO email is sent, NO writes).
//   3. Assert the legacy key is adopted onto the bare `ita_for_eng` key and
//      then judged stale by its stamp and refreshed, so scene 15's
//      sentence_audio_ids match the live DB again.
//
// Run:  LD_LIBRARY_PATH=~/.ssi-sentinel-libs CHROME_BIN=... node \
//         e2e/listening-meta-self-healing-probe.mjs
// from packages/player-vue. BASE_URL defaults to the dev alias.
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+bumface@gmail.com'
const COURSE = 'ita_for_eng'
const POD_ID = `${COURSE}:pod-1`
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const projectRef = new URL(SB_URL).hostname.split('.')[0]

const svc = createClient(SB_URL, serviceKey, { auth: { persistSession: false } })

// ── Live truth ────────────────────────────────────────────────────────────
const { data: course } = await svc.from('courses')
  .select('content_stamp, audio_stamp').eq('course_code', COURSE).single()
const { data: liveRows } = await svc.from('listening_pod_sentences')
  .select('id, scene_number, sentence_number, global_order, speaker, target_text, known_text, target_audio_id, known_audio_id, explainer_audio_id, glue_to_next, atom_map, sentence_audio_ids, sentence_known_audio_ids, atom_map_fine, window_known_map, takeg_audio_ids')
  .eq('pod_id', POD_ID).order('global_order', { ascending: true })

const liveS15 = liveRows.filter((r) => r.scene_number === 15)
console.log(`LIVE  content_stamp=${course.content_stamp}  audio_stamp=${course.audio_stamp}`)
console.log(`LIVE  scene 15: ${liveS15.length} sentences, split arrays:`,
  liveS15.map((r) => (r.sentence_audio_ids ? r.sentence_audio_ids.length : 'null')).join(' '))

// ── The doctored PRE-repair snapshot: positionally-inherited split arrays ──
// This is the shape that made "Quanto costa?" play two clips.
const stalePodRows = liveRows.map((r) => (
  r.scene_number === 15 && !r.sentence_audio_ids
    ? { ...r, sentence_audio_ids: ['STALE-SPLIT-A', 'STALE-SPLIT-B'] }
    : r
))

const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link } = await svc.auth.admin.generateLink({ type: 'magiclink', email: TESTER })
const { data: v } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
const session = v.session
if (!session) throw new Error('no session — probe cannot run entitled')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox'],
})
const ctx = await browser.newContext()
await ctx.addInitScript(([key, sess]) => {
  try { localStorage.setItem(key, JSON.stringify(sess)) } catch { /* noop */ }
}, [`sb-${projectRef}-auth-token`, session])

const page = await ctx.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (/ListeningMeta|listeningMeta|STALE/i.test(t)) console.log('  [page]', t)
})

// Boot once so the origin exists, then plant the legacy entry.
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)

const planted = await page.evaluate(async ([rows, courseCode]) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('ssi-listening-meta', 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('meta')) r.result.createObjectStore('meta') }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const db = await open()
  const tx = db.transaction('meta', 'readwrite')
  const store = tx.objectStore('meta')
  // Clear any bare-key entry so the legacy one is the ONLY snapshot present.
  store.delete(courseCode)
  store.put({
    courseCode,
    cachedAt: Date.now() - 86_400_000,
    contentStamp: '2026-01-01T00:00:00+00:00', // pre-repair vintage
    audioStamp: '2026-01-01T00:00:00+00:00',
    podRows: rows,
    podSlug: 'pod-1',
    clipTexts: {}, bookends: [], fineKnowns: {}, coreSeeds: [], legoCatalogue: [],
  }, `v3:${courseCode}`)
  await new Promise((res) => { tx.oncomplete = res })
  const keys = await new Promise((res) => {
    const t2 = db.transaction('meta', 'readonly').objectStore('meta').getAllKeys()
    t2.onsuccess = () => res(t2.result)
  })
  return keys
}, [stalePodRows, COURSE])
console.log('PLANTED legacy snapshot. keys now:', JSON.stringify(planted))

// Reload: online boot → checkContentVersion → refreshListeningMetaIfStale.
await page.goto(BASE + `/?course=${COURSE}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12_000)

const after = await page.evaluate(async ([courseCode]) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('ssi-listening-meta', 1)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const db = await open()
  const get = (k) => new Promise((res) => {
    const q = db.transaction('meta', 'readonly').objectStore('meta').get(k)
    q.onsuccess = () => res(q.result)
    q.onerror = () => res(undefined)
  })
  const keys = await new Promise((res) => {
    const q = db.transaction('meta', 'readonly').objectStore('meta').getAllKeys()
    q.onsuccess = () => res(q.result)
  })
  const bare = await get(courseCode)
  const legacy = await get(`v3:${courseCode}`)
  return {
    keys,
    hasLegacy: !!legacy,
    bare: bare && {
      contentStamp: bare.contentStamp,
      audioStamp: bare.audioStamp,
      stale: bare.stale ?? null,
      podSlug: bare.podSlug,
      podRowCount: bare.podRows?.length ?? 0,
      s15: (bare.podRows || []).filter((r) => r.scene_number === 15)
        .map((r) => ({
          id: r.id,
          text: r.target_text,
          split: r.sentence_audio_ids ? r.sentence_audio_ids.length : null,
          ids: r.sentence_audio_ids,
        })),
    },
  }
}, [COURSE])

console.log('\n── AFTER ONLINE BOOT ──')
console.log('keys:', JSON.stringify(after.keys))
console.log('legacy v3 key still present?', after.hasLegacy)
if (after.bare) {
  console.log('bare-key entry: stamp=', after.bare.contentStamp,
    ' podSlug=', after.bare.podSlug, ' rows=', after.bare.podRowCount,
    ' stale=', JSON.stringify(after.bare.stale))
  console.log('scene 15 in the snapshot:')
  for (const r of after.bare.s15) console.log('   ', r.id, JSON.stringify(r.text), 'split=', r.split)
}

// ── Verdict ───────────────────────────────────────────────────────────────
const fails = []
if (after.hasLegacy) fails.push('legacy v3 key survived — not migrated')
if (!after.keys.includes(COURSE)) fails.push('no bare-key entry — device left with NO snapshot (regression)')
if (after.bare) {
  if (after.bare.podSlug !== 'pod-1') fails.push(`podSlug lost in migration: ${after.bare.podSlug}`)
  if (after.bare.podRowCount === 0) fails.push('snapshot has zero pod rows')
  const staleIds = after.bare.s15.filter((r) => (r.ids || []).some((i) => String(i).startsWith('STALE-SPLIT')))
  if (staleIds.length) fails.push(`${staleIds.length} scene-15 rows still carry the doctored PRE-repair split arrays`)
  // Compare against live truth, row by row.
  const liveById = new Map(liveS15.map((r) => [r.id, r]))
  for (const r of after.bare.s15) {
    const live = liveById.get(r.id)
    if (!live) { fails.push(`snapshot row ${r.id} not in live DB`); continue }
    const liveSplit = live.sentence_audio_ids ? live.sentence_audio_ids.length : null
    if (r.split !== liveSplit) fails.push(`${r.id}: snapshot split=${r.split} but live=${liveSplit}`)
    if (r.text !== live.target_text) fails.push(`${r.id}: text drift`)
  }
  if (after.bare.contentStamp !== course.content_stamp) {
    fails.push(`vintage not refreshed: ${after.bare.contentStamp} vs live ${course.content_stamp}`)
  }
}

console.log('\n' + (fails.length ? `FAIL (${fails.length}):\n  ` + fails.join('\n  ') : 'PASS — legacy snapshot adopted, judged stale by its stamp, and refreshed to live truth'))
await browser.close()
process.exit(fails.length ? 1 : 0)
