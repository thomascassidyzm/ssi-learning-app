/**
 * THE FIRST HELIX THREAD, INTERLEAVING ON REAL DATA.
 *
 * This file is the artefact, and it is a test so that it cannot rot: it runs the
 * SHIPPED merge (`mergePreview` from sectorMerge.ts — not a re-implementation)
 * over real rows and asserts the properties the design rules on, printing the
 * round-by-round table as it goes.
 *
 * THE DATA (docs/sector-helix/interleave-inputs.json, provenance recorded in the
 * file itself):
 *  • CORE is real. spa_for_eng seeds 1–14, read live from `course_legos` on
 *    2026-09-01. Rounds come only from `is_new = true` legos — that is what the
 *    live script generator does (generateLearningScript.ts:1325), so the round
 *    counts here are the learner's real round counts.
 *  • SECTOR is real in structure and KNOWN SIDE ONLY. The health general segment
 *    HG01–HG14, parsed mechanically from the canonical seed set's §5 cut lines
 *    (ssi-dashboard-v7-clean, docs/sector-pods/health-general-seed-set-2026-08-31.md
 *    on main). Chunks the set marks as owned from core or scene 0 carry
 *    `is_new = false` and correctly produce NO round — the authoring-time dedupe,
 *    visible in the data rather than asserted.
 *
 * THE HONEST GAP, stated once and printed in the table: no sector segment has a
 * target realisation anywhere in the estate. The canonical set is the English
 * known side; the pair overlay is an unstarted authoring job. Every sector
 * target below is an em dash, and no line of this artefact should be read as
 * attested target-language sector content.
 */
import { describe, it, expect } from 'vitest'
import type { Round } from '@ssi/core'
import { mergePreview, type ThreadKey } from './sectorMerge'
import inputs from '../../../../docs/sector-helix/interleave-inputs.json'

interface Lego { seed: number; index: number; legoId: string; known: string; target: string | null; isNew: boolean }

/** Rounds come only from is_new legos — the same switch the live generator runs on. */
function toRounds(legos: Lego[]): Round[] {
  let roundNumber = 0
  return legos
    .filter(l => l.isNew)
    .map(l => ({
      roundNumber: ++roundNumber,
      legoId: l.legoId,
      seedId: `S${String(l.seed).padStart(4, '0')}`,
      legoKnownText: l.known,
      legoTargetText: l.target ?? undefined,
      cycles: [],
    }))
}

// The live lap cadence: activation 6, interval 5 (usePodLapScheduler).
const ACTIVATION = 6, INTERVAL = 5
const shouldFireLapAt = (total: number) => total >= ACTIVATION && (total - ACTIVATION) % INTERVAL === 0

describe('the first helix thread on real data', () => {
  const core = toRounds(inputs.core as Lego[])
  const sector = toRounds(inputs.sector as Lego[])

  it('interleaves core and health general, swapping at seed boundaries only', () => {
    const merged = mergePreview(core, sector, 54, { shouldFireLapAt })

    const lines: string[] = []
    lines.push('')
    lines.push('  A learner with spa_for_eng and the health general thread, from her first round.')
    lines.push('  core   = real spa_for_eng rows, read live 2026-09-01')
    lines.push('  health = real HG01-HG14 cuts, KNOWN SIDE ONLY — no target exists for any segment yet')
    lines.push('')
    lines.push('  total  thread  round  lego      known                                    target')
    lines.push('  ' + '-'.repeat(96))
    let prevSeed = ''
    for (const m of merged) {
      const seedId = m.round.seedId
      if (prevSeed && seedId !== prevSeed) lines.push('  ' + '·'.repeat(96) + '   <- seed boundary: threads may swap here, and only here')
      prevSeed = seedId
      const known = (m.round.legoKnownText || '').slice(0, 38).padEnd(38)
      const target = m.round.legoTargetText || '—'
      lines.push(
        `  ${String(m.totalRound).padStart(3)}    ${m.thread.padEnd(6)}  ${String(m.round.roundNumber).padStart(3)}    ` +
        `${m.round.legoId.padEnd(9)} ${known} ${target}` + (m.lapDue ? `   <- listening lap due, ${m.lapStream} pod stream` : ''),
      )
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))

    // Seed-boundary swapping. Note the two threads number their seeds
    // independently — core S0006 and health S0006 are different seeds in
    // different courses — so the invariant is NOT "the seed id changed at a
    // swap". It is: every completed stint served ALL of that thread's rounds
    // for that seed. A swap can only happen when a seed is finished.
    const perThread = { core, sector }
    const served: Array<{ thread: ThreadKey; seed: string; rounds: number }> = []
    for (const m of merged) {
      const last = served[served.length - 1]
      if (last && last.thread === m.thread && last.seed === m.round.seedId) last.rounds++
      else served.push({ thread: m.thread, seed: m.round.seedId, rounds: 1 })
    }
    // Every stint but the last (which the 54-round window may cut short) is a whole seed.
    for (const stint of served.slice(0, -1)) {
      const whole = perThread[stint.thread].filter(r => r.seedId === stint.seed).length
      expect(stint.rounds).toBe(whole)
    }

    // The stints are whole seeds, core first, in the real counts:
    // core 5,2,3,3,4… against health 2,4,2,3…
    expect(served.slice(0, 6).map(s => `${s.thread}:${s.seed}:${s.rounds}`)).toEqual([
      'core:S0001:5', 'sector:S0001:2', 'core:S0002:2', 'sector:S0002:4', 'core:S0003:3', 'sector:S0003:2',
    ])

    // Round numbering inside each thread is untouched — 1,2,3… per thread, no renumbering.
    const seen: Record<string, number> = { core: 0, sector: 0 }
    for (const m of merged) expect(m.round.roundNumber).toBe(++seen[m.thread])

    // Laps fire off the TOTAL counter, and land wherever they land, including mid-seed.
    expect(merged.filter(m => m.lapDue).map(m => m.totalRound)).toEqual([6, 11, 16, 21, 26, 31, 36, 41, 46, 51])
  })

  it('IMMEDIACY: the nurse meets her first health chunk inside her first six rounds', () => {
    const merged = mergePreview(core, sector, 12, { shouldFireLapAt })
    const firstSector = merged.find(m => m.thread === 'sector')
    expect(firstSector).toBeDefined()
    expect(firstSector!.totalRound).toBeLessThanOrEqual(6)
    // eslint-disable-next-line no-console
    console.log(`\n  first health chunk at total round ${firstSector!.totalRound}: "${firstSector!.round.legoKnownText}"\n`)
  })

  it('the authoring-time dedupe is visible in the real cuts: shared chunks make no round', () => {
    const all = (inputs.sector as Lego[]).length
    const rounds = sector.length
    expect(rounds).toBeLessThan(all)
    // eslint-disable-next-line no-console
    console.log(`  health HG01-HG14: ${all} cut chunks -> ${rounds} rounds; ${all - rounds} enter as is_new=false, tiling and vocabulary only\n`)
  })

  it('with no sector thread the merge is the core thread, unchanged', () => {
    const merged = mergePreview(core, null, core.length)
    expect(merged.map(m => m.round.legoId)).toEqual(core.map(r => r.legoId))
    expect(merged.every(m => m.thread === 'core')).toBe(true)
  })
})
