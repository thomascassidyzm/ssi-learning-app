#!/usr/bin/env node
/**
 * Generate demo manifests (first-seed playback) for the marketing-demo
 * custom element (<ssi-lesson-player>).
 *
 * One JSON per course, written to public/manifests/<course_code>.json.
 * Player fetches these at runtime — it never talks to Supabase directly.
 *
 * Output shape per manifest:
 *   {
 *     course_code, known_lang, target_lang, target_name, known_name, flag_emoji,
 *     seed: { known_text, target_text },
 *     cycles: [
 *       { known_text, target_text, known_audio_id, target1_audio_id, target2_audio_id,
 *         type: 'lego' | 'build', belt_progress }
 *     ]
 *   }
 *
 * Audio URLs are NOT baked in — the player resolves via <base-url>/api/audio/{id}.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/build-manifests.cjs
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Fall back to dashboard's .env if learning-app doesn't have it
if (!process.env.SUPABASE_URL) {
  require('dotenv').config({ path: '/Users/tomcassidy/SSi/ssi-dashboard-v7-clean/.env' });
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// The 11 demo courses: Big 10 (minus English) for English speakers + Welsh N/S
const COURSES = [
  { code: 'spa_for_eng',   target_name: 'Spanish',    flag: '🇪🇸' },
  { code: 'fra_for_eng',   target_name: 'French',     flag: '🇫🇷' },
  { code: 'deu_for_eng',   target_name: 'German',     flag: '🇩🇪' },
  { code: 'ita_for_eng',   target_name: 'Italian',    flag: '🇮🇹' },
  { code: 'por_for_eng',   target_name: 'Portuguese', flag: '🇵🇹' },
  { code: 'zho_for_eng',   target_name: 'Chinese',    flag: '🇨🇳' },
  { code: 'jpn_for_eng',   target_name: 'Japanese',   flag: '🇯🇵' },
  { code: 'ara_for_eng',   target_name: 'Arabic',     flag: '🇸🇦' },
  { code: 'kor_for_eng',   target_name: 'Korean',     flag: '🇰🇷' },
  { code: 'cym_n_for_eng', target_name: 'Welsh (North)', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  { code: 'cym_s_for_eng', target_name: 'Welsh (South)', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
];

const OUTPUT_DIR = path.resolve(__dirname, '../public/manifests');

// ---------------------------------------------------------------------------

async function buildCycles(courseCode) {
  // 1. First seed (seed_number = 1)
  const { data: seed, error: seedErr } = await supabase
    .from('course_seeds').select('*')
    .eq('course_code', courseCode).eq('seed_number', 1).single();
  if (seedErr || !seed) throw new Error(`seed 1 missing: ${seedErr?.message || 'no row'}`);

  // 2. LEGOs for seed 1, in order
  const { data: legos } = await supabase
    .from('course_legos')
    .select('lego_index, type, known_text, target_text, known_audio_id, target1_audio_id, target2_audio_id')
    .eq('course_code', courseCode).eq('seed_number', 1)
    .order('lego_index');
  if (!legos || !legos.length) throw new Error('no legos');

  // 3. BUILD practice phrases for seed 1, in position order
  const { data: phrases } = await supabase
    .from('course_practice_phrases')
    .select('lego_index, position, phrase_role, known_text, target_text, known_audio_id, target1_audio_id, target2_audio_id')
    .eq('course_code', courseCode).eq('seed_number', 1)
    .eq('phrase_role', 'build')
    .order('lego_index').order('position');

  // Build the cycle sequence: for each lego, play it alone, then any build
  // phrases that appear just after it.
  const cycles = [];
  const buildsByLego = {};
  for (const p of (phrases || [])) {
    (buildsByLego[p.lego_index] ||= []).push(p);
  }

  for (const lego of legos) {
    // Skip if no audio — can't demo what we can't play
    if (!lego.known_audio_id || !lego.target1_audio_id) continue;
    cycles.push({
      type: 'lego',
      lego_index: lego.lego_index,
      known_text: lego.known_text,
      target_text: lego.target_text,
      known_audio_id: lego.known_audio_id,
      target1_audio_id: lego.target1_audio_id,
      target2_audio_id: lego.target2_audio_id || lego.target1_audio_id,
    });
    // Add at most 1 BUILD that actually combines multiple pieces (text longer than the lego alone)
    const candidates = (buildsByLego[lego.lego_index] || [])
      .filter(p => p.target_text && p.target_text.length > (lego.target_text || '').length)
      .filter(p => p.known_audio_id && p.target1_audio_id);
    if (candidates.length) {
      const pick = candidates[0];
      cycles.push({
        type: 'build',
        lego_index: lego.lego_index,
        known_text: pick.known_text,
        target_text: pick.target_text,
        known_audio_id: pick.known_audio_id,
        target1_audio_id: pick.target1_audio_id,
        target2_audio_id: pick.target2_audio_id || pick.target1_audio_id,
      });
    }
  }

  // Annotate belt progress (0 → 1) linearly across cycles
  cycles.forEach((c, i) => {
    c.belt_progress = cycles.length > 1 ? i / (cycles.length - 1) : 0;
  });

  return { seed, cycles };
}

// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const summary = [];

  for (const c of COURSES) {
    try {
      console.log(`→ ${c.code}`);
      const { seed, cycles } = await buildCycles(c.code);

      // Get course display metadata
      const { data: course } = await supabase
        .from('courses').select('display_name, known_lang, target_lang').eq('course_code', c.code).single();

      const manifest = {
        course_code: c.code,
        known_lang: course?.known_lang || 'eng',
        target_lang: course?.target_lang || 'unknown',
        known_name: 'English',
        target_name: c.target_name,
        flag_emoji: c.flag,
        display_name: course?.display_name || `${c.target_name} for English Speakers`,
        seed: {
          known_text: seed.known_text,
          target_text: seed.target_text,
        },
        cycles,
      };

      const outPath = path.join(OUTPUT_DIR, `${c.code}.json`);
      fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
      console.log(`  ${cycles.length} cycles → ${outPath}`);
      summary.push({ code: c.code, name: c.target_name, cycles: cycles.length, ok: true });
    } catch (err) {
      console.error(`  ✗ ${c.code}: ${err.message}`);
      summary.push({ code: c.code, name: c.target_name, ok: false, error: err.message });
    }
  }

  // Write index file: list of available courses + counts
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      courses: summary.filter(s => s.ok).map(s => ({
        code: s.code,
        name: COURSES.find(c => c.code === s.code).target_name,
        flag: COURSES.find(c => c.code === s.code).flag,
        cycle_count: s.cycles,
      })),
    }, null, 2)
  );

  const ok = summary.filter(s => s.ok).length;
  const fail = summary.filter(s => !s.ok).length;
  console.log(`\nDone. ${ok}/${summary.length} manifests written, ${fail} failures.`);
}

main().catch(e => { console.error(e); process.exit(1); });
