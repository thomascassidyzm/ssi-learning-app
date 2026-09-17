// Language-competence specimens — one static page from one real class's ledger.
// Input: $CS_SCRATCH/data.json (pulled live 2026-09-17). Output: index.html beside this file.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const D = JSON.parse(readFileSync(process.argv[2] || join(process.env.CS_SCRATCH, 'data.json')))

const CLASS = D.classes.find(c => c.class_name === 'Grade 8A')
const OTHERS = D.classes.filter(c => c.id !== CLASS.id)
const MOMENTS = [
  { key: 'A', label: 'Week of 20 July', cutoff: '2026-07-26T23:59:59Z' },
  { key: 'B', label: 'Week of 14 September', cutoff: '2026-09-20T23:59:59Z' },
]
const OFFSETS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
const INK = '#26357a', INK2 = '#5b6cc7', SCHOOL = '#b9b1a6', UNREACHED = '#e4dfd8', PAPER = '#fbfaf8'

function courseOf(code) {
  const legos = (code === 'eng_for_mar' ? D.all_legos_mar : D.all_legos_hin)
  const ord = new Map(); const perSeed = new Map()
  legos.forEach((l, i) => { ord.set(l.lego_id, i + 1); perSeed.set(l.seed_number, (perSeed.get(l.seed_number) || 0) + 1) })
  const seedPos = (l) => l.seed_number + (l.lego_index - 1) / perSeed.get(l.seed_number)
  const phrases = (code === 'eng_for_mar' ? D.phrases_eng_for_mar : D.phrases_eng_for_hin).filter(p => p.phrase_role !== 'component')
  const byLego = new Map()
  for (const p of phrases) {
    p.legoId = `S${String(p.seed_number).padStart(4, '0')}L${String(p.lego_index).padStart(2, '0')}`
    p.legos = [...new Set((p.decomposition || []).map(x => x.legoId).filter(id => id && ord.has(id)))]
    if (!byLego.has(p.legoId)) byLego.set(p.legoId, { build: [], use: [] })
    byLego.get(p.legoId)[p.phrase_role === 'use' ? 'use' : 'build'].push(p)
  }
  for (const v of byLego.values()) { v.build.sort((a, b) => a.position - b.position); v.use.sort((a, b) => a.position - b.position) }
  return { code, legos, ord, seedPos, phrases, byLego }
}
const COURSES = { eng_for_mar: courseOf('eng_for_mar'), eng_for_hin: courseOf('eng_for_hin') }

// The class's play state at a cutoff: round plays from the ledger, phrase plays from the round shape.
function playState(cls, cutoff) {
  const C = COURSES[cls.course_code]
  const sits = D.class_sessions.filter(s => s.class_id === cls.id && s.started_at <= cutoff)
  const roundPlays = new Map()
  let firstStart = Infinity
  for (const s of sits) {
    const a = C.ord.get(s.start_lego_id), b = C.ord.get(s.end_lego_id); if (!a || !b) continue
    firstStart = Math.min(firstStart, a)
    for (let o = Math.min(a, b); o <= Math.max(a, b); o++) roundPlays.set(o, (roundPlays.get(o) || 0) + 1)
  }
  let cursorOnly = 0
  if (firstStart < Infinity) for (let o = 1; o < firstStart; o++) if (!roundPlays.has(o)) { roundPlays.set(o, 1); cursorOnly++ }
  const highest = Math.max(0, ...roundPlays.keys())
  const phrasePlays = new Map()
  const bump = (p, n) => { if (p) phrasePlays.set(p.id, (phrasePlays.get(p.id) || 0) + n) }
  for (const [k, n] of roundPlays) {
    const own = C.byLego.get(C.legos[k - 1].lego_id); if (!own) continue
    for (const p of own.build) bump(p, n)
    for (const p of own.use) bump(p, n)
    for (const off of OFFSETS) {
      const j = k - off; if (j < 1) continue
      const older = C.byLego.get(C.legos[j - 1].lego_id); if (!older || !older.use.length) continue
      if (off === 1) older.use.slice(0, 3).forEach(p => bump(p, n))
      else bump(older.use[k % older.use.length], n)
    }
  }
  return { C, sits: sits.length, roundPlays, phrasePlays, highest, cursorOnly, highestSeed: highest ? C.legos[highest - 1].seed_number : 0 }
}
const STATES = {}
for (const m of MOMENTS) STATES[m.key] = { cls: playState(CLASS, m.cutoff), others: OTHERS.map(o => ({ o, s: playState(o, m.cutoff) })) }

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const lg = (n, max) => Math.log1p(n) / Math.log1p(max || 1)

// ---------- 1. ARC DIAGRAM ----------
function arcDiagram(m) {
  const S = STATES[m.key]; const C = COURSES.eng_for_mar
  const SEEDS = 44, W = 1100, H = 420, L = 30, R = 20, Y = 250
  const X = pos => L + (pos - 1) / SEEDS * (W - L - R)
  let g = ''
  // school arcs (below), from the other classes' own course, placed by seed
  const sAgg = new Map(); let sMax = 1
  for (const { s } of S.others) for (const p of s.C.phrases) { const n = s.phrasePlays.get(p.id); if (!n || p.legos.length < 2) continue
    const xs = p.legos.map(id => s.C.seedPos(s.C.legos[s.C.ord.get(id) - 1])).filter(x => x); if (xs.length < 2) continue
    const k = Math.min(...xs).toFixed(2) + '|' + Math.max(...xs).toFixed(2); sAgg.set(k, (sAgg.get(k) || 0) + n); sMax = Math.max(sMax, sAgg.get(k)) }
  for (const [k, n] of sAgg) { const [a, b] = k.split('|').map(Number); if (b > SEEDS + 1) continue; const x1 = X(a), x2 = X(b), r = (x2 - x1) / 2
    g += `<path d="M${x1} ${Y} A${r} ${r * 0.9} 0 0 0 ${x2} ${Y}" fill="none" stroke="${SCHOOL}" stroke-opacity="0.5" stroke-width="${(0.5 + 2.5 * lg(n, sMax)).toFixed(2)}"/>` }
  // class arcs (above)
  const cAgg = new Map(); let cMax = 1
  for (const p of C.phrases) { const n = S.cls.phrasePlays.get(p.id); if (!n || p.legos.length < 2) continue
    const xs = p.legos.map(id => C.seedPos(C.legos[C.ord.get(id) - 1])).filter(x => x); if (xs.length < 2) continue
    const k = Math.min(...xs).toFixed(2) + '|' + Math.max(...xs).toFixed(2); cAgg.set(k, (cAgg.get(k) || 0) + n); cMax = Math.max(cMax, cAgg.get(k)) }
  for (const [k, n] of [...cAgg].sort((a, b) => a[1] - b[1])) { const [a, b] = k.split('|').map(Number); const x1 = X(a), x2 = X(b), r = (x2 - x1) / 2
    g += `<path d="M${x1} ${Y} A${r} ${r * 0.9} 0 0 1 ${x2} ${Y}" fill="none" stroke="${INK}" stroke-opacity="${(0.25 + 0.6 * lg(n, cMax)).toFixed(2)}" stroke-width="${(0.6 + 3 * lg(n, cMax)).toFixed(2)}"/>` }
  // the line of LEGOs
  const schoolReachSeed = Math.max(0, ...S.others.map(x => x.s.highestSeed))
  g += `<line x1="${X(1)}" y1="${Y}" x2="${X(SEEDS + 1)}" y2="${Y}" stroke="${UNREACHED}" stroke-width="3"/>`
  if (schoolReachSeed) g += `<line x1="${X(1)}" y1="${Y + 6}" x2="${X(Math.min(SEEDS + 1, schoolReachSeed + 1))}" y2="${Y + 6}" stroke="${SCHOOL}" stroke-width="3"/>`
  for (const l of C.legos) { if (l.seed_number > SEEDS) break; const o = C.ord.get(l.lego_id), n = S.cls.roundPlays.get(o) || 0
    g += `<circle cx="${X(C.seedPos(l))}" cy="${Y}" r="${n ? 3.2 : 2}" fill="${n ? INK : UNREACHED}" stroke="${PAPER}" stroke-width="0.8"/>` }
  for (let s = 1; s <= SEEDS; s += (s === 1 ? 4 : 5)) g += `<text x="${X(s)}" y="${Y + 28}" font-size="12" fill="#8a8378" text-anchor="middle">${s === 1 ? 'seed 1' : s}</text>`
  return svg(W, H, g)
}

// ---------- 2. METAGRAPH ----------
function metagraph(m) {
  const S = STATES[m.key]; const C = COURSES.eng_for_mar
  const SEEDS = 30, W = 1100, L = 20, R = 20
  const legos = C.legos.filter(l => l.seed_number <= SEEDS)
  const phrases = C.phrases.filter(p => p.seed_number <= SEEDS)
  const ys = { seed: 40, lego: 150, phrase: 290 }
  const seedX = new Map(); const seedW = (W - L - R) / SEEDS
  for (let s = 1; s <= SEEDS; s++) seedX.set(s, L + (s - 1) * seedW + seedW / 2)
  const legoX = new Map(); const lw = (W - L - R) / legos.length
  legos.forEach((l, i) => legoX.set(l.lego_id, L + i * lw + lw / 2))
  const phX = new Map(); const pw = (W - L - R) / phrases.length
  phrases.forEach((p, i) => phX.set(p.id, L + i * pw + pw / 2))
  const schoolSeed = Math.max(0, ...S.others.map(x => x.s.highestSeed))
  let g = ''
  if (schoolSeed) g += `<rect x="${L}" y="20" width="${Math.min(SEEDS, schoolSeed) * seedW}" height="300" fill="${SCHOOL}" fill-opacity="0.18" rx="6"/>`
  // edges phrase -> lego, lego -> seed
  for (const p of phrases) { const n = S.cls.phrasePlays.get(p.id) || 0; for (const id of p.legos) { const x2 = legoX.get(id); if (!x2) continue
    g += `<line x1="${phX.get(p.id).toFixed(1)}" y1="${ys.phrase - 8}" x2="${x2.toFixed(1)}" y2="${ys.lego + 12}" stroke="${n ? INK : UNREACHED}" stroke-opacity="${n ? 0.35 : 0.5}" stroke-width="${n ? 0.5 : 0.35}" ${n ? '' : 'stroke-dasharray="2 3"'}/>` } }
  for (const l of legos) { const o = C.ord.get(l.lego_id), n = S.cls.roundPlays.get(o) || 0
    g += `<line x1="${legoX.get(l.lego_id).toFixed(1)}" y1="${ys.lego - 10}" x2="${seedX.get(l.seed_number).toFixed(1)}" y2="${ys.seed + 12}" stroke="${n ? INK : UNREACHED}" stroke-width="${n ? 1 : 0.6}" ${n ? '' : 'stroke-dasharray="3 3"'}/>` }
  // tiles
  for (let s = 1; s <= SEEDS; s++) { const reached = s <= S.cls.highestSeed
    g += `<rect x="${(seedX.get(s) - seedW / 2 + 3).toFixed(1)}" y="${ys.seed - 12}" width="${(seedW - 6).toFixed(1)}" height="24" rx="4" fill="${reached ? INK : PAPER}" stroke="${reached ? INK : '#c9c2b8'}" ${reached ? '' : 'stroke-dasharray="3 2"'}/>`
    g += `<text x="${seedX.get(s).toFixed(1)}" y="${ys.seed + 4}" font-size="10" text-anchor="middle" fill="${reached ? PAPER : '#a39b90'}">${s}</text>` }
  for (const l of legos) { const o = C.ord.get(l.lego_id), n = S.cls.roundPlays.get(o) || 0
    g += `<rect x="${(legoX.get(l.lego_id) - lw / 2 + 1.5).toFixed(1)}" y="${ys.lego - 10}" width="${(lw - 3).toFixed(1)}" height="20" rx="3" fill="${n ? INK2 : PAPER}" stroke="${n ? INK2 : '#c9c2b8'}" ${n ? '' : 'stroke-dasharray="2 2"'}/>` }
  for (const p of phrases) { const n = S.cls.phrasePlays.get(p.id) || 0
    g += `<rect x="${(phX.get(p.id) - pw / 2).toFixed(2)}" y="${ys.phrase - 8}" width="${Math.max(0.6, pw - 0.4).toFixed(2)}" height="${(10 + 14 * lg(n, 40)).toFixed(1)}" fill="${n ? INK : UNREACHED}" fill-opacity="${n ? (0.5 + 0.5 * lg(n, 40)).toFixed(2) : 1}"/>` }
  for (const [k, y] of Object.entries(ys)) g += `<text x="${L}" y="${y - 18}" font-size="11" fill="#8a8378">${k === 'seed' ? 'sentences' : k === 'lego' ? 'chunks' : 'phrases'}</text>`
  return svg(W, 330, g)
}

// ---------- 3. THE FELT ONE — tiles filling ----------
function tileMap(m) {
  const S = STATES[m.key]; const C = COURSES.eng_for_mar
  const COLS = 47, cell = 22, gap = 3, L = 10, T = 10
  const rows = Math.ceil(C.legos.length / COLS)
  const W = L * 2 + COLS * (cell + gap), H = T * 2 + rows * (cell + gap) + 20
  const maxN = Math.max(1, ...S.cls.roundPlays.values())
  const schoolSeed = Math.max(0, ...S.others.map(x => x.s.highestSeed))
  let g = ''
  C.legos.forEach((l, i) => { const r = Math.floor(i / COLS), c0 = i % COLS, c = r % 2 ? COLS - 1 - c0 : c0
    const x = L + c * (cell + gap), y = T + r * (cell + gap); const n = S.cls.roundPlays.get(i + 1) || 0
    const schoolHas = l.seed_number <= schoolSeed
    g += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="4" fill="${schoolHas ? SCHOOL : UNREACHED}" fill-opacity="${schoolHas ? 0.45 : 0.6}"/>`
    if (n) { const h = cell * (0.35 + 0.65 * lg(n, maxN)); g += `<rect x="${x}" y="${(y + cell - h).toFixed(1)}" width="${cell}" height="${h.toFixed(1)}" rx="4" fill="${INK}" fill-opacity="${(0.55 + 0.45 * lg(n, maxN)).toFixed(2)}"/>` } })
  return svg(W, H, g)
}

// ---------- 4. THE BRAIN — illuminated graph on a phyllotaxis spiral ----------
function brain(m) {
  const S = STATES[m.key]; const C = COURSES.eng_for_mar
  const legos = C.legos.filter(l => l.seed_number <= 70)
  const W = 700, H = 700, cx = W / 2, cy = H / 2, GA = Math.PI * (3 - Math.sqrt(5))
  const pos = new Map()
  legos.forEach((l, i) => { const r = 24 * Math.sqrt(i + 1), t = (i + 1) * GA; pos.set(l.lego_id, [cx + r * Math.cos(t), cy + r * Math.sin(t)]) })
  const edges = new Map()
  for (const p of C.phrases) { if (p.seed_number > 70) continue; const n = S.cls.phrasePlays.get(p.id) || 0
    for (let i = 0; i < p.legos.length; i++) for (let j = i + 1; j < p.legos.length; j++) { const k = [p.legos[i], p.legos[j]].sort().join('|'); const e = edges.get(k) || { n: 0, all: 0 }; e.n += n; e.all++; edges.set(k, e) } }
  const maxN = Math.max(1, ...[...edges.values()].map(e => e.n))
  const schoolSeed = Math.max(0, ...S.others.map(x => x.s.highestSeed))
  let g = ''
  for (const [k, e] of edges) { const [a, b] = k.split('|'); const A = pos.get(a), B = pos.get(b); if (!A || !B) continue
    if (!e.n) g += `<line x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}" stroke="${UNREACHED}" stroke-width="0.6"/>` }
  for (const [k, e] of [...edges].sort((x, y) => x[1].n - y[1].n)) { const [a, b] = k.split('|'); const A = pos.get(a), B = pos.get(b); if (!A || !B || !e.n) continue
    g += `<line x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}" stroke="${INK}" stroke-opacity="${(0.2 + 0.7 * lg(e.n, maxN)).toFixed(2)}" stroke-width="${(0.6 + 2.4 * lg(e.n, maxN)).toFixed(2)}"/>` }
  const maxR = Math.max(1, ...S.cls.roundPlays.values())
  for (const l of legos) { const [x, y] = pos.get(l.lego_id); const n = S.cls.roundPlays.get(C.ord.get(l.lego_id)) || 0
    if (l.seed_number <= schoolSeed) g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" stroke="${SCHOOL}" stroke-width="1.5"/>`
    g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${n ? (3.5 + 3 * lg(n, maxR)).toFixed(1) : 2.5}" fill="${n ? INK : PAPER}" stroke="${n ? PAPER : '#c9c2b8'}" stroke-width="1"/>` }
  return svg(W, H, g)
}

// ---------- 5. FRAME-BREAKER — what the class can say, as ink ----------
function saidText(m) {
  const S = STATES[m.key]; const C = COURSES.eng_for_mar
  const maxN = Math.max(1, ...S.cls.phrasePlays.values())
  const schoolSaid = new Set(); for (const { s } of S.others) for (const p of s.C.phrases) if (p.phrase_role === 'use' && s.phrasePlays.get(p.id)) schoolSaid.add(p.target_text.toLowerCase())
  const seen = new Set(); let html = ''
  for (const p of C.phrases) { if (p.phrase_role !== 'use' || p.seed_number > 26) continue; const t = p.target_text.toLowerCase(); if (seen.has(t)) continue; seen.add(t)
    const n = S.cls.phrasePlays.get(p.id) || 0; const sch = schoolSaid.has(t)
    if (n) html += `<span style="color:${INK};opacity:${(0.45 + 0.55 * lg(n, maxN)).toFixed(2)};font-weight:${n >= 6 ? 700 : n >= 3 ? 600 : 400}">${esc(p.target_text)}.</span> `
    else if (sch) html += `<span style="color:${SCHOOL}">${esc(p.target_text)}.</span> `
    else html += `<span style="color:${UNREACHED}">${esc(p.target_text)}.</span> ` }
  return `<div class="ink">${html}</div>`
}

function svg(w, h, inner) { return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" style="width:100%;height:auto;display:block;background:${PAPER}">${inner}</svg>` }

// ---------- PAGE ----------
const A = STATES.A.cls, B = STATES.B.cls
const otherNames = OTHERS.map(o => `${o.class_name}`).join(', ')
const legoOf = o => COURSES.eng_for_mar.legos[o - 1]?.lego_id
const legoText = id => D.legos_eng_for_mar.find(l => l.lego_id === id)?.target_text
const status = `
<p class="note"><b>What is real and what is reconstructed.</b> Class: Grade 8A, Sunrise Public School, Pune, an IME demo school, on English for Marathi speakers. School layer: the school's three other classes, ${esc(otherNames)}, all on English for Hindi speakers, the same English sentences in the same order, placed by sentence number. The class's positions and repeat counts come from its play-as-class ledger: ${B.sits} sittings between 22 July and 14 September, from chunk ${legoOf(A.roundPlays.size ? Math.min(...D.class_sessions.filter(s=>s.class_id===CLASS.id).map(s=>COURSES.eng_for_mar.ord.get(s.start_lego_id))) : 1)} to chunk ${legoOf(B.highest)} “${esc(legoText(legoOf(B.highest)) || '')}”. Which phrases were practised, and how often, is reconstructed from the player's round shape, the round's own build and use phrases plus reviews at the Fibonacci offsets, applied to those ledger positions. <b>Gap, said plainly:</b> this class's diary and its LEGO co-fire table are both empty, so no picture here is drawn from cycle-level telemetry; the ${A.cursorOnly} chunks before the first recorded sitting carry no sitting and are drawn at one pass because the cursor passed them. No pupil exists or is named: the class account is the only learner.</p>`

const pictures = [
  { title: '1. Your brain on English — the arc diagram', cap: 'Every chunk on one line in course order. Each practised phrase is an arc joining the chunks it is built from; thicker means repeated more. The class draws above the line in ink, the school faint beneath. Long arcs reaching back are the competence: a new chunk being said with old ones.', fn: arcDiagram },
  { title: '2. The metagraph — coverage as structure', cap: 'Sentences, then the chunks that tile them, then the phrases that use those chunks, joined by their composition edges. Reached is solid, never-reached is dashed and dim. The grey band is how far the school has reached.', fn: metagraph },
  { title: '3. The felt one — the course colouring in', cap: 'The whole course as one shape, one tile per chunk, walked in reading order. A tile fills as its round is played again; the grey tiles are where the school has been; the pale ones nobody has yet.', fn: tileMap },
  { title: '4. The brain proper — the walked subgraph over the dim whole', cap: 'Chunks placed on a sunflower spiral from the course start outward, so the walk grows from the centre. An edge joins two chunks that share a phrase; ink edges have been practised, grey ones not yet. School reach is the faint ring round a chunk. Co-fire telemetry for this class is empty, so shared-phrase membership stands in for co-firing, which is a weaker signal.', fn: brain },
  { title: '5. What the class can say — the frame-breaker', cap: 'The course’s own phrases for the first 26 sentences, in course order, as running text. Ink is what this class has practised, weight by how often; grey is what the school has practised and this class has not; the palest is nobody yet. No axis, no chart: the competence is readable.', fn: saidText },
]

let body = ''
for (const p of pictures) {
  body += `<section><h2>${esc(p.title)}</h2>`
  for (const m of MOMENTS) { const s = STATES[m.key].cls; body += `<h3>${m.label} <small>· ${s.sits} sittings · reached sentence ${s.highestSeed}, chunk ${legoOf(s.highest)}</small></h3>${p.fn(m)}` }
  body += `<p class="cap">${esc(p.cap)}</p></section>`
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Language competence — specimens, Grade 8A</title>
<style>body{margin:0;background:${PAPER};color:#2a2723;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif}main{max-width:1100px;margin:0 auto;padding:18px 14px 60px}h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:34px 0 6px;border-top:1px solid #e4dfd8;padding-top:18px}h3{font-size:14px;font-weight:600;color:#5c554b;margin:14px 0 6px}h3 small{font-weight:400;color:#8a8378}.cap{color:#5c554b;font-size:14px;margin:8px 0 0}.note{font-size:13px;color:#5c554b;background:#f1ede7;padding:10px 12px;border-radius:8px}.ink{font-size:14px;line-height:1.7;column-count:1}@media(min-width:800px){.ink{column-count:2;column-gap:28px}}.legend span{display:inline-block;margin-right:14px}.sw{display:inline-block;width:14px;height:10px;border-radius:2px;vertical-align:middle;margin-right:4px}</style></head><body><main>
<h1>Language competence — five pictures of one class</h1>
<p class="legend"><span><i class="sw" style="background:${INK}"></i>Grade 8A</span><span><i class="sw" style="background:${SCHOOL}"></i>the school's other classes</span><span><i class="sw" style="background:${UNREACHED}"></i>not reached by anyone</span></p>
${status}
${body}
</main></body></html>`
writeFileSync(join(here, 'index.html'), html)
console.log('A', A.sits, A.highest, A.highestSeed, 'B', B.sits, B.highest, B.highestSeed, 'phrasesA', A.phrasePlays.size, 'phrasesB', B.phrasePlays.size, 'others', STATES.B.others.map(x => x.o.class_name + ':' + x.s.highestSeed).join(' '))
