/**
 * capture-selection-fixture — snapshot real phrase baskets for the permanent
 * selection-parity test (`packages/core/src/script/selectionParity.test.ts`).
 *
 * The parity guard has to run on every commit, offline, in CI. That means it
 * cannot query Supabase, so the DATA has to be committed. This script captures
 * the smallest slice that still exercises the real rules: the first
 * LEGOS_PER_COURSE LEGOs of each cut-over course, with only the fields
 * selection actually reads — role, position, both texts, the stored syllable
 * count, and a boolean for "has all three clips". No audio ids, no
 * decomposition, no tiling.
 *
 * Usage (from the repo root, with the dashboard repo's .env sourced):
 *   node tools/bundle-cutover/capture-selection-fixture.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const COURSES = [
  'hun_for_eng', 'gle_for_eng', 'nld_for_eng', 'tur_for_eng', 'eus_for_eng',
  'pol_for_eng', 'heb_for_eng', 'tha_for_eng', 'hin_for_eng',
  'spa_for_eng', 'fra_for_eng', 'jpn_for_eng', 'zho_for_eng', 'cym_s_for_eng',
  'zho_for_gle',
]
const LEGOS_PER_COURSE = 20

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY required')
const db = createClient(url, key)

const out = { capturedAt: new Date().toISOString(), legosPerCourse: LEGOS_PER_COURSE, courses: {} }

for (const course of COURSES) {
  const { data: rounds, error: rErr } = await db
    .from('course_round_index')
    .select('round_index, seed_number, lego_index')
    .eq('course_code', course)
    .order('round_index', { ascending: true })
    .limit(LEGOS_PER_COURSE)
  if (rErr) throw new Error(`${course} round index: ${rErr.message}`)

  const legos = []
  for (const r of rounds) {
    const { data: phrases, error: pErr } = await db
      .from('course_practice_phrases')
      .select('phrase_role, position, known_text, target_text, target_text_roman, target_syllable_count, known_audio_id, target1_audio_id, target2_audio_id')
      .eq('course_code', course)
      .eq('seed_number', r.seed_number)
      .eq('lego_index', r.lego_index)
      .in('phrase_role', ['build', 'use', 'practice', 'eternal_eligible'])
      .order('position', { ascending: true })
    if (pErr) throw new Error(`${course} phrases: ${pErr.message}`)

    legos.push({
      legoId: `S${String(r.seed_number).padStart(4, '0')}L${String(r.lego_index).padStart(2, '0')}`,
      roundIndex: r.round_index,
      phrases: phrases.map((p, i) => ({
        role: p.phrase_role === 'practice' ? 'build' : p.phrase_role === 'eternal_eligible' ? 'use' : p.phrase_role,
        // DB fetch position, which is the tie-break for equal-syllable phrases.
        position: p.position ?? i + 1,
        knownText: p.known_text ?? '',
        targetText: p.target_text ?? '',
        targetTextRoman: p.target_text_roman || undefined,
        targetSyllableCount: p.target_syllable_count || undefined,
        playable: !!(p.known_audio_id && p.target1_audio_id && p.target2_audio_id),
      })),
    })
  }
  out.courses[course] = legos
  console.error(`${course}: ${legos.length} legos, ${legos.reduce((n, l) => n + l.phrases.length, 0)} phrases`)
}

const path = 'packages/core/src/script/__fixtures__/selection-pools.json'
writeFileSync(path, JSON.stringify(out))
console.error(`wrote ${path}`)
