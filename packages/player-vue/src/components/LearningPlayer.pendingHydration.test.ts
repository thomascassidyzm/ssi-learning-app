import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { createPaywallRetreat } from '../playback/paywallRetreat'

// Execute the component's actual lifecycle callbacks and save functions, without
// mounting its audio/network-heavy setup. AST extraction preserves their bodies.
const source = readFileSync(join(process.cwd(), 'src/components/LearningPlayer.vue'), 'utf8')
const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]
const ast = ts.createSourceFile('LearningPlayer.ts', script, ts.ScriptTarget.Latest, true)
const names = [
  'savePositionToLocalStorage', 'persistLivePositionToDb',
  'saveResumeAudio', 'onSaveResumeVisibilityChange',
]
const functions = names.map(name => {
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find(d => d.name.getText(ast) === name)
    if (declaration?.initializer) return `const ${name} = ${declaration.initializer.getText(ast)};`
  }
  throw new Error(`Missing component function: ${name}`)
}).join('\n')

function harness(guardedControl: boolean) {
  // These synchronous callbacks only read .value; no watcher is simulated.
  const ref = <T>(value: T) => ({ value })
  const courseCode = ref('cym_for_eng')
  const subscriptionHydrated = ref(false)
  const round = { legoId: 'S0019L01', seedId: 'S0019', cycles: [{ id: 'S0019L01_debut' }] }
  const realPosition = JSON.stringify({
    legoId: 'S0031L01', seedId: 'S0031', seedNumber: 31,
    itemInRound: 3, cycleId: 'S0031L01_3', lastUpdated: 123456,
    courseCode: courseCode.value,
  })
  const storage = new Map([['position', realPosition]])
  const setLivePosition = vi.fn().mockResolvedValue(undefined)
  const context = {
    courseCode,
    entitlementComposable: {
      subscriptionHydrated,
      accessPending: () => !subscriptionHydrated.value,
    },
    // The race: initialisation has finished, but hydration has not yet allowed
    // the resume gate to establish a paywall hold. The preview queue is live.
    positionInitialized: ref(true),
    useRoundBasedPlayback: ref(true),
    arePositionWritesSuspended: () => false,
    practisingBlocksProgressWrite: () => false,
    paywallRetreat: createPaywallRetreat(),
    currentRound: ref(round),
    currentItemInRound: ref(0),
    simplePlayer: { currentRound: ref(round), roundIndex: ref(18), cycleIndex: ref(0) },
    loadedRounds: ref([round]),
    isGuestLearner: ref(false),
    learnerId: ref('returning-learner'),
    progressStore: ref({}),
    activeProgressStore: ref({ setLivePosition }),
    currentMode: ref('learning'),
    lastCompletedLegoIdRef: ref('S0031L01'),
    liftLocalCeilingIfHigher: vi.fn(),
    getPositionStorageKey: () => 'position',
    extractSeedNumber: (id: string) => Number(id.slice(1)),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    extractAudioIdsFromCycle: () => [],
    document: { visibilityState: 'hidden' },
    pairingsTelemetry: { flush: vi.fn() },
    flushCursor: vi.fn(),
    console: { log: vi.fn(), warn: vi.fn() },
  }

  let executable = functions
  if (guardedControl) {
    // Passing control ONLY: insert the proposed guard into the two extracted
    // writers in memory. No production file is changed. The unmodified suite
    // below remains red until production actually protects pending hydration.
    for (const name of names.slice(0, 2)) {
      const start = executable.indexOf(`const ${name} =`)
      const body = executable.indexOf('=> {', start) + '=> {'.length
      executable = executable.slice(0, body)
        + '\nif (entitlementComposable.accessPending()) return;\n'
        + executable.slice(body)
    }
  }
  const js = ts.transpileModule(executable, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const callbacks = new Function(...Object.keys(context), `${js}\nreturn { saveResumeAudio, onSaveResumeVisibilityChange };`)(...Object.values(context))
  return { callbacks, storage, realPosition, setLivePosition, subscriptionHydrated }
}

describe.each([
  ['production functions', false],
  ['in-memory hydration guard control', true],
] as const)('%s', (_label, guardedControl) => {
  it.each([
    ['pagehide', 'saveResumeAudio'],
    ['visibilitychange hidden', 'onSaveResumeVisibilityChange'],
  ])('%s preserves the real place until subscription hydration completes', (_event, callback) => {
    const h = harness(guardedControl)
    h.callbacks[callback]()

    expect.soft(h.storage.get('position'), 'pending hydration must preserve the entire saved S0031L01 position')
      .toBe(h.realPosition)
    expect.soft(h.setLivePosition, 'pending hydration must not send the preview cursor to the DB')
      .not.toHaveBeenCalled()

    // Positive control: once hydration permits normal saves (no hold), the
    // same callback must persist the live cursor. An unconditional no-op fails.
    h.setLivePosition.mockClear()
    h.subscriptionHydrated.value = true
    h.callbacks[callback]()
    expect(JSON.parse(h.storage.get('position')!)).toMatchObject({
      legoId: 'S0019L01', itemInRound: 0, lastUpdated: 123456,
    })
    expect(h.setLivePosition).toHaveBeenCalledExactlyOnceWith(
      'returning-learner', 'cym_for_eng', 'S0019L01', 18, 0, { touchPracticedAt: false },
    )
  })
})
