#!/usr/bin/env node
/**
 * audit-broken-target2.mjs — READ-ONLY. Find course_audio rows whose clip is a
 * TTS failure stub rather than real speech.
 *
 * Why this exists: on 2026-08-03 the French course was re-TTS'd end to end and
 * the `leo` target2 voice returned a fixed ~144 ms artifact for ~5% of items.
 * The row looks healthy (a real id, a real s3_key, a duration_ms) so nothing
 * downstream complains — but the learner hears silence where the second voice
 * should be, AND the pause after that cycle collapses, because
 * computePauseDuration sizes the gap off the NATIVE t1+t2 clip durations.
 *
 * Two independent signals, neither of which needs the audio to be downloaded:
 *   1. absolute:  duration_ms < FLOOR_MS  (a real utterance is never this short)
 *   2. relative:  target2 shorter than half its own target1 for the same text
 *
 * Usage:
 *   node scripts/audit-broken-target2.mjs                  # every course, summary
 *   node scripts/audit-broken-target2.mjs fra_for_eng      # one course, with examples
 *
 * Credentials: reads SUPABASE_SERVICE_ROLE_KEY from the environment. Source
 * Tom's key file first — it is deliberately NOT in this repo:
 *   set -a; . ~/.ssi-sentinel.env; set +a
 * Falls back to the public publishable key, which is enough for content tables.
 */

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const PUBLISHABLE_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || PUBLISHABLE_KEY

/** Below this, a clip cannot be a spoken word — it is a failure stub. */
const FLOOR_MS = 400
/** target2 this much shorter than its own target1 is not a voice difference. */
const RATIO = 0.5

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}: ${body}`)
  return body ? JSON.parse(body) : null
}

/** Both failure signals for one course, plus the batch that produced them. */
async function auditCourse(courseCode) {
  const rows = await rest(
    `course_audio?select=id,text_normalized,role,duration_ms,voice_id,created_at` +
      `&course_code=eq.${courseCode}&role=in.(target1,target2)&limit=200000`
  )

  const byText = new Map()
  for (const r of rows) {
    if (!byText.has(r.text_normalized)) byText.set(r.text_normalized, {})
    byText.get(r.text_normalized)[r.role] = r
  }

  const broken = []
  for (const r of rows) {
    if (r.role !== 'target2' || !r.duration_ms) continue
    const t1 = byText.get(r.text_normalized)?.target1
    const tooShort = r.duration_ms < FLOOR_MS
    const tooRelative = t1?.duration_ms && r.duration_ms < RATIO * t1.duration_ms
    if (tooShort || tooRelative) {
      broken.push({ ...r, target1Ms: t1?.duration_ms ?? null, reason: tooShort ? 'floor' : 'ratio' })
    }
  }

  const total = rows.filter((r) => r.role === 'target2').length
  return { courseCode, total, broken }
}

/** Identical durations across unrelated texts is the fingerprint of a stub. */
function fingerprint(broken) {
  const counts = new Map()
  for (const b of broken) counts.set(b.duration_ms, (counts.get(b.duration_ms) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
}

async function main() {
  const only = process.argv[2]
  const courses = only
    ? [{ course_code: only }]
    : await rest('courses?select=course_code&order=course_code')

  const results = []
  for (const c of courses) {
    try {
      const r = await auditCourse(c.course_code)
      if (r.total) results.push(r)
    } catch (err) {
      console.error(`  ! ${c.course_code}: ${err.message}`)
    }
  }

  results.sort((a, b) => b.broken.length / (b.total || 1) - a.broken.length / (a.total || 1))

  console.log(`\n${'course'.padEnd(18)}${'target2'.padStart(9)}${'broken'.padStart(9)}${'pct'.padStart(8)}`)
  for (const r of results) {
    if (!r.broken.length && !only) continue
    const pct = ((100 * r.broken.length) / r.total).toFixed(2)
    console.log(`${r.courseCode.padEnd(18)}${String(r.total).padStart(9)}${String(r.broken.length).padStart(9)}${(pct + '%').padStart(8)}`)
  }

  if (only && results[0]?.broken.length) {
    const { broken } = results[0]
    console.log(`\nduration fingerprint (identical ms across unrelated texts = one stub artifact):`)
    for (const [ms, n] of fingerprint(broken)) console.log(`  ${ms} ms × ${n}`)

    console.log(`\nbatches that produced them:`)
    const batches = new Map()
    for (const b of broken) {
      const k = `${b.created_at.slice(0, 10)}  voice=${b.voice_id}`
      batches.set(k, (batches.get(k) || 0) + 1)
    }
    for (const [k, n] of [...batches].sort((a, b) => b[1] - a[1])) console.log(`  ${k}  ×${n}`)

    console.log(`\nexamples:`)
    for (const b of broken.slice(0, 12)) {
      console.log(`  ${String(b.duration_ms).padStart(6)} ms (target1 ${b.target1Ms} ms)  ${b.text_normalized}`)
    }
  }
  console.log()
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
