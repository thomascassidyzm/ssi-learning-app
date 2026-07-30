#!/usr/bin/env node
/**
 * The self-explaining dashboard COMPILER (docs/self-explaining-dashboard.md).
 *
 * Reads live truth out of the admin surface's own source — the verbs on
 * NodeActionBar.vue, the stat words on NodeHomeView.vue, the insight measures
 * and windows on rate-compare.ts, the schema — plus the hand-written rulings
 * (tools/explainer/rulings/*.md) and noticing rules (rules.json), validates
 * the one against the other (the DRIFT GATE: a stale explanation or a rule
 * over a vanished stat fails the compile), and emits the static EXPLANATION
 * PACK the dashboard bundles. Zero runtime tokens; this CLI is the only place
 * refresh work ever happens.
 *
 *   node tools/explainer/compile.mjs           # write pack.json + docs render
 *   node tools/explainer/compile.mjs --check   # validate only, no writes
 *
 * v2 (stubbed): --telemetry <file> feeds usage counts so explanations can
 * lean on evidence. Deliberately not built — no signal before its consumer.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CHECK_ONLY = process.argv.includes('--check')
if (process.argv.includes('--telemetry')) {
  console.log('[explainer] --telemetry is a v2 stub: no telemetry input is read yet (by design — no signal before its consumer exists).')
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const failures = []
const warnings = []

// ─── 1. DERIVE — parse live truth out of the surfaces' own source ───────────

// Verbs: the action-bar buttons (class="verb...") + the node-home "See
// insights" link. `v-if="!member"` marks admin-only verbs.
const actionBarSrc = read('packages/player-vue/src/components/admin/NodeActionBar.vue')
const verbs = []
for (const m of actionBarSrc.matchAll(/<button[^>]*class="verb[^>]*>([\s\S]*?)<\/button>/g)) {
  const attrs = m[0]
  // Label = last plain-text run in the button (skips {{ ternary }} spinners).
  const text = m[1].replace(/\{\{[\s\S]*?\}\}/g, (t) => {
    const q = t.match(/'([^']+)'\s*\}\}\s*$/)
    return q ? q[1] : ''
  }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) continue
  verbs.push({ label: text, adminOnly: /v-if="[^"]*!member/.test(attrs) })
}
if (!verbs.length) failures.push('DERIVE: no verbs parsed from NodeActionBar.vue — parser or surface changed')

const nodeHomeSrc = read('packages/player-vue/src/views/admin/NodeHomeView.vue')
if (/See insights/.test(nodeHomeSrc)) verbs.push({ label: 'See insights', adminOnly: false })

// Stat words: the stats-row card labels.
const statWords = [...new Set([...nodeHomeSrc.matchAll(/word:\s*(?:cp\s*\?\s*)?'([^']+)'/g)].map((m) => m[1]))]
if (statWords.length < 4) failures.push(`DERIVE: only ${statWords.length} stat words parsed from NodeHomeView.vue`)

// Insight measures + windows, from the node rate-compare endpoint.
const rateSrc = read('api/groups/[id]/rate-compare.ts')
const measures = [...rateSrc.matchAll(/\{ value: '(\w+)', label: '([^']+)', unit: '([^']*)', per: '([^']*)', desc: '([^']+)'/g)]
  .map((m) => ({ value: m[1], label: m[2], unit: m[3], per: m[4], desc: m[5] }))
if (measures.length < 3) failures.push(`DERIVE: only ${measures.length} measures parsed from rate-compare.ts`)
const windows = [...rateSrc.matchAll(/\{ value: '(\w+)', label: '([^']+)', days:/g)].map((m) => ({ value: m[1], label: m[2] }))
if (windows.length < 3) failures.push(`DERIVE: only ${windows.length} windows parsed from rate-compare.ts`)

// Schema presence: the recursive tree + the tables the explanations lean on.
const schemaSrc = read('supabase/schema.sql')
for (const needle of ['CREATE TABLE', 'groups', 'parent_id', 'class_sessions', 'classes', 'learners']) {
  if (!schemaSrc.includes(needle)) failures.push(`DERIVE: schema.sql no longer mentions "${needle}"`)
}

// ─── 2. RULINGS — parse the hand-written persona explanations ───────────────

const PERSONAS = ['admin', 'leader', 'school_admin', 'teacher']
const explanations = {}
for (const persona of PERSONAS) {
  const src = readFileSync(join(HERE, 'rulings', `${persona}.md`), 'utf8')
  const body = src.replace(/<!--[\s\S]*?-->/g, '')
  explanations[persona] = {}
  for (const m of body.matchAll(/^## (\w+)\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/gm)) {
    explanations[persona][m[1]] = m[2].trim()
  }
  if (!Object.keys(explanations[persona]).length) failures.push(`RULINGS: ${persona}.md has no "## <kind>" sections`)
}

// ─── 3. VALIDATE — the drift gate ───────────────────────────────────────────

// 3a. Every verb visible to a persona must be named in that persona's ruling.
// (A renamed/added surface verb fails here — the exact moment a static doc
// would have silently rotted.) Wired personas only; school_admin/teacher wire
// in at THE-VIEW convergence (v1.1).
const visibleVerbs = (persona) => verbs.filter((v) => persona === 'admin' || !v.adminOnly)
for (const persona of ['admin', 'leader']) {
  const all = Object.values(explanations[persona]).join('\n').replace(/\s+/g, ' ')
  for (const v of visibleVerbs(persona)) {
    if (!all.includes(v.label)) failures.push(`DRIFT: verb "${v.label}" is on the surface but ${persona}.md never explains it`)
  }
}

// 3b. Noticing rules: every referenced payload field must still be emitted by
// the home endpoint, and every CTA target must be one the runtime resolves.
const rulesFile = JSON.parse(readFileSync(join(HERE, 'rules.json'), 'utf8'))
const homeSrc = read('api/groups/[id]/home.ts')
const KNOWN_TARGETS = ['insights', 'lens:classes', 'child-home', 'students']
// 'walk:<id>' CTAs launch a walkthrough in place of navigation — valid iff
// the id names a walk in tools/walkthrough/walks/ (the walkthrough compiler
// checks the same lockstep from its side).
const walkIds = new Set(
  readdirSync(join(HERE, '..', 'walkthrough', 'walks'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(HERE, '..', 'walkthrough', 'walks', f), 'utf8')).id),
)
const fieldOk = (path) => path.split('.').every((seg) => homeSrc.includes(seg))
for (const rule of rulesFile.rules) {
  const paths = [
    ...(rule.when ?? []).map((c) => c.path),
    ...(rule.itemWhen ?? []).map((c) => c.path),
    ...[...(rule.invitation.matchAll(/\{([\w.]+)\}/g))].map((m) => m[1]).filter((p) => p !== 'count'),
    ...(rule.arrayPath ? [rule.arrayPath] : []),
  ]
  for (const p of paths) {
    if (!fieldOk(p)) failures.push(`DRIFT: rule "${rule.id}" reads "${p}" but home.ts no longer emits it`)
  }
  if (rule.cta.target.startsWith('walk:')) {
    if (!walkIds.has(rule.cta.target.slice(5))) failures.push(`RULES: rule "${rule.id}" targets ${rule.cta.target} but no such walk exists in tools/walkthrough/walks/`)
  } else if (!KNOWN_TARGETS.includes(rule.cta.target)) failures.push(`RULES: rule "${rule.id}" targets unknown "${rule.cta.target}"`)
  if (!['node', 'perChild', 'countWhere'].includes(rule.shape)) failures.push(`RULES: rule "${rule.id}" has unknown shape "${rule.shape}"`)
}

// 3c. The runtime evaluator must know the same targets (lockstep check).
try {
  const evalSrc = read('packages/player-vue/src/explainer/evaluateRules.ts')
  for (const t of [...KNOWN_TARGETS, 'walk:']) {
    if (!evalSrc.includes(`'${t}'`)) failures.push(`LOCKSTEP: evaluateRules.ts no longer handles target '${t}'`)
  }
} catch {
  warnings.push('LOCKSTEP: evaluateRules.ts not found yet (first compile before the runtime exists)')
}

// Coverage nudges (warnings, not failures): a measure nobody explains.
for (const m of measures) {
  const anywhere = PERSONAS.some((p) => Object.values(explanations[p]).join(' ').toLowerCase().includes(m.label.toLowerCase()))
  if (!anywhere) warnings.push(`coverage: measure "${m.label}" is explained nowhere (fine — insights explains itself in-place)`)
}

// ─── Report ─────────────────────────────────────────────────────────────────
for (const w of warnings) console.log(`  ⚠ ${w}`)
if (failures.length) {
  console.error(`\n[explainer] COMPILE FAILED — the pack would lie about the product:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('\nFix the surface parse, or re-author the affected ruling, then re-run.')
  process.exit(1)
}

// ─── 4. ASSEMBLE ────────────────────────────────────────────────────────────

const truth = { verbs, statWords, measures, windows }
const content = JSON.stringify({ truth, explanations, rules: rulesFile.rules })
const pack = {
  version: createHash('sha256').update(content).digest('hex').slice(0, 12),
  generatedAt: new Date().toISOString().slice(0, 10),
  truth,
  explanations,
  rules: rulesFile.rules,
}

if (CHECK_ONLY) {
  console.log(`[explainer] check OK — pack version would be ${pack.version} (${verbs.length} verbs · ${measures.length} measures · ${rulesFile.rules.length} rules)`)
  process.exit(0)
}

const packPath = join(ROOT, 'packages/player-vue/src/explainer/pack.json')
mkdirSync(dirname(packPath), { recursive: true })
writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n')

// Human-readable render for review.
const md = [
  `# Explanation pack — compiled render`,
  ``,
  `**Version \`${pack.version}\` · generated ${pack.generatedAt} by \`tools/explainer/compile.mjs\`. DO NOT EDIT — edit the rulings/rules and recompile.**`,
  ``,
  `Truth manifest: ${verbs.length} verbs (${verbs.map((v) => v.label).join(' · ')}) · stat words: ${statWords.join(' · ')} · ${measures.length} measures · windows: ${windows.map((w) => w.label).join(' / ')}.`,
  ``,
  ...PERSONAS.flatMap((p) => [
    `## ${p}`,
    ``,
    ...Object.entries(explanations[p]).flatMap(([kind, text]) => [`### ${kind}`, ``, text, ``]),
  ]),
  `## Noticing rules`,
  ``,
  ...rulesFile.rules.map((r) => `- **${r.id}** (${r.shape}, ${r.kinds.join('/')}): "${r.invitation}" → ${r.cta.target}`),
  ``,
].join('\n')
writeFileSync(join(ROOT, 'docs/explainer-pack.md'), md)

console.log(`[explainer] pack ${pack.version} written — ${verbs.length} verbs · ${statWords.length} stat words · ${measures.length} measures · ${rulesFile.rules.length} rules`)
console.log(`  → packages/player-vue/src/explainer/pack.json`)
console.log(`  → docs/explainer-pack.md`)
