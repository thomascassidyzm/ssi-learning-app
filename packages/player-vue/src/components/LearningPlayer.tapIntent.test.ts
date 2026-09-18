import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'

/**
 * Job #223 — the not-ready tap was a trap, and tap_pause was a lying event.
 *
 * Diagnosed by job #219 against production telemetry: togglePlayback opened
 * with a bare `if (isAwakening && !isAudioPlaying) return`, so while the player
 * was not ready EVERY transport tap was discarded with no state change, no
 * telemetry and no learner-visible response. Cold starts run p90 10.5s and p99
 * 46s in production, which is long enough for a learner to tap, see nothing,
 * tap again, and force-quit — the app is dead to the transport and there is no
 * way to tell it heard you. In the same week handlePause() logged tap_pause
 * unconditionally from seven call sites, six of which are overlays and mode
 * changes rather than the transport.
 *
 * The component's real functions are AST-extracted and executed against a stub
 * harness — the same idiom as LearningPlayer.pendingHydration.test.ts — so
 * these assert behaviour, not the shape of the source.
 */
const source = readFileSync(join(process.cwd(), 'src/components/LearningPlayer.vue'), 'utf8')
const container = readFileSync(join(process.cwd(), 'src/containers/PlayerContainer.vue'), 'utf8')
const bottomNav = readFileSync(join(process.cwd(), 'src/components/BottomNav.vue'), 'utf8')

const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]
const ast = ts.createSourceFile('LearningPlayer.ts', script, ts.ScriptTarget.Latest, true)

function extract(name: string): string {
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find(d => d.name.getText(ast) === name)
    if (declaration?.initializer) return `const ${name} = ${declaration.initializer.getText(ast)};`
  }
  throw new Error(`Missing component function: ${name}`)
}

const ref = <T>(value: T) => ({ value })

function harness(state: {
  loadingStage?: string
  progressLoadFailed?: boolean
  audible?: boolean
  playing?: boolean
}) {
  const logged: Array<{ event_type: string; payload: Record<string, unknown> }> = []
  const loadingStage = ref(state.loadingStage ?? 'preparing')
  const progressLoadFailed = ref(state.progressLoadFailed ?? false)
  const notReadyTapAck = ref(false)
  const handleResume = vi.fn()
  const retryProgressLoad = vi.fn()
  const skipIntroduction = vi.fn()
  const skipWelcome = vi.fn()
  const clearPreparingState = vi.fn()
  const pause = vi.fn()
  const flushCursor = vi.fn()

  const context: Record<string, unknown> = {
    // The component's own derivation, reproduced exactly (LearningPlayer.vue):
    // failed-to-load counts as not ready, and so does any non-ready stage.
    isAwakening: { get value() { return progressLoadFailed.value || loadingStage.value !== 'ready' } },
    isAudioPlaying: ref(state.audible ?? false),
    isPlaying: ref(state.playing ?? false),
    loadingStage,
    progressLoadFailed,
    notReadyTapAck,
    isPlayingWelcome: ref(false),
    isPlayingIntroduction: ref(false),
    isPreparingToPlay: ref(false),
    playingPodLapAudio: ref(false),
    playingCommentaryAudio: ref(false),
    userStoppedDuringLap: ref(false),
    podLapCancelled: ref(false),
    firstPlayPauseRequested: ref(false),
    audioController: ref({ stop: vi.fn() }),
    simplePlayer: { pause, roundIndex: ref(12), currentRound: ref({ roundNumber: 393, legoId: 'S0042L03' }), currentCycle: ref(null) },
    currentPhase: ref('prompt'),
    behaviouralEvidence: { onPlayerEvent: vi.fn() },
    pairingsTelemetry: { flush: vi.fn() },
    clearPreparingState,
    skipIntroduction,
    skipWelcome,
    flushCursor,
    handleResume,
    retryProgressLoad,
    cancelAnimationFrame: vi.fn(),
    logEvent: (event_type: string, payload: Record<string, unknown>) => { logged.push({ event_type, payload }) },
    NOT_READY_ACK_MS: 2600,
    // The mount instant tap_ignored measures msSinceMount against — pinned
    // 1,500ms in the past so the assertion is a real elapsed figure.
    playerSetupAtMs: Date.now() - 1500,
  }

  const executable = [
    'let notReadyAckTimer = null;',
    'let ringAnimationFrame = null;',
    extract('acknowledgeNotReadyTap'),
    extract('stopEverything'),
    extract('handleTransportPause'),
    extract('togglePlayback'),
  ].join('\n')
  const js = ts.transpileModule(executable, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const fns = new Function(...Object.keys(context), `${js}\nreturn { togglePlayback, handleTransportPause, stopEverything };`)(...Object.values(context))
  return { fns, logged, notReadyTapAck, handleResume, retryProgressLoad, pause }
}

describe('a transport tap the player cannot honour yet (job #223)', () => {
  it('is recorded, with the stage and how long the learner has been waiting', () => {
    const h = harness({ loadingStage: 'preparing' })
    h.fns.togglePlayback()

    const ignored = h.logged.filter(e => e.event_type === 'tap_ignored')
    expect(ignored).toHaveLength(1)
    expect(ignored[0].payload).toMatchObject({ reason: 'not_ready', loadingStage: 'preparing' })
    expect(ignored[0].payload.msSinceMount).toBeGreaterThanOrEqual(1500)
    // and it is NOT a pause — the row that made the estate's play/pause
    // figures unreadable in the first place.
    expect(h.logged.map(e => e.event_type)).not.toContain('tap_pause')
  })

  it('is answered on screen, so the learner knows the app heard them', () => {
    const h = harness({ loadingStage: 'awakening' })
    expect(h.notReadyTapAck.value).toBe(false)
    h.fns.togglePlayback()
    expect(h.notReadyTapAck.value).toBe(true)
  })

  it('never starts playback half-initialised — the reverted bf281cd1 hazard stays shut', () => {
    const h = harness({ loadingStage: 'preparing' })
    h.fns.togglePlayback()
    expect(h.handleResume).not.toHaveBeenCalled()
  })

  it('takes the learner at their word when the screen invites another go', () => {
    // progressLoadFailed pins isAwakening true FOREVER while the screen says
    // "Your progress is safe — have another go". Every go used to be swallowed.
    const h = harness({ loadingStage: 'ready', progressLoadFailed: true })
    h.fns.togglePlayback()
    expect(h.retryProgressLoad).toHaveBeenCalledOnce()
    expect(h.logged.filter(e => e.event_type === 'tap_ignored')[0].payload)
      .toMatchObject({ reason: 'progress_load_failed' })
  })

  it('positive control: a ready player still plays on a tap', () => {
    const h = harness({ loadingStage: 'ready' })
    h.fns.togglePlayback()
    expect(h.handleResume).toHaveBeenCalledOnce()
    expect(h.logged.map(e => e.event_type)).not.toContain('tap_ignored')
  })
})

describe('a tap_pause row means a learner tapped pause (job #219)', () => {
  it('the shared stop-everything routine writes no telemetry at all', () => {
    const h = harness({ loadingStage: 'ready', playing: true })
    h.fns.stopEverything()
    expect(h.pause).toHaveBeenCalledOnce()   // it still stops everything
    expect(h.logged).toEqual([])             // it just does not claim to be a tap
  })

  it('the transport pause logs it, and stops everything too', () => {
    const h = harness({ loadingStage: 'ready', playing: true })
    h.fns.handleTransportPause()
    expect(h.logged.map(e => e.event_type)).toEqual(['tap_pause'])
    expect(h.pause).toHaveBeenCalledOnce()
  })

  it('no overlay or navigation path reaches the transport pause', () => {
    // Opening the Library or Settings used to write a tap_pause claiming
    // during:'cycle' on a silent, not-ready player.
    expect(container).not.toMatch(/handleTransportPause/)
    expect(container).toMatch(/stopEverything\(\)/)
    // Inside the component, the transport pause has exactly one caller.
    const callers = script.match(/(?<!const )\bhandleTransportPause\(\)/g) ?? []
    expect(callers.length).toBeGreaterThan(0)
    const togglePlaybackBody = extract('togglePlayback')
    expect((togglePlaybackBody.match(/handleTransportPause\(\)/g) ?? []).length).toBe(callers.length)
  })
})

describe('the bottom-nav play button while the player is not ready', () => {
  it('hands the tap to the player instead of dropping it', () => {
    const handler = bottomNav.match(/const handlePlayTap = \(\) => \{([\s\S]*?)\n\}/)![1]
    const guard = handler.slice(0, handler.indexOf('playButtonPressed'))
    expect(guard).toMatch(/isPlayDisabled\.value/)
    expect(guard).toMatch(/emit\('togglePlayback'\)/)
  })
})
