#!/usr/bin/env node
/**
 * a22-dead-audio-census.mjs — find DANGLING audio references across the estate.
 *
 * The A-22 failure class: a lego/phrase row carries a NON-NULL audio id that has
 * NO ROW in course_audio. The player requests /api/audio/<id>, the proxy 404s,
 * the media element reports errorCode 4, and (pre-f30f9d39) the session halted.
 *
 * NOTE the distinction that makes this census meaningful: CourseDataProvider
 * already filters out rows where any of the three audio ids IS NULL
 * (`.not('known_audio_id','is',null)` etc), so a NULL id is invisible to the
 * player and harmless. Only a PRESENT-BUT-DANGLING id reaches the network and
 * can kill a clip. This script counts exactly those.
 *
 * SAFETY: read-only. Requires SUPABASE_SERVICE_ROLE_KEY in the environment —
 * the learner-side and full content tables are not visible to the public key.
 * Source it, never print it:
 *   set -a; . ~/.ssi-sentinel.env; set +a; node scripts/a22-dead-audio-census.mjs
 *
 * Output: JSON report on stdout (redirect to a file).
 */

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set — source ~/.ssi-sentinel.env first')
  process.exit(1)
}
const BASE = 'https://swfvymspfxmnfhevgdkg.supabase.co/rest/v1/'
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const PAGE = 10000

const log = (...a) => console.error('[census]', ...a)

async function rest(path) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(BASE + path, { headers: HEADERS })
      if (res.ok) return await res.json()
      if (res.status >= 500 && attempt < 4) { await sleep(500 * attempt); continue }
      throw new Error(`HTTP ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`)
    } catch (err) {
      if (attempt === 4) throw err
      await sleep(500 * attempt)
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Keyset-paginate a table ordered by uuid `id`. Random uuid order is fine —
 * we only need every row exactly once, and keyset survives concurrent writes
 * in a way that OFFSET does not.
 */
async function* scan(table, select) {
  let after = '00000000-0000-0000-0000-000000000000'
  let seen = 0
  for (;;) {
    const rows = await rest(
      `${table}?select=${select}&order=id.asc&id=gt.${after}&limit=${PAGE}`,
    )
    if (!rows.length) return
    seen += rows.length
    yield rows
    after = rows[rows.length - 1].id
    if (seen % 200000 < PAGE) log(`${table}: ${seen} rows`)
  }
}

/** course_practice_phrases has a TEXT primary key (e.g. zho_for_eng:S0514L01U01). */
async function* scanText(table, select) {
  let after = ''
  let seen = 0
  for (;;) {
    const rows = await rest(
      `${table}?select=${select}&order=id.asc&id=gt.${encodeURIComponent(after)}&limit=${PAGE}`,
    )
    if (!rows.length) return
    seen += rows.length
    yield rows
    after = rows[rows.length - 1].id
    if (seen % 200000 < PAGE) log(`${table}: ${seen} rows`)
  }
}

async function main() {
  // ---- Phase A: every audio id that EXISTS ------------------------------
  log('loading course_audio ids…')
  const live = new Set()
  for await (const rows of scan('course_audio', 'id')) for (const r of rows) live.add(r.id)
  log(`course_audio: ${live.size} ids`)
  for await (const rows of scan('shared_audio', 'id')) for (const r of rows) live.add(r.id)
  log(`+ shared_audio → ${live.size} ids total`)

  // ---- courses table ----------------------------------------------------
  const courses = await rest('courses?select=course_code,status,legacy_app_status')
  const meta = new Map(courses.map((c) => [c.course_code, c]))
  log(`courses: ${courses.length}`)

  // ---- Phase B: walk every row that carries audio references ------------
  // per course: { legos: {...}, phrases: {...}, holes: [...] }
  const acc = new Map()
  const bucket = (code) => {
    if (!acc.has(code)) {
      acc.set(code, {
        course_code: code,
        status: meta.get(code)?.status ?? 'UNKNOWN_no_courses_row',
        legacy_app_status: meta.get(code)?.legacy_app_status ?? null,
        legos_total: 0, legos_with_hole: 0, legos_fully_dead: 0,
        phrases_total: 0, phrases_with_hole: 0, phrases_fully_dead: 0,
        dead_ids: new Set(),
        holes: [], // {kind, lego_id, seed_number, lego_index, roles:[], phrase_role, status}
      })
    }
    return acc.get(code)
  }

  const ROLES = [
    ['known_audio_id', 'known'],
    ['target1_audio_id', 'target1'],
    ['target2_audio_id', 'target2'],
  ]

  const inspect = (row, kind, b) => {
    const present = []
    const dead = []
    for (const [col, role] of ROLES) {
      const id = row[col]
      if (!id) continue // NULL — provider filters this row out entirely; invisible to the player
      present.push(role)
      if (!live.has(id)) { dead.push(role); b.dead_ids.add(id) }
    }
    if (!dead.length) return null
    return { present, dead, allDead: dead.length === present.length && present.length > 0 }
  }

  log('scanning course_legos…')
  for await (const rows of scan('course_legos', 'id,course_code,seed_number,lego_index,lego_id,status,known_audio_id,target1_audio_id,target2_audio_id')) {
    for (const row of rows) {
      const b = bucket(row.course_code)
      b.legos_total++
      const r = inspect(row, 'lego', b)
      if (!r) continue
      b.legos_with_hole++
      if (r.allDead) b.legos_fully_dead++
      b.holes.push({
        kind: 'lego',
        lego_id: row.lego_id,
        seed_number: row.seed_number,
        lego_index: row.lego_index,
        row_status: row.status,
        dead_roles: r.dead,
        all_three_dead: r.allDead,
      })
    }
  }

  log('scanning course_practice_phrases…')
  for await (const rows of scanText('course_practice_phrases', 'id,course_code,seed_number,lego_index,phrase_role,status,known_audio_id,target1_audio_id,target2_audio_id')) {
    for (const row of rows) {
      const b = bucket(row.course_code)
      b.phrases_total++
      const r = inspect(row, 'phrase', b)
      if (!r) continue
      b.phrases_with_hole++
      if (r.allDead) b.phrases_fully_dead++
      b.holes.push({
        kind: 'phrase',
        phrase_id: row.id,
        seed_number: row.seed_number,
        lego_index: row.lego_index,
        phrase_role: row.phrase_role,
        row_status: row.status,
        dead_roles: r.dead,
        all_three_dead: r.allDead,
      })
    }
  }

  // ---- Phase C: shape the report ---------------------------------------
  const out = []
  for (const b of acc.values()) {
    // Earliest hole = the one everyone walks into. Components are skipped at
    // runtime, so rank the earliest hole on NON-component rows.
    const playable = b.holes.filter((h) => h.phrase_role !== 'component')
    const earliest = playable.reduce(
      (min, h) => (min === null || h.seed_number < min.seed_number ? h : min),
      null,
    )
    out.push({
      ...b,
      dead_ids: undefined,
      dead_id_count: b.dead_ids.size,
      holes: undefined,
      holes_total: b.holes.length,
      holes_playable: playable.length,
      holes_component_only: b.holes.length - playable.length,
      earliest_playable_hole: earliest
        ? {
            seed_number: earliest.seed_number,
            lego_index: earliest.lego_index,
            kind: earliest.kind,
            dead_roles: earliest.dead_roles,
            all_three_dead: earliest.all_three_dead,
          }
        : null,
      all_holes: b.holes,
    })
  }
  out.sort((a, b) => b.holes_playable - a.holes_playable)

  console.log(JSON.stringify({
    generated_for: 'A-22 estate dead-audio census',
    live_audio_ids: live.size,
    courses_scanned: acc.size,
    courses_in_courses_table: courses.length,
    courses: out,
  }, null, 2))
  log('done')
}

main().catch((e) => { console.error('[census] FAILED:', e.message); process.exit(1) })
