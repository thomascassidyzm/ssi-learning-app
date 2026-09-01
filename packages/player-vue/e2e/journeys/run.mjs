// THE SIX LEARNER JOURNEYS — baseline harness (2026-09-01).
//
// One command, one journey, N repetitions, against a REAL deployed build.
// Every headline number is WALL-CLOCK MILLISECONDS from the moment the
// learner did something to the moment they got what they asked for.
//
//   BASE_URL=https://staging.saysomethingin.app \
//   JOURNEY=j1 NET=good RUNS=5 node e2e/journeys/run.mjs
//
// JOURNEY:
//   j1  new user, cold device, brand new account → first word heard
//   j2  existing learner opens a course they have never opened → first word
//   j3  returning learner, content already cached → first word
//   j4  switching to a course with SOME content cached (the realistic case)
//   j5  screen switching: tap → painted, tap → interactive
//   j6  intermittent connectivity: does it recover, stall, lie, or lose the place?
//
// NET: good | fast3g | slow3g | highlatency | intermittent | none
//   Journeys 1-5 accept any of these — that IS the robustness axis (item 6
//   of the brief). j6 additionally drops and restores the connection on a
//   duty cycle mid-session and reports what the learner experienced.
//
// HONESTY RULES BAKED IN:
//   - A journey that never produces sound is recorded as a journey that
//     never produced sound, with the reason. It is never dropped from the
//     median to make the number look better.
//   - "Audible" means the audio element's currentTime genuinely advanced.
//   - Spread (max/min) is reported for every metric. A 3x spread is itself
//     a finding.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import {
  launch, mintSession, createFreshUser, deleteUser, attachWaterfall, legBreakdown,
  waitAudible, pressTransport, waitReady, courseName, openCoursePicker, courseRow,
  cycleOffline, stat, secs,
} from './lib.mjs'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const JOURNEY = process.env.JOURNEY || 'j1'
const NETNAME = process.env.NET || 'good'
const RUNS = Number(process.env.RUNS || 5)
const BUDGET = Number(process.env.BUDGET_MS || 120000)
const SCRATCH = process.env.CS_SCRATCH || '/tmp'
const OUT = process.env.OUT_DIR || `${SCRATCH}/journeys/${JOURNEY}-${NETNAME}/`
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+ssi@gmail.com'
// Course A = the one the learner already has. Course B = the new one.
const COURSE_A = process.env.COURSE_A || 'Spanish'
const COURSE_B = process.env.COURSE_B || 'Italian'

mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(...a)
const nowDeadline = () => Date.now() + BUDGET

// ── j1: brand new account, brand new device, first word ─────────────────────
async function j1(i) {
  const user = await createFreshUser()
  let session = null
  try { session = await mintSession(user.email) } catch (e) { /* new user may need the link path */ }
  const dir = `${OUT}p${i}-${Date.now()}`
  const { ctx, page, cdp } = await launch(dir, { net: NETNAME, session, returnUser: false })
  const ref = { t0: 0 }
  const rows = attachWaterfall(page, ref)
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))

  const t0 = Date.now(); ref.t0 = t0
  const deadline = t0 + BUDGET
  let intermit = null
  if (NETNAME === 'intermittent') intermit = cycleOffline(cdp)

  await page.goto(BASE + '/', { waitUntil: 'commit' })
  // A first-time visitor is handed a course by the boot resolver, or is shown
  // the picker. Handle both without pretending one didn't happen.
  let pickedManually = false
  const readyOrPicker = async () => {
    const dl = Math.min(deadline, Date.now() + 45000)
    while (Date.now() < dl) {
      if (await page.locator('.course-row').first().isVisible().catch(() => false)) return 'picker'
      if (await page.locator('.belt-badge').isVisible().catch(() => false)) return 'ready'
      await page.waitForTimeout(100)
    }
    return 'neither'
  }
  const state = await readyOrPicker()
  if (state === 'picker') {
    pickedManually = true
    const row = await courseRow(page, COURSE_A).catch(() => page.locator('.course-row').first())
    await row.click().catch(() => {})
  }
  const readyName = await waitReady(page, null, deadline)
  const tReady = readyName ? Date.now() - t0 : null
  const pressed = await pressTransport(page, deadline)
  const tPress = pressed ? Date.now() - t0 : null
  const audio = await waitAudible(page, deadline)
  const tAudible = audio ? Date.now() - t0 : null
  if (intermit) await intermit.stop()

  const r = await finish({ i, ctx, page, dir, rows, errs, t0, tReady, tPress, tAudible, audio,
    extra: { account: 'brand new', pickedManually, readyName, offlineLog: intermit?.log } })
  await deleteUser(user.id)
  return r
}

// ── shared: build a warm profile that has really used course A ──────────────
// Not simulated warmth — the app is booted, played, and left to write its
// caches, exactly as a learner's device would be.
async function warmProfile(dir, session, course, playMs = 25000, net = 'good') {
  const { ctx, page, cdp } = await launch(dir, { net, session })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const dl = Date.now() + 90000
  if (await page.locator('.course-row').first().isVisible().catch(() => false)) {
    const row = await courseRow(page, course).catch(() => null)
    if (row) await row.click().catch(() => {})
  } else {
    const name = await courseName(page)
    if (!name.toLowerCase().includes(course.toLowerCase())) {
      await openCoursePicker(page).catch(() => {})
      const row = await courseRow(page, course).catch(() => null)
      if (row) await row.click().catch(() => {})
    }
  }
  await waitReady(page, course, dl)
  await pressTransport(page, dl)
  await page.waitForTimeout(playMs) // let it actually play and cache
  await ctx.close()
}

// ── j2: existing learner, a course they have NEVER opened ───────────────────
async function j2(i) {
  const session = await mintSession(TESTER)
  const dir = `${OUT}p${i}-${Date.now()}`
  await warmProfile(dir, session, COURSE_A)          // they have course A
  const { ctx, page, cdp } = await launch(dir, { net: NETNAME, session })
  const ref = { t0: 0 }
  const rows = attachWaterfall(page, ref)
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await waitReady(page, null, Date.now() + 90000)
  await page.waitForTimeout(1500)
  await openCoursePicker(page)
  const row = await courseRow(page, COURSE_B)

  // t0 = the tap on the new course. That is the learner's action.
  const t0 = Date.now(); ref.t0 = t0
  const deadline = t0 + BUDGET
  let intermit = null
  if (NETNAME === 'intermittent') intermit = cycleOffline(cdp)
  await row.click()
  const readyName = await waitReady(page, COURSE_B, deadline)
  const tReady = readyName ? Date.now() - t0 : null
  const pressed = await pressTransport(page, deadline)
  const tPress = pressed ? Date.now() - t0 : null
  const audio = await waitAudible(page, deadline)
  const tAudible = audio ? Date.now() - t0 : null
  if (intermit) await intermit.stop()
  return finish({ i, ctx, page, dir, rows, errs, t0, tReady, tPress, tAudible, audio,
    extra: { newCourse: COURSE_B, readyName, offlineLog: intermit?.log } })
}

// ── j3: returning learner, content already cached ───────────────────────────
async function j3(i) {
  const session = await mintSession(TESTER)
  const dir = `${OUT}p${i}-${Date.now()}`
  await warmProfile(dir, session, COURSE_A, 30000)   // real cache, real play
  // Browser process restarted on the SAME on-disk profile: IndexedDB, SW
  // Cache Storage and the HTTP disk cache survive; nothing in memory does.
  // That is what "coming back later" is.
  const { ctx, page, cdp } = await launch(dir, { net: NETNAME, session })
  const ref = { t0: 0 }
  const rows = attachWaterfall(page, ref)
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))

  const t0 = Date.now(); ref.t0 = t0
  const deadline = t0 + BUDGET
  let intermit = null
  if (NETNAME === 'intermittent') intermit = cycleOffline(cdp)
  await page.goto(BASE + '/', { waitUntil: 'commit' })
  const readyName = await waitReady(page, null, deadline)
  const tReady = readyName ? Date.now() - t0 : null
  const pressed = await pressTransport(page, deadline)
  const tPress = pressed ? Date.now() - t0 : null
  const audio = await waitAudible(page, deadline)
  const tAudible = audio ? Date.now() - t0 : null
  if (intermit) await intermit.stop()
  return finish({ i, ctx, page, dir, rows, errs, t0, tReady, tPress, tAudible, audio,
    extra: { resumedCourse: readyName, offlineLog: intermit?.log } })
}

// ── j4: switch to a course with SOME content cached ─────────────────────────
// The realistic case: they dabbled in B, went back to A, and now return to B.
async function j4(i) {
  const session = await mintSession(TESTER)
  const dir = `${OUT}p${i}-${Date.now()}`
  await warmProfile(dir, session, COURSE_B, 12000)   // a short dabble in B — partial cache
  await warmProfile(dir, session, COURSE_A, 20000)   // then they moved to A
  const { ctx, page, cdp } = await launch(dir, { net: NETNAME, session })
  const ref = { t0: 0 }
  const rows = attachWaterfall(page, ref)
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await waitReady(page, null, Date.now() + 90000)
  await page.waitForTimeout(1500)
  await openCoursePicker(page)
  const row = await courseRow(page, COURSE_B)

  const t0 = Date.now(); ref.t0 = t0
  const deadline = t0 + BUDGET
  let intermit = null
  if (NETNAME === 'intermittent') intermit = cycleOffline(cdp)
  await row.click()
  const readyName = await waitReady(page, COURSE_B, deadline)
  const tReady = readyName ? Date.now() - t0 : null
  const pressed = await pressTransport(page, deadline)
  const tPress = pressed ? Date.now() - t0 : null
  const audio = await waitAudible(page, deadline)
  const tAudible = audio ? Date.now() - t0 : null
  if (intermit) await intermit.stop()
  return finish({ i, ctx, page, dir, rows, errs, t0, tReady, tPress, tAudible, audio,
    extra: { partiallyCachedCourse: COURSE_B, readyName, offlineLog: intermit?.log } })
}

// ── j5: screen switching ────────────────────────────────────────────────────
// Two numbers per tap: PAINTED (pixels could have changed) and INTERACTIVE
// (the thing you'd tap next is on screen and enabled). Long tasks recorded
// underneath, because a slow tap is usually a blocked main thread.
async function j5(i) {
  const session = await mintSession(TESTER)
  const dir = `${OUT}p${i}-${Date.now()}`
  await warmProfile(dir, session, COURSE_A, 15000)
  const { ctx, page } = await launch(dir, { net: NETNAME, session })
  const ref = { t0: Date.now() }
  const rows = attachWaterfall(page, ref)
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await waitReady(page, null, Date.now() + 90000)
  await page.waitForTimeout(2000)

  // A tap is measured end to end: arm the paint probe in the page, click,
  // read the paint time, then poll for the destination being interactive.
  const tap = async (label, clickFn, readySel) => {
    const probe = page.evaluate(() => window.__navProbe())
    const t0 = Date.now()
    try { await clickFn() } catch (e) { return { label, error: String(e).slice(0, 160) } }
    const painted = await probe.catch(() => null)
    let interactiveMs = null
    const dl = Date.now() + 20000
    while (Date.now() < dl) {
      if (await page.locator(readySel).first().isVisible().catch(() => false)) { interactiveMs = Date.now() - t0; break }
      await page.waitForTimeout(30)
    }
    return { label, paintedMs: painted?.paintedMs ?? null, paintKind: painted?.kind ?? null, interactiveMs }
  }

  const taps = []
  taps.push(await tap('player → library', async () => {
    await page.locator('.pill-btn').first().click({ timeout: 10000 })
  }, '.course-row, .library-screen, .browse-screen'))
  await page.waitForTimeout(1200)
  taps.push(await tap('library → back to player', async () => {
    await page.goBack()
  }, '.center-btn'))
  await page.waitForTimeout(1200)
  taps.push(await tap('player → settings', async () => {
    await page.locator('.pill-btn').last().click({ timeout: 10000 })
  }, '.settings-panel, .settings-sheet, .mode-tray, [class*="settings"]'))
  await page.waitForTimeout(1200)
  taps.push(await tap('settings → close', async () => {
    await page.locator('.pill-btn').last().click({ timeout: 10000 })
  }, '.center-btn'))

  const longTasks = await page.evaluate(() => window.__longTasks || []).catch(() => [])
  await page.screenshot({ path: `${OUT}run-${i}.png` }).catch(() => {})
  const out = { i, journey: JOURNEY, net: NETNAME, taps, longTasks: longTasks.slice(0, 40), errs }
  writeFileSync(`${OUT}run-${i}.json`, JSON.stringify({ ...out, waterfall: rows.slice(0, 150) }, null, 2))
  await ctx.close(); rmSync(dir, { recursive: true, force: true })
  log(`\n── ${JOURNEY} run ${i} (${NETNAME}) ──`)
  for (const t of taps) log(`  ${String(t.label).padEnd(28)} painted ${t.paintedMs ?? 'MISSING'}ms · interactive ${t.interactiveMs ?? 'NEVER'}ms${t.error ? ` · ${t.error}` : ''}`)
  return out
}

// ── j6: intermittent connectivity, mid-session ──────────────────────────────
// Not a latency number — a behaviour question. The learner is playing, the
// signal drops and returns repeatedly. Does it keep playing? Does it stall
// silently? Does it say something honest? Does it lose their place?
async function j6(i) {
  const session = await mintSession(TESTER)
  const dir = `${OUT}p${i}-${Date.now()}`
  await warmProfile(dir, session, COURSE_A, 25000)
  const { ctx, page, cdp } = await launch(dir, { net: 'intermittent', session })
  const ref = { t0: Date.now() }
  const rows = attachWaterfall(page, ref)
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))
  const consoleLines = []
  page.on('console', (m) => consoleLines.push(`${Date.now() - ref.t0}ms [${m.type()}] ${m.text().slice(0, 200)}`))

  const t0 = Date.now(); ref.t0 = t0
  const deadline = t0 + BUDGET
  await page.goto(BASE + '/', { waitUntil: 'commit' })
  await waitReady(page, null, deadline)
  await pressTransport(page, deadline)
  const first = await waitAudible(page, deadline)
  const tAudible = first ? Date.now() - t0 : null

  // Now punish it for 90 seconds of on/off signal while it plays.
  const positionBefore = await page.evaluate(() => {
    try { return { ls: Object.keys(localStorage).filter((k) => /position|progress|resume|lego/i.test(k)).map((k) => [k, localStorage.getItem(k)?.slice(0, 120)]) } } catch { return null }
  }).catch(() => null)

  const intermit = cycleOffline(cdp, { upMs: 5000, downMs: 6000 })
  const samples = []
  const endAt = Date.now() + 90000
  let lastAudioCount = 0
  while (Date.now() < endAt) {
    const s = await page.evaluate(() => ({
      t: Math.round(performance.now()),
      plays: (window.__audio?.srcs || []).length,
      // Anything the app is telling the learner right now.
      visibleText: Array.from(document.querySelectorAll('.toast, .banner, .offline-banner, [class*="offline"], [class*="error"], [class*="stall"], [class*="reconnect"]'))
        .map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 4),
      transportStopped: !!document.querySelector('.center-btn.is-stop'),
      btnDisabled: !!document.querySelector('.center-btn.is-disabled'),
    })).catch(() => null)
    if (s) { samples.push(s); lastAudioCount = s.plays }
    await page.waitForTimeout(2000)
  }
  await intermit.stop()
  await page.waitForTimeout(6000) // give it a fair chance to recover on a good line

  const after = await page.evaluate(() => ({
    plays: (window.__audio?.srcs || []).length,
    stillPlaying: !!document.querySelector('.center-btn.is-stop'),
  })).catch(() => null)
  const positionAfter = await page.evaluate(() => {
    try { return { ls: Object.keys(localStorage).filter((k) => /position|progress|resume|lego/i.test(k)).map((k) => [k, localStorage.getItem(k)?.slice(0, 120)]) } } catch { return null }
  }).catch(() => null)

  // Longest stretch with no new audio started = the silence the learner sat through.
  let longestGapMs = 0
  for (let k = 1; k < samples.length; k++) {
    if (samples[k].plays === samples[k - 1].plays) {
      let j = k
      while (j < samples.length && samples[j].plays === samples[k - 1].plays) j++
      longestGapMs = Math.max(longestGapMs, samples[j - 1].t - samples[k - 1].t)
      k = j
    }
  }
  const messages = [...new Set(samples.flatMap((s) => s.visibleText))]
  const out = {
    i, journey: JOURNEY, net: 'intermittent',
    t_firstAudible_ms: tAudible,
    audioStartsDuringStorm: lastAudioCount,
    audioStartsAfterRecovery: after?.plays ?? null,
    recoveredWithoutTouch: (after?.plays ?? 0) > lastAudioCount || !!after?.stillPlaying,
    longestSilenceMs: longestGapMs,
    messagesShownToLearner: messages,
    saidNothing: messages.length === 0,
    placeChanged: JSON.stringify(positionBefore) !== JSON.stringify(positionAfter),
    positionBefore, positionAfter,
    offlineTransitions: intermit.log,
    errs, consoleTail: consoleLines.slice(-40),
  }
  writeFileSync(`${OUT}run-${i}.json`, JSON.stringify({ ...out, waterfall: rows.slice(0, 200) }, null, 2))
  await page.screenshot({ path: `${OUT}run-${i}.png` }).catch(() => {})
  await ctx.close(); rmSync(dir, { recursive: true, force: true })
  log(`\n── j6 run ${i} — intermittent signal ──`)
  log(`  first word heard:        ${tAudible ?? 'NEVER'}ms`)
  log(`  longest silence:         ${longestGapMs}ms`)
  log(`  recovered untouched:     ${out.recoveredWithoutTouch}`)
  log(`  told the learner:        ${messages.length ? messages.join(' | ') : 'NOTHING'}`)
  log(`  place changed:           ${out.placeChanged}`)
  return out
}

// ── result assembly, shared by j1-j4 ────────────────────────────────────────
async function finish({ i, ctx, page, dir, rows, errs, t0, tReady, tPress, tAudible, audio, extra }) {
  const marks = await page.evaluate(() => window.__marks || []).catch(() => [])
  const longTasks = await page.evaluate(() => window.__longTasks || []).catch(() => [])
  const endMs = tAudible ?? (Date.now() - t0)
  const breakdown = legBreakdown(rows, endMs)
  // Time not explained by any network leg = compute, waiting, or deliberate
  // app-side delay (the splash floor). Named honestly rather than assumed.
  const networkBusy = Math.max(0, ...Object.values(breakdown).map((b) => b.busyMs), 0)
  const out = {
    i, journey: JOURNEY, net: NETNAME, base: BASE,
    t_ready_ms: tReady, t_press_ms: tPress, t_firstWordHeard_ms: tAudible,
    neverPlayed: tAudible == null,
    firstLessonSrc: audio?.firstLessonSrc || null,
    breakdown,
    unexplainedMs: tAudible == null ? null : Math.max(0, tAudible - networkBusy),
    longestLongTaskMs: longTasks.length ? Math.max(...longTasks.map((t) => t.dur)) : null,
    longTaskTotalMs: longTasks.reduce((a, t) => a + t.dur, 0) || 0,
    marks, errs, ...extra,
  }
  writeFileSync(`${OUT}run-${i}.json`, JSON.stringify({ ...out, waterfall: rows.slice(0, 200) }, null, 2))
  await page.screenshot({ path: `${OUT}run-${i}.png` }).catch(() => {})
  await ctx.close(); rmSync(dir, { recursive: true, force: true })
  log(`\n── ${JOURNEY} run ${i} (${NETNAME}) ──`)
  log(`  ready (screen usable):   ${tReady ?? 'NEVER'}ms`)
  log(`  press (learner taps):    ${tPress ?? 'NEVER'}ms`)
  log(`  FIRST WORD HEARD:        ${tAudible ?? 'NEVER'}ms  ${tAudible ? `(${secs(tAudible)}s)` : ''}`)
  log(`  where the time went:     ${Object.entries(breakdown).map(([k, v]) => `${k} ${v.busyMs}ms/${v.requests}`).join(', ')}`)
  if (out.longTaskTotalMs) log(`  main thread blocked:     ${out.longTaskTotalMs}ms total, worst ${out.longestLongTaskMs}ms`)
  if (errs.length) log(`  page errors: ${errs.slice(0, 3).join(' | ')}`)
  return out
}

// ── driver ──────────────────────────────────────────────────────────────────
const FN = { j1, j2, j3, j4, j5, j6 }
if (!FN[JOURNEY]) { console.error(`unknown JOURNEY "${JOURNEY}" — one of ${Object.keys(FN).join(', ')}`); process.exit(2) }

log(`BASE=${BASE} JOURNEY=${JOURNEY} NET=${NETNAME} RUNS=${RUNS}`)
const results = []
for (let i = 1; i <= RUNS; i++) {
  try { results.push(await FN[JOURNEY](i)) }
  catch (e) {
    log(`\n!! ${JOURNEY} run ${i} threw: ${String(e).slice(0, 300)}`)
    results.push({ i, journey: JOURNEY, net: NETNAME, threw: String(e).slice(0, 300) })
  }
}

const summary = { journey: JOURNEY, net: NETNAME, base: BASE, runs: RUNS, at: new Date().toISOString() }
if (JOURNEY === 'j5') {
  const labels = [...new Set(results.flatMap((r) => (r.taps || []).map((t) => t.label)))]
  summary.taps = {}
  for (const l of labels) {
    const painted = results.flatMap((r) => (r.taps || []).filter((t) => t.label === l).map((t) => t.paintedMs))
    const inter = results.flatMap((r) => (r.taps || []).filter((t) => t.label === l).map((t) => t.interactiveMs))
    summary.taps[l] = { painted: stat(painted), interactive: stat(inter) }
  }
} else if (JOURNEY === 'j6') {
  summary.firstWordHeard = stat(results.map((r) => r.t_firstAudible_ms))
  summary.longestSilence = stat(results.map((r) => r.longestSilenceMs))
  summary.recoveredUntouched = results.filter((r) => r.recoveredWithoutTouch).length
  summary.saidNothingRuns = results.filter((r) => r.saidNothing).length
  summary.placeChangedRuns = results.filter((r) => r.placeChanged).length
  summary.messages = [...new Set(results.flatMap((r) => r.messagesShownToLearner || []))]
} else {
  summary.ready = stat(results.map((r) => r.t_ready_ms))
  summary.press = stat(results.map((r) => r.t_press_ms))
  summary.firstWordHeard = stat(results.map((r) => r.t_firstWordHeard_ms))
  summary.neverPlayedRuns = results.filter((r) => r.neverPlayed || r.threw).length
  summary.unexplained = stat(results.map((r) => r.unexplainedMs))
  const legs = {}
  for (const r of results) for (const [k, v] of Object.entries(r.breakdown || {})) (legs[k] ||= []).push(v.busyMs)
  summary.legBusyMs = Object.fromEntries(Object.entries(legs).map(([k, v]) => [k, stat(v)]))
}
writeFileSync(`${OUT}summary.json`, JSON.stringify({ summary, results }, null, 2))
log('\n===== SUMMARY =====')
log(JSON.stringify(summary, null, 2))
log(`\nwritten: ${OUT}summary.json`)
