import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { beltRewindTarget } from '../utils/beltRewindTarget'
import { createPaywallRetreat } from '../playback/paywallRetreat'

// Job #768, adopting Astra's #765 test. A same-owner cached FULL bundle can
// outlive entitlement, so the legacy TTL branch can see a rewind target past
// the preview (S0031 → S0020) for a lapsed subscriber. Tom's rule: a paywall
// never moves a position back; #761's rule: no cursor writer runs before the
// subscription verdict. So the rewind waits for the verdict and fires only
// for a learner who can access the target's seed. As in the adjacent
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

function extractConst(name: string): string {
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find(d => d.name.getText(ast) === name)
    if (declaration?.initializer) return `const ${name} = ${declaration.initializer.getText(ast)};`
  }
  throw new Error(`Missing component function: ${name}`)
}

const transpile = (code: string) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

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

interface Access { pending: boolean; entitled: boolean }

async function runTtl(access: Access) {
  const ref = <T>(value: T) => ({ value })
  const saved = { legoId: 'S0031L01', roundIndex: 30 }
  const setEnrollmentCursor = vi.fn(async (_learner: string, _course: string, legoId: string, roundIndex: number) => {
    Object.assign(saved, { legoId, roundIndex })
  })
  // The verdict landing: hydration ends, and the answer for a lapsed learner is
  // "not entitled" (useSubscription's 8s bound fails closed the same way).
  const awaitSubscriptionVerdict = vi.fn(async () => { access.pending = false })
  const context = {
    savedLastPracticedAt: ref(new Date(Date.now() - 61 * 24 * 60 * 60 * 1000)),
    resumeConfig: ref({ beltRegressionDays: 60, cycleResetMinutes: 30 }),
    simpleRounds: rounds,
    BELTS: belts,
    beltRewindTarget,
    getSeedFromLegoId: (id: string | null) => (id ? Number(id.slice(1, 5)) : null),
    paywallRetreat: createPaywallRetreat(),
    awaitSubscriptionVerdict,
    entitlementComposable: {
      subscriptionHydrated: ref(!access.pending),
      accessPending: () => access.pending,
      verdictPending: () => access.pending,
      // Optimistic access while pending must not authorise a cursor write.
      canAccessSeed: (_course: unknown, seed: number) => access.pending || access.entitled || seed <= 19,
    },
    props: { course: { course_code: 'cym_for_eng' } },
    isGuestLearner: ref(false),
    progressStore: ref({}),
    activeProgressStore: ref({ setEnrollmentCursor }),
    learnerId: ref('same-cached-bundle-owner'),
    courseCode: ref('cym_for_eng'),
    console: { log: vi.fn(), warn: vi.fn() },
  }
  const js = transpile(`
    async function ttl() {
      let resumeLegoId = 'S0031L01';
      let resumeCycle = 3;
      let rewindLandingIdx = null;
      ${candidates[0]}
      return { resumeLegoId, resumeCycle, rewindLandingIdx };
    }
    return ttl();
  `)
  const landing = await new Function(...Object.keys(context), js)(...Object.values(context))
  return { saved, setEnrollmentCursor, awaitSubscriptionVerdict, landing }
}

describe('resume-TTL belt rewind waits for the subscription verdict (job #768)', () => {
  it('establishes the counterexample: a full cached queue yields a target past the preview', () => {
    expect(beltRewindTarget('S0031L01', rounds, belts)).toEqual({
      legoId: 'S0020L01', roundIndex: 19, beltName: 'orange',
    })
  })

  it.each([
    ['subscription pending at init, verdict lands unentitled', { pending: true, entitled: false }],
    ['subscription hydrated, entitlement expired', { pending: false, entitled: false }],
  ] as const)('preserves S0031L01 with full cached rounds: %s', async (_state, access) => {
    const h = await runTtl({ ...access })
    expect.soft(h.setEnrollmentCursor, 'TTL must not write a rewind for a learner who cannot access the target')
      .not.toHaveBeenCalled()
    expect(h.saved).toEqual({ legoId: 'S0031L01', roundIndex: 30 })
    // Nor an in-memory rewind: the landing stays on the real place.
    expect(h.landing).toEqual({ resumeLegoId: 'S0031L01', resumeCycle: 3, rewindLandingIdx: null })
  })

  it('waits for the verdict before deciding when the answer is still in flight', async () => {
    const h = await runTtl({ pending: true, entitled: true })
    expect(h.awaitSubscriptionVerdict).toHaveBeenCalledOnce()
  })

  it('still writes the orange-belt rewind when hydrated and entitled', async () => {
    const h = await runTtl({ pending: false, entitled: true })
    expect(h.setEnrollmentCursor).toHaveBeenCalledExactlyOnceWith(
      'same-cached-bundle-owner', 'cym_for_eng', 'S0020L01', 19,
      { reason: 'resume_ttl_belt_regression', from: { legoId: 'S0031L01', roundIndex: null } },
    )
    expect(h.saved).toEqual({ legoId: 'S0020L01', roundIndex: 19 })
    expect(h.landing).toEqual({ resumeLegoId: 'S0020L01', resumeCycle: 0, rewindLandingIdx: 19 })
  })

  // Astra's third case, "real cursor still held after an entitlement grant",
  // is dropped: in the real init order the retreat hold is raised by the
  // post-init gate, which runs AFTER this block, so a held cursor cannot exist
  // when the TTL block runs. The entitlement gate above is what protects that
  // learner instead.
})

describe('awaitSubscriptionVerdict (the mechanism the TTL block waits on)', () => {
  // `mirrorActive` models a device whose localStorage mirror of the LAST
  // /api/subscription answer says "active": useEntitlement derives
  // `accessPending` from `!isPaid`, so it reads FALSE off that mirror before
  // any answer has landed this session. `verdictPending` is the signed-in
  // learner's `!hydrated`, mirror or no mirror.
  const build = (opts: { hydrated: boolean; mirrorActive?: boolean }) => {
    const { hydrated, mirrorActive = false } = opts
    const subscriptionHydrated = { value: hydrated }
    const stop = vi.fn()
    let watched: ((v: boolean) => void) | null = null
    const watch = vi.fn((_src: unknown, cb: (v: boolean) => void) => { watched = cb; return stop })
    const context = {
      entitlementComposable: {
        accessPending: () => !mirrorActive && !subscriptionHydrated.value,
        verdictPending: () => !subscriptionHydrated.value,
        subscriptionHydrated,
      },
      watch,
    }
    const js = transpile(`${extractConst('awaitSubscriptionVerdict')} return awaitSubscriptionVerdict;`)
    const fn = new Function(...Object.keys(context), js)(...Object.values(context)) as () => Promise<void>
    return { fn, watch, stop, fire: (v: boolean) => watched?.(v), subscriptionHydrated }
  }

  it('resolves immediately when the answer has landed', async () => {
    const b = build({ hydrated: true })
    await expect(b.fn()).resolves.toBeUndefined()
    expect(b.watch).not.toHaveBeenCalled()
  })

  it('resolves immediately when the answer has landed, even with an active mirror', async () => {
    const b = build({ hydrated: true, mirrorActive: true })
    await expect(b.fn()).resolves.toBeUndefined()
    expect(b.watch).not.toHaveBeenCalled()
  })

  // Job #778 (Astra's cold verify of #768): a lapsed subscriber's device
  // still holds last month's "active" mirror. Before the fix this resolved at
  // once — accessPending() was false — and the TTL block rewound and wrote on
  // the stale mirror before /api/subscription had said "lapsed".
  it('still waits for the verdict when a stale "active" mirror makes accessPending() false', async () => {
    const b = build({ hydrated: false, mirrorActive: true })
    let settled = false
    const p = b.fn().then(() => { settled = true })
    await Promise.resolve()
    expect(settled, 'must not resolve on the localStorage mirror alone').toBe(false)
    expect(b.watch).toHaveBeenCalledWith(b.subscriptionHydrated, expect.any(Function))
    b.subscriptionHydrated.value = true
    b.fire(true)
    await p
    expect(settled).toBe(true)
  })

  it('watches subscriptionHydrated while pending and resolves once it flips', async () => {
    const b = build({ hydrated: false })
    let settled = false
    const p = b.fn().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(b.watch).toHaveBeenCalledWith(b.subscriptionHydrated, expect.any(Function))
    b.fire(false)
    await Promise.resolve()
    expect(settled).toBe(false)
    b.fire(true)
    await p
    expect(settled).toBe(true)
    expect(b.stop).toHaveBeenCalledOnce()
  })
})
