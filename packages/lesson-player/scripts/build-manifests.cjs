#!/usr/bin/env node
/**
 * Generate demo manifests for <ssi-lesson-player>.
 *
 * Source of truth: the production-api /api/production/:courseCode/learning-journey
 * endpoint, which assembles the REAL round structure used by the native app:
 * INTRO + DEBUT + BUILD × N + REVIEW (spaced rep) + CONSOLIDATE.
 *
 * That means manifests now contain every cycle type — including the
 * "presentation_audio" narration that teaches each new LEGO ("The French
 * for 'I want' is 'je veux'").
 *
 * Output shape per manifest:
 *   {
 *     course_code, known_lang, target_lang, target_name, known_name, flag_emoji,
 *     seed: { known_text, target_text },
 *     cycles: [
 *       {
 *         type: 'intro'|'debut'|'build'|'review'|'consolidate'|'component_intro'|'component_practice',
 *         round_number, lego_id,
 *         known_text, target_text,
 *         // INTRO types:
 *         presentation_audio_id,
 *         // Everything else:
 *         known_audio_id, target1_audio_id, target2_audio_id,
 *         belt_progress
 *       }
 *     ]
 *   }
 *
 * Usage:
 *   PRODUCTION_API=http://localhost:3470 node scripts/build-manifests.cjs
 */

const fs = require('fs');
const path = require('path');

const PROD_API = process.env.PRODUCTION_API || 'http://localhost:3470';
const MAX_LEGOS = 25;  // ~150-180 items = ~25-30 minutes of content

// The 11 demo courses
const COURSES = [
  { code: 'spa_for_eng',   target_name: 'Spanish',       flag: '🇪🇸' },
  { code: 'fra_for_eng',   target_name: 'French',        flag: '🇫🇷' },
  { code: 'deu_for_eng',   target_name: 'German',        flag: '🇩🇪' },
  { code: 'ita_for_eng',   target_name: 'Italian',       flag: '🇮🇹' },
  { code: 'por_for_eng',   target_name: 'Portuguese',    flag: '🇵🇹' },
  { code: 'zho_for_eng',   target_name: 'Chinese',       flag: '🇨🇳' },
  { code: 'jpn_for_eng',   target_name: 'Japanese',      flag: '🇯🇵' },
  { code: 'ara_for_eng',   target_name: 'Arabic',        flag: '🇸🇦' },
  { code: 'kor_for_eng',   target_name: 'Korean',        flag: '🇰🇷' },
  { code: 'cym_n_for_eng', target_name: 'Welsh (North)', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  { code: 'cym_s_for_eng', target_name: 'Welsh (South)', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
];

const OUTPUT_DIR = path.resolve(__dirname, '../public/manifests');

// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function buildCycles(courseCode) {
  const url = `${PROD_API}/api/production/${courseCode}/learning-journey?maxLegos=${MAX_LEGOS}`;
  const data = await fetchJson(url);

  // allItems is already a flat, ordered list of every cycle-playable item
  // (across all rounds). Map it into the manifest cycle shape.
  const items = data.allItems || [];
  if (items.length === 0) throw new Error('no items returned');

  const cycles = items.map((it, i) => {
    const base = {
      type: it.type,
      round_number: it.roundNumber,
      lego_id: it.legoId,
      known_text: it.known_text,
      target_text: it.target_text,
      target1_audio_id: it.target1_audio_uuid,
      target2_audio_id: it.target2_audio_uuid,
    };
    // INTRO-type cycles carry a presentation_audio (narration), no known_audio.
    // All other types carry a known_audio for the 4-phase prompt.
    if (it.type === 'intro' || it.type === 'component_intro') {
      base.presentation_audio_id = it.presentation_audio?.id || null;
    } else {
      base.known_audio_id = it.known_audio_uuid;
    }
    return base;
  });

  // Skip any cycles that have no playable target audio — the player can't run them.
  const playable = cycles.filter(c => c.target1_audio_id);
  if (playable.length === 0) throw new Error('no playable cycles (missing target audio)');

  // Linear belt progress (the real app has belt thresholds, but for a demo
  // linear is fine — white belt fills up as the lesson progresses).
  playable.forEach((c, i) => {
    c.belt_progress = playable.length > 1 ? i / (playable.length - 1) : 0;
  });

  return { stats: data.stats, cycles: playable, totalLegoCount: data.totalLegoCount };
}

async function fetchCourseInfo(courseCode) {
  // Use dashboard's Supabase client via the same production-api
  try {
    const url = `${PROD_API}/api/production/${courseCode}/info`;
    const res = await fetch(url);
    if (res.ok) {
      const d = await res.json();
      return d.course || d;
    }
  } catch (e) {
    // fall through
  }
  return null;
}

async function fetchSeed1(courseCode) {
  try {
    const url = `${PROD_API}/api/production/${courseCode}/script-view?seedStart=1&seedEnd=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    return d.seeds?.[0] || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const summary = [];

  for (const c of COURSES) {
    try {
      console.log(`→ ${c.code}`);
      const { cycles, stats } = await buildCycles(c.code);
      const course = await fetchCourseInfo(c.code);
      const seed1 = await fetchSeed1(c.code);

      const manifest = {
        course_code: c.code,
        known_lang: course?.known_lang || 'eng',
        target_lang: course?.target_lang || 'unknown',
        known_name: 'English',
        target_name: c.target_name,
        flag_emoji: c.flag,
        display_name: course?.display_name || `${c.target_name} for English Speakers`,
        seed: seed1 ? {
          known_text: seed1.known_text,
          target_text: seed1.target_text,
        } : null,
        stats: {
          source_total_items: stats?.totalItems || cycles.length,
          source_rounds: stats?.totalRounds || null,
          playable_cycles: cycles.length,
          approximate_duration_seconds: Math.round(cycles.length * 11), // rough avg 11s/cycle
        },
        cycles,
      };

      const outPath = path.join(OUTPUT_DIR, `${c.code}.json`);
      fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
      const mins = Math.round(manifest.stats.approximate_duration_seconds / 60);
      console.log(`  ${cycles.length} cycles (~${mins}m) → ${outPath}`);
      summary.push({ code: c.code, name: c.target_name, cycles: cycles.length, minutes: mins, ok: true });
    } catch (err) {
      console.error(`  ✗ ${c.code}: ${err.message}`);
      summary.push({ code: c.code, name: c.target_name, ok: false, error: err.message });
    }
  }

  // Index file
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      source_api: PROD_API,
      max_legos_per_course: MAX_LEGOS,
      courses: summary.filter(s => s.ok).map(s => ({
        code: s.code,
        name: COURSES.find(c => c.code === s.code).target_name,
        flag: COURSES.find(c => c.code === s.code).flag,
        cycle_count: s.cycles,
        approximate_minutes: s.minutes,
      })),
    }, null, 2)
  );

  const ok = summary.filter(s => s.ok).length;
  const fail = summary.filter(s => !s.ok).length;
  console.log(`\n${ok}/${summary.length} manifests built, ${fail} failures.`);
  if (fail > 0) {
    summary.filter(s => !s.ok).forEach(s => console.log(`  ✗ ${s.code}: ${s.error}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
