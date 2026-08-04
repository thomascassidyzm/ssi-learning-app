/**
 * DIAGNOSTIC HARNESS — throwaway. Branch diag/script-repetition-count only.
 * DO NOT MERGE. Hits the live Supabase read-only with the service-role key.
 *
 * Purpose: produce the ACTUAL, COUNTED repetition schedule for the first N
 * rounds of a real paid course, by RUNNING generateLearningScript (not by
 * hand-simulating it), then converting via toSimpleRounds.
 *
 * Run:
 *   set -a && . ~/.ssi-sentinel.env && set +a
 *   export VITE_SUPABASE_URL=https://swfvymspfxmnfhevgdkg.supabase.co
 *   pnpm --filter player-vue exec vitest run -c diag/vitest.diag.config.ts
 *
 * Env knobs: DIAG_COURSE (default spa_for_eng), DIAG_ROUNDS (default 5).
 */
import { describe, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  generateLearningScript,
  DEFAULT_SCRIPT_SHAPE,
  DEFAULT_TURBO_FIB_KEEP,
  DEFAULT_TURBO_BUILD_KEEP,
  DEFAULT_TURBO_USE_KEEP,
  type ScriptItem,
  type ScriptShape,
  type TurboCullConfig,
  type ListeningConfig,
} from '../src/providers/generateLearningScript'
import { DEFAULT_LISTENING_CONFIG } from '../src/providers/generateLearningScript'
import { toSimpleRounds } from '../src/providers/toSimpleRounds'
import type { Round, Cycle } from '../src/playback/SimplePlayer'

const URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const COURSE = process.env.DIAG_COURSE || 'spa_for_eng'
const NROUNDS = Number(process.env.DIAG_ROUNDS || 5)

/** Cycle types that are LISTEN-ONLY (pauseDuration 0 => no production ask). */
const LISTEN_ONLY = new Set([
  'intro', 'listening', 'component_intro', 'listen_intro', 'listen_outro', 'pod',
])

const out: string[] = []
const p = (s = '') => { out.push(s); console.log(s) }

function norm(t: string | undefined | null): string {
  if (!t) return ''
  return t.toLowerCase().trim().replace(/[.,!?;:¡¿'"]+/g, '').replace(/\s+/g, ' ')
}

function pad(s: string, n: number) { return (s + ' '.repeat(n)).slice(0, n) }
function padL(s: string | number, n: number) { return (' '.repeat(n) + s).slice(-n) }

interface CycleView {
  round: number
  type: string
  legoId: string
  known: string
  target: string
  turboOmit: boolean
  production: boolean
  fibOffset?: number
  reviewOf?: number
}

function viewsFor(rounds: Round[], items: ScriptItem[], upTo: number): CycleView[] {
  // Index script items by uuid to recover fibPosition/reviewOf (dropped by toSimpleRounds)
  const byUuid = new Map<string, ScriptItem>()
  for (const i of items) byUuid.set(i.uuid, i)
  const views: CycleView[] = []
  for (const r of rounds) {
    if (r.roundNumber > upTo) continue
    for (const c of r.cycles as Cycle[]) {
      const si = byUuid.get(c.id as string)
      views.push({
        round: r.roundNumber,
        type: (c as any).type as string,
        legoId: (c as any).legoId as string,
        known: (c as any).known?.text ?? '',
        target: (c as any).target?.text ?? '',
        turboOmit: !!(c as any).turboOmit,
        production: !LISTEN_ONLY.has((c as any).type as string),
        fibOffset: si?.fibPosition,
        reviewOf: si?.reviewOf,
      })
    }
  }
  return views
}

function report(label: string, views: CycleView[], rounds: Round[], upTo: number) {
  p()
  p('='.repeat(96))
  p(`  ${label}`)
  p('='.repeat(96))

  // ---- (a) total cycles per round -------------------------------------
  p()
  p('(a) CYCLES PER ROUND')
  p(`${pad('Round', 7)}${pad('LEGO', 11)}${pad('new lego (target)', 26)}${padL('cycles', 8)}${padL('prod', 6)}${padL('listen', 8)}   type breakdown`)
  for (let rn = 1; rn <= upTo; rn++) {
    const rv = views.filter(v => v.round === rn)
    if (!rv.length) continue
    const r = rounds.find(x => x.roundNumber === rn)
    const counts = new Map<string, number>()
    for (const v of rv) counts.set(v.type, (counts.get(v.type) ?? 0) + 1)
    const brk = [...counts.entries()].map(([t, n]) => `${t}×${n}`).join(' ')
    p(
      pad(String(rn), 7) + pad(r?.legoId ?? '', 11) +
      pad((r as any)?.legoTargetText ?? '', 26) +
      padL(rv.length, 8) + padL(rv.filter(v => v.production).length, 6) +
      padL(rv.filter(v => !v.production).length, 8) + '   ' + brk
    )
  }
  const tot = views.length
  p(`TOTAL rounds 1-${upTo}: ${tot} cycles (${views.filter(v => v.production).length} production, ${views.filter(v => !v.production).length} listen-only)`)

  // ---- (b) per new LEGO: heard-before-produce, total reps -------------
  p()
  p('(b) PER NEW LEGO — hearings before first production ask, and total reps in rounds 1-' + upTo)
  p(`${pad('LEGO', 11)}${pad('target', 24)}${padL('intro rd', 9)}${padL('heardB4', 8)}${padL('audioB4', 8)}${padL('totalReps', 10)}${padL('prodReps', 9)}   per-round reps`)
  const introRounds = new Map<string, number>()
  for (const v of views) {
    if (v.type === 'intro' && !introRounds.has(v.legoId)) introRounds.set(v.legoId, v.round)
  }
  for (const [lego, introRd] of introRounds) {
    const mine = views.filter(v => v.legoId === lego)
    const firstProdIdx = views.findIndex(v => v.legoId === lego && v.production)
    const heardBefore = firstProdIdx < 0
      ? mine.filter(v => !v.production)
      : views.slice(0, firstProdIdx).filter(v => v.legoId === lego && !v.production)
    // audio hearings: intro plays voice1+voice2 => 2 target plays per intro cycle
    const audioB4 = heardBefore.reduce((n, v) => n + (v.type === 'intro' ? 2 : 1), 0)
    const perRound: string[] = []
    for (let rn = 1; rn <= upTo; rn++) {
      const n = mine.filter(v => v.round === rn).length
      perRound.push(`R${rn}:${n}`)
    }
    const target = mine.find(v => v.type === 'intro')?.target ?? ''
    p(
      pad(lego, 11) + pad(target, 24) + padL(introRd, 9) +
      padL(heardBefore.length, 8) + padL(audioB4, 8) +
      padL(mine.length, 10) + padL(mine.filter(v => v.production).length, 9) +
      '   ' + perRound.join(' ')
    )
  }

  // ---- (c) distinct practice combinations ------------------------------
  p()
  p('(c) DISTINCT PRACTICE COMBINATIONS (production cycles only: debut/build/use/spaced_rep)')
  const prod = views.filter(v => v.production)
  const freq = new Map<string, { n: number; known: string; target: string; rounds: number[]; types: Set<string> }>()
  for (const v of prod) {
    const k = norm(v.known) + '|' + norm(v.target)
    const e = freq.get(k) ?? { n: 0, known: v.known, target: v.target, rounds: [], types: new Set<string>() }
    e.n++; e.rounds.push(v.round); e.types.add(v.type)
    freq.set(k, e)
  }
  p(`production cycles: ${prod.length}   distinct phrases: ${freq.size}   mean repeats/phrase: ${(prod.length / Math.max(1, freq.size)).toFixed(2)}`)
  p()
  p('  repeat histogram:')
  const hist = new Map<number, number>()
  for (const e of freq.values()) hist.set(e.n, (hist.get(e.n) ?? 0) + 1)
  for (const k of [...hist.keys()].sort((a, b) => a - b)) {
    p(`    heard ${padL(k, 2)}× : ${padL(hist.get(k)!, 4)} distinct phrases  ${'█'.repeat(Math.min(60, hist.get(k)!))}`)
  }
  p()
  p('  every distinct phrase (sorted by repeats desc):')
  const sorted = [...freq.values()].sort((a, b) => b.n - a.n || a.target.localeCompare(b.target))
  for (const e of sorted) {
    p(`    ${padL(e.n, 2)}×  ${pad(e.target, 40)} | ${pad(e.known, 40)} | rds ${e.rounds.join(',')} | ${[...e.types].join('/')}`)
  }

  // ---- (e) EXPOSURE: lego heard anywhere inside a target phrase --------
  p()
  p('(e) EXPOSURE — times each new LEGO\'s target string occurs inside ANY cycle in rounds 1-' + upTo)
  p('    (LEGO-attributed reps in (b) undercount: "quiero" recurs inside "Quiero hablar español" etc.)')
  p(`${pad('LEGO', 11)}${pad('target', 22)}${padL('attrib', 8)}${padL('exposure', 10)}${padL('prodExp', 9)}   exposure per round`)
  for (const [lego] of introRounds) {
    const t = views.find(v => v.legoId === lego && v.type === 'intro')?.target ?? ''
    const needle = norm(t)
    if (!needle) continue
    const hits = views.filter(v => norm(v.target).split(' ').join(' ').includes(needle))
    const per = Array.from({ length: upTo }, (_, i) =>
      `R${i + 1}:${hits.filter(h => h.round === i + 1).length}`)
    p(pad(lego, 11) + pad(t, 22) +
      padL(views.filter(v => v.legoId === lego).length, 8) +
      padL(hits.length, 10) + padL(hits.filter(h => h.production).length, 9) +
      '   ' + per.join(' '))
  }

  // ---- spaced rep presence -------------------------------------------
  p()
  p('  spaced_rep by round: ' + Array.from({ length: upTo }, (_, i) => {
    const rn = i + 1
    const sr = views.filter(v => v.round === rn && v.type === 'spaced_rep')
    return `R${rn}=${sr.length}${sr.length ? ` (offsets ${[...new Set(sr.map(s => s.fibOffset))].join('/')})` : ''}`
  }).join('  '))
}

describe('script repetition count (diagnostic)', () => {
  it('counts the real schedule', async () => {
    if (!URL || !KEY) throw new Error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(URL, KEY, { auth: { persistSession: false } })

    // ---- live algorithm_config -----------------------------------------
    const { data: cfgRows, error: cfgErr } = await supabase
      .from('algorithm_config').select('key, config, updated_at, updated_by')
    if (cfgErr) throw cfgErr
    const cfg = new Map<string, any>((cfgRows ?? []).map((r: any) => [r.key, r]))

    p(`COURSE: ${COURSE}   rounds analysed: 1-${NROUNDS}`)
    p()
    p('LIVE algorithm_config vs code defaults')
    const ss = cfg.get('script_shape')?.config ?? {}
    const tb = cfg.get('turbo_boost')?.config ?? {}
    const nm = cfg.get('normal_mode')?.config ?? {}
    const cmp = (name: string, live: any, def: any) =>
      p(`  ${pad(name, 26)} live=${pad(JSON.stringify(live), 46)} default=${pad(JSON.stringify(def), 24)} ${JSON.stringify(live) === JSON.stringify(def) ? 'SAME' : '**DIFFERS**'}`)
    cmp('script_shape.spacedRepOffsets', ss.spacedRepOffsets, DEFAULT_SCRIPT_SHAPE.spacedRepOffsets)
    cmp('script_shape.maxBuildPhrases', ss.maxBuildPhrases, DEFAULT_SCRIPT_SHAPE.maxBuildPhrases)
    cmp('script_shape.useConsolidation', ss.useConsolidationCount, DEFAULT_SCRIPT_SHAPE.useConsolidationCount)
    cmp('script_shape.maxSpacedRep', ss.maxSpacedRepPhrases, DEFAULT_SCRIPT_SHAPE.maxSpacedRepPhrases)
    cmp('script_shape.n1PhraseCount', ss.n1PhraseCount, DEFAULT_SCRIPT_SHAPE.n1PhraseCount)
    cmp('turbo_boost.fibKeep', tb.fibKeep, DEFAULT_TURBO_FIB_KEEP)
    cmp('turbo_boost.buildKeep', tb.buildKeep, DEFAULT_TURBO_BUILD_KEEP)
    cmp('turbo_boost.useKeep', tb.useKeep, DEFAULT_TURBO_USE_KEEP)
    p(`  normal_mode.fibKeep/buildKeep/useKeep present? ${['fibKeep', 'buildKeep', 'useKeep'].map(k => `${k}=${JSON.stringify(nm[k])}`).join(' ')}`)
    p(`  normal_mode.spaced_rep_fraction=${nm.spaced_rep_fraction} debut_phrases_fraction=${nm.debut_phrases_fraction}`)
    p(`  turbo_boost.spaced_rep_fraction=${tb.spaced_rep_fraction} debut_phrases_fraction=${tb.debut_phrases_fraction}`)
    p(`  script_shape updated ${cfg.get('script_shape')?.updated_at} by ${cfg.get('script_shape')?.updated_by}`)
    p(`  turbo_boost  updated ${cfg.get('turbo_boost')?.updated_at} by ${cfg.get('turbo_boost')?.updated_by}`)

    const shape: ScriptShape = {
      spacedRepOffsets: ss.spacedRepOffsets ?? DEFAULT_SCRIPT_SHAPE.spacedRepOffsets,
      maxBuildPhrases: ss.maxBuildPhrases ?? DEFAULT_SCRIPT_SHAPE.maxBuildPhrases,
      useConsolidationCount: ss.useConsolidationCount ?? DEFAULT_SCRIPT_SHAPE.useConsolidationCount,
      maxSpacedRepPhrases: ss.maxSpacedRepPhrases ?? DEFAULT_SCRIPT_SHAPE.maxSpacedRepPhrases,
      n1PhraseCount: ss.n1PhraseCount ?? DEFAULT_SCRIPT_SHAPE.n1PhraseCount,
    }
    const turboCull: TurboCullConfig = {
      fibKeep: tb.fibKeep, buildKeep: tb.buildKeep, useKeep: tb.useKeep,
    }
    const listen = cfg.get('listening')?.config
    const listeningConfig: ListeningConfig = { ...DEFAULT_LISTENING_CONFIG, ...(listen ?? {}) }
    const podInterval = cfg.get('pods')?.config?.roundInterval ?? 5

    // ---- RUN the real generator ----------------------------------------
    const t0 = Date.now()
    const result = await generateLearningScript(
      supabase, COURSE, 50, listeningConfig, shape, turboCull, podInterval,
    )
    p()
    p(`generateLearningScript: ${result.items.length} items, ${result.roundCount} rounds, mainLoop ${result.mainLoopRoundCount} — ${Date.now() - t0}ms`)

    const rounds = toSimpleRounds(result.items, { nativeSpeed: true })
    const allViews = viewsFor(rounds, result.items, NROUNDS)

    report(`NORMAL MODE (turbo OFF) — every cycle plays — ${COURSE} rounds 1-${NROUNDS}`, allViews, rounds, NROUNDS)

    const turboViews = allViews.filter(v => !v.turboOmit)
    report(`TURBO ON — turboOmit cycles skipped (live fibKeep/buildKeep/useKeep) — ${COURSE} rounds 1-${NROUNDS}`, turboViews, rounds, NROUNDS)

    // ---- turbo delta -----------------------------------------------------
    p()
    p('='.repeat(96))
    p('  (d) TURBO DELTA — what Turbo strips in rounds 1-' + NROUNDS)
    p('='.repeat(96))
    p(`${pad('Round', 8)}${padL('normal', 8)}${padL('turbo', 8)}${padL('stripped', 10)}${padL('%kept', 8)}   stripped types`)
    for (let rn = 1; rn <= NROUNDS; rn++) {
      const n = allViews.filter(v => v.round === rn)
      const t = turboViews.filter(v => v.round === rn)
      const om = n.filter(v => v.turboOmit)
      const c = new Map<string, number>()
      for (const v of om) c.set(v.type, (c.get(v.type) ?? 0) + 1)
      p(pad(String(rn), 8) + padL(n.length, 8) + padL(t.length, 8) + padL(om.length, 10) +
        padL(n.length ? Math.round(100 * t.length / n.length) + '%' : '-', 8) + '   ' +
        [...c.entries()].map(([k, v]) => `${k}×${v}`).join(' '))
    }
    p(pad('TOTAL', 8) + padL(allViews.length, 8) + padL(turboViews.length, 8) +
      padL(allViews.length - turboViews.length, 10) +
      padL(Math.round(100 * turboViews.length / allViews.length) + '%', 8))

    // ---- (f) authored inventory vs emitted -------------------------------
    p()
    p('='.repeat(96))
    p('  (f) IS THE THIN START A CULL, OR A CONTENT SHORTAGE?')
    p('      authored course_practice_phrases per LEGO vs what the generator emitted')
    p('='.repeat(96))
    const introRds = new Map<string, number>()
    for (const v of allViews) if (v.type === 'intro' && !introRds.has(v.legoId)) introRds.set(v.legoId, v.round)
    const legoIds = [...introRds.keys()]
    const parsed = legoIds.map(l => ({ l, s: Number(l.slice(1, 5)), i: Number(l.slice(6)) }))
    const maxSeed = Math.max(...parsed.map(x => x.s))
    const { data: inv, error: invErr } = await supabase
      .from('course_practice_phrases')
      .select('seed_number, lego_index, position, phrase_role, known_text, target_text')
      .eq('course_code', COURSE).lte('seed_number', maxSeed + 4)
    if (invErr) throw invErr
    // Index authored rows by normalized target text so every emitted cycle can
    // be traced back to the row it came from (no guessing about promotion).
    const authoredByText = new Map<string, any[]>()
    for (const r of (inv ?? []) as any[]) {
      const k = norm(r.target_text)
      if (!authoredByText.has(k)) authoredByText.set(k, [])
      authoredByText.get(k)!.push(r)
    }
    const capB = shape.maxBuildPhrases, capU = shape.useConsolidationCount
    p(`${pad('LEGO', 11)}${padL('rd', 4)}   ${pad('AUTHORED under this LEGO', 34)}${pad('EMITTED in its own round', 30)}${pad('caps', 18)}  verdict`)
    for (const { l, s, i } of parsed) {
      const rd = introRds.get(l)!
      const mine = (inv ?? []).filter((r: any) => r.seed_number === s && r.lego_index === i)
      const ab = mine.filter((r: any) => r.phrase_role === 'build').length
      const au = mine.filter((r: any) => r.phrase_role === 'use').length
      const ac = mine.filter((r: any) => r.phrase_role === 'component').length
      const own = allViews.filter(v => v.round === rd)
      const eb = own.filter(v => v.type === 'build').length
      const eu = own.filter(v => v.type === 'use').length
      const shortfall = eb < capB || eu < capU
      p(pad(l, 11) + padL(rd, 4) + '   ' +
        pad(`${ab} build / ${au} use / ${ac} comp = ${ab + au + ac}`, 34) +
        pad(`${eb} build / ${eu} use (${own.length} cyc)`, 30) +
        pad(`build<=${capB} use<=${capU}`, 18) + '  ' +
        (shortfall ? 'BELOW CAPS -> content-limited' : 'at caps'))
    }
    p()
    p('  PROVENANCE — every drilled phrase in rounds 1-' + Math.min(NROUNDS, 6) + ', traced to its authored row:')
    for (let rn = 1; rn <= Math.min(NROUNDS, 6); rn++) {
      p(`  Round ${rn}:`)
      for (const v of allViews.filter(x => x.round === rn && x.production)) {
        const src = (authoredByText.get(norm(v.target)) ?? [])
          .map((r: any) => `S${String(r.seed_number).padStart(4, '0')}L${String(r.lego_index).padStart(2, '0')}/${r.phrase_role}/pos${r.position}`)
        p(`    ${pad(v.type, 12)}${pad(v.target, 42)} <- ${src.length ? src.join(', ') : '(not in course_practice_phrases — LEGO debut row)'}`)
      }
    }

    // ---- also with CODE-DEFAULT turbo cull, for contrast ------------------
    const t2 = await generateLearningScript(
      supabase, COURSE, 50, listeningConfig, shape, {}, podInterval,
    )
    const r2 = toSimpleRounds(t2.items, { nativeSpeed: true })
    const v2 = viewsFor(r2, t2.items, NROUNDS).filter(v => !v.turboOmit)
    p()
    p(`CONTRAST: turbo with CODE DEFAULTS (useKeep=${DEFAULT_TURBO_USE_KEEP}) rounds 1-${NROUNDS}: ${v2.length} cycles ` +
      `vs live-config turbo ${turboViews.length} vs normal ${allViews.length}`)

    console.log('\n\n#### FULL REPORT WRITTEN TO diag/OUTPUT.txt ####')
    const fs = await import('node:fs')
    fs.writeFileSync(process.env.DIAG_OUT || 'diag/OUTPUT.txt', out.join('\n'))
  }, 300_000)
})
