#!/usr/bin/env node
/**
 * Rebuilds docs/sector-helix/interleave-inputs.json — the real data the
 * interleave artefact (packages/player-vue/src/playback/sectorMerge.artefact.test.ts)
 * runs on. READ-ONLY.
 *
 * Two sources, both real, one of them known-side only:
 *  • CORE — live `course_legos` for spa_for_eng, seeds 1-14.
 *  • SECTOR — the health general segment HG01-HG14, parsed from the §5 "Cut:"
 *    lines of the canonical seed set. `**(new` marks a chunk that gets a round;
 *    everything else is owned from core or scene 0 and enters is_new=false.
 *
 * It must run inside the ssi-dashboard-v7-clean checkout: that repo holds both
 * the canonical seed set and the .env.psql this reads DATABASE_URL from, and its
 * node_modules holds `pg`. From this repo:
 *
 *   cd ~/SSi/ssi-dashboard-v7-clean
 *   git show origin/main:docs/sector-pods/health-general-seed-set-2026-08-31.md > /tmp/hg.md
 *   HG=/tmp/hg.md node ~/SSi/ssi-learning-app/docs/sector-helix/make-interleave-inputs.cjs
 */
const fs = require('fs');
const { Client } = require('pg');

const DATABASE_URL = /DATABASE_URL\s*=\s*"?([^"\n]+)"?/.exec(fs.readFileSync('.env.psql', 'utf8'))[1];
const HG = process.env.HG || '/tmp/hg.md';
const OUT = process.env.OUT || 'interleave-inputs.json';

(async () => {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select seed_number, lego_index, lego_id, known_text, target_text, is_new
       from course_legos where course_code='spa_for_eng' and seed_number<=14
      order by seed_number, lego_index`);
  const core = rows.map(r => ({ seed: r.seed_number, index: r.lego_index, legoId: r.lego_id,
                                known: r.known_text, target: r.target_text, isNew: r.is_new }));

  const seeds = [];
  let cur = null;
  for (const line of fs.readFileSync(HG, 'utf8').split('\n')) {
    const h = /^### (HG\d\d) — (.*)$/.exec(line);
    if (h) { cur = { id: h[1], n: seeds.length + 1, legos: [] }; seeds.push(cur); continue; }
    if (cur && cur.legos.length === 0 && /^Cut:/.test(line)) {
      for (const part of line.replace(/^Cut:\s*/, '').split('·')) {
        const chunk = /`([^`]+)`/.exec(part);
        if (!chunk) continue;
        const renamed = /\*\*\(new:\s*"([^"]+)"/.exec(part);
        cur.legos.push({ known: renamed ? renamed[1] : chunk[1], isNew: /\*\*\(new/.test(part) });
      }
    }
  }
  const sector = [];
  for (const s of seeds.slice(0, 14)) {
    s.legos.forEach((l, i) => sector.push({
      seed: s.n, index: i + 1,
      legoId: `S${String(s.n).padStart(4, '0')}L${String(i + 1).padStart(2, '0')}`,
      known: l.known, target: null, isNew: l.isNew,
    }));
  }

  fs.writeFileSync(OUT, JSON.stringify({
    provenance: {
      core: { course: 'spa_for_eng', source: 'live course_legos, read ' + new Date().toISOString().slice(0, 10), seeds: '1-14' },
      sector: { segment: 'spa_health_for_eng', role: 'general',
        source: 'ssi-dashboard-v7-clean docs/sector-pods/health-general-seed-set-2026-08-31.md on main, §5 cut lines, parsed mechanically',
        seeds: 'HG01-HG14',
        note: 'KNOWN SIDE ONLY. No target realisation exists for any sector segment anywhere in the estate; the pair overlay is an unstarted authoring job. target is null throughout and is printed as an em dash.' },
    }, core, sector,
  }, null, 1));
  console.log('core legos', core.length, 'sector legos', sector.length, 'sector rounds', sector.filter(s => s.isNew).length);
  await c.end();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
