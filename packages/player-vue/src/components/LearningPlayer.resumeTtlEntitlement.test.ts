import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { beltRewindTarget } from '../utils/beltRewindTarget'
import { createPaywallRetreat } from '../playback/paywallRetreat'

// #761 → #764: a same-owner cached FULL bundle can outlive entitlement.
// Exercise the actual legacy TTL branch with those rounds, rather than assume
// every unentitled caller receives a preview-only queue. As in the adjacent
// pendingHydration test, AST extraction avoids mounting audio/network setup.
const source = readFileSync(join(process.cwd(), 'src/components/LearningPlayer.vue'), 'utf8')
const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]
const ast = ts.createSourceFile('LearningPlayer.ts', script, ts.ScriptTarget.Latest, true)
const candidates: string[] = []
function visit(node: ts.Node) {
  if (ts.isIfStatement(node)
    && node.expression.getText(ast) === 'savedLastPracticedAt.value'
    && node.getText(ast).includes('beltRewindTarget(')) {
    candidates.push(node.getText(ast))
  }
  ts.forEachChild(node, visit)
}
visit(ast)
if (candidates.length !== 1) throw new Error(`Expected one resume TTL block, found ${candidates.length}`)

// Same belt boundaries as beltRewindTarget.test.ts; full cached rounds include
// both the real cursor (seed 31) and orange's start (seed 20), beyond preview 19.
const belts = [
  { name: 'white', seedsRequired: 0 },
  { name: 'yellow', seedsRequired: 8 },
  { name: 'orange', seedsRequired: 20 },
]
const rounds = Array.from({ length: 40 }, (_, i) => ({
  legoId: `S${String(i + 1).padStart(4, '0')}L01`,
}))

function runTtl(guardedControl: boolean, pending: boolean, entitled: boolean, held: boolean) {
  const ref = <T>(value: T) => ({ value })
  const paywallRetreat = createPaywallRetreat()
  if (held) paywallRetreat.remember({ legoId: 'S0031L01', roundIndex: 30, cycleIndex: 3 })
  // Pending deliberately has no hold: TTL can run before the post-init watcher.
  const saved = { legoId: 'S0031L01', roundIndex: 30 }
  const setEnrollmentCursor = vi.fn(async (_learner: string, _course: string, legoId: string, roundIndex: number) => {
    Object.assign(saved, { legoId, roundIndex })
  })
  const context = {
    savedLastPracticedAt: ref(new Date(Date.now() - 61 * 24 * 60 * 60 * 1000)),
    resumeConfig: ref({ beltRegressionDays: 60, cycleResetMinutes: 30 }),
    simpleRounds: rounds,
    BELTS: belts,
    beltRewindTarget,
    paywallRetreat,
    entitlementComposable: {
      subscriptionHydrated: ref(!pending),
      accessPending: () => pending,
      // Optimistic access while pending must not authorise a cursor write.
      canAccessSeed: (_course: unknown, seed: number) => pending || entitled || seed <= 19,
    },
    props: { course: { course_code: 'cym_for_eng' } },
    isGuestLearner: ref(false),
    progressStore: ref({}),
    activeProgressStore: ref({ setEnrollmentCursor }),
    learnerId: ref('same-cached-bundle-owner'),
    courseCode: ref('cym_for_eng'),
    console: { log: vi.fn(), warn: vi.fn() },
  }
  let executable = candidates[0]
  if (guardedControl) {
    // Passing control: change ONLY the extracted copy in memory, never the
    // component. Production cases below remain red until the real fix lands.
    executable = `const controlTarget = beltRewindTarget(resumeLegoId, simpleRounds, BELTS);
      if (controlTarget
      && !entitlementComposable.accessPending()
      && !paywallRetreat.blocksPersist()
      && entitlementComposable.canAccessSeed(props.course, Number(controlTarget.legoId.slice(1, 5)))) {
        ${executable}
      }`
  }
  const js = ts.transpileModule(`
    let resumeLegoId = 'S0031L01';
    let resumeCycle = 3;
    let rewindLandingIdx = null;
    ${executable}
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  new Function(...Object.keys(context), js)(...Object.values(context))
  return { saved, setEnrollmentCursor }
}

describe.each([
  ['production TTL', false],
  ['in-memory guarded TTL control', true],
] as const)('%s', (_label, guardedControl) => {
  it.each([
    ['subscription pending, before the hold exists', true, false, false],
    ['subscription hydrated but entitlement expired', false, false, false],
    ['real cursor still held after an entitlement grant', false, true, true],
  ] as const)('preserves S0031L01 with full cached rounds: %s', (_state, pending, entitled, held) => {
    // Establish the counterexample: a full queue yields a non-preview target.
    expect(beltRewindTarget('S0031L01', rounds, belts)).toEqual({
      legoId: 'S0020L01', roundIndex: 19, beltName: 'orange',
    })
    const h = runTtl(guardedControl, pending, entitled, held)
    expect.soft(h.setEnrollmentCursor, 'TTL must not write a rewind before access is settled and the hold is clear')
      .not.toHaveBeenCalled()
    expect(h.saved).toEqual({ legoId: 'S0031L01', roundIndex: 30 })
  })

  it('still writes the orange-belt rewind when hydrated, entitled and unheld', () => {
    const h = runTtl(guardedControl, false, true, false)
    expect(h.setEnrollmentCursor).toHaveBeenCalledExactlyOnceWith(
      'same-cached-bundle-owner', 'cym_for_eng', 'S0020L01', 19,
      { reason: 'resume_ttl_belt_regression', from: { legoId: 'S0031L01', roundIndex: null } },
    )
    expect(h.saved).toEqual({ legoId: 'S0020L01', roundIndex: 19 })
  })
})
