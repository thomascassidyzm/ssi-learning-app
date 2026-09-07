/**
 * Drive the REAL SimplePlayer state machine over REAL rounds, and record what
 * the learner's ear would receive: one entry per PROMPT phase actually started.
 *
 * No model of the walk — this is SimplePlayer.advanceCycle / repeatCountFor /
 * MAX_CYCLE_PLAYS / findNextPlayableCycleIndex executing.
 */
import { createClient } from '@supabase/supabase-js'
import handler from '../../api/courses/[code]/cycles'
import { backendCyclesToRounds } from '../../packages/player-vue/src/providers/backendCyclesToRounds'
import { cyclePromptIdentity } from '../../packages/player-vue/src/playback/capConsecutiveRepeats'
import { SimplePlayer } from '../../packages/player-vue/src/playback/SimplePlayer'
import { selectCyclesOutForMode, makeModeSelectionContext, courseMaxCycleLength } from '../../packages/player-vue/src/playback/modeCycleSelection'
import { isRepeatCopyCycle } from '../../packages/player-vue/src/providers/reshapeRoundRepeats'
import { DEFAULT_EASY, DEFAULT_FAST, normalizePhraseRepeatCount, normalizeRepeatedCycleTypes, makeUseWordCap, normalizeReviewFilterMaxRound } from '../../packages/player-vue/src/composables/useAlgorithmConfig'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const MODE_BYPASS_TYPES = new Set(['intro', 'listening', 'pod', 'listen_intro', 'listen_outro', 'component_intro'])

// ---- a mock audio element, exactly the shape the shipped harness uses -------
let endedHandler: (() => void) | null = null
const mockAudio: any = {
  src: '', playbackRate: 1, volume: 1, loop: false, paused: true, ended: false, error: null,
  addEventListener: (e: string, h: () => void) => { if (e === 'ended') endedHandler = h },
  removeEventListener: () => {}, setAttribute: () => {},
  play: async () => undefined, pause: () => {}, load: () => {},
}
;(globalThis as any).Audio = function () { return mockAudio }
// NB: fetch is stubbed only AFTER the DB reads — supabase-js needs the real one.
const stubFetch = () => { (globalThis as any).fetch = async () => ({ ok: true, text: async () => '', json: async () => ({}) }) }

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
/** prompt → voice1 → voice2 → cycle end. pauseDuration is zeroed so no timer waits. */
async function soundOneCycle() {
  await flush()
  for (let i = 0; i < 3; i++) { endedHandler?.(); await flush() }
}

async function callCycles(code: string, from: string, limit: number) {
  const req: any = { method: 'GET', query: { code, from, limit: String(limit) }, headers: {}, cookies: {} }
  let body: any = null, status = 200
  const res: any = { setHeader: () => res, status: (s: number) => { status = s; return res }, json: (b: any) => { body = b; return res }, end: () => res, getHeader: () => undefined }
  await handler(req, res)
  return { status, body }
}

async function main() {
  const code = process.env.CODE ?? 'spa_for_eng'
  const upTo = Number(process.env.UPTO ?? '3')
  const mode = (process.env.MODE ?? 'easy') as 'easy' | 'fast'

  const { data: live } = await supabase.from('algorithm_config').select('key, config')
  const liveCfg: any = {}
  for (const r of (live ?? []) as any[]) liveCfg[r.key] = r.config
  const { data: courseRow } = await supabase.from('courses').select('known_lang, target_lang').eq('course_code', code).maybeSingle()
  const knownLang = (courseRow as any)?.known_lang ?? null
  const targetLang = (courseRow as any)?.target_lang ?? null

  const { data: mapRows, error: mapErr } = await supabase.from('course_round_index')
    .select('round_index, lego_id, seed_number').eq('course_code', code)
    .order('round_index', { ascending: true }).limit(upTo)
  if (mapErr || !mapRows?.length) { console.log('round map query failed:', mapErr?.message ?? 'empty'); return }
  const roundMap = { course_code: code, version: 1, rounds: (mapRows ?? []).map((r: any) => ({ r: r.round_index, legoId: r.lego_id, seed: r.seed_number })) }

  const byLego = new Map<string, any[]>()
  let from: string | null = (mapRows as any)[0].lego_id
  let guard = 0
  while (from && guard++ < 20 && byLego.size < upTo) {
    const { status, body } = await callCycles(code, from, 100)
    if (status !== 200) break
    for (const c of body.cycles as any[]) {
      const key = c.round_lego_id ?? c.lego_id
      let list = byLego.get(key); if (!list) { list = []; byLego.set(key, list) }
      if (!list.some((x: any) => x.id === c.id)) list.push(c)
    }
    from = body.next_lego_id
  }

  const rounds = backendCyclesToRounds((id: string) => byLego.get(id) ?? [], roundMap as any, () => true, {}, { count: 1, types: new Set<string>() })
  // Zero the pause/linger windows so the walk needs no wall-clock timers. This
  // touches only DURATIONS, never identity, type, order or repeat count.
  for (const r of rounds) for (const c of r.cycles as any[]) c.pauseDuration = 0

  const cfg: any = { ...(mode === 'easy' ? DEFAULT_EASY : DEFAULT_FAST), ...(liveCfg[mode === 'easy' ? 'easy_mode' : 'fast_mode'] ?? {}) }
  const selCfg: any = {
    maxPhraseLengthFraction: cfg.maxPhraseLengthFraction ?? 1,
    reviewMaxKnownSyllables: cfg.reviewMaxKnownSyllables ?? 0,
    reviewSyllableFilterMaxRound: normalizeReviewFilterMaxRound(cfg.reviewSyllableFilterMaxRound),
    useWordCap: makeUseWordCap(knownLang, targetLang, cfg.useWordCapTiers),
    filterBuildPhrases: cfg.filterBuildPhrases !== false,
  }
  const ctx = makeModeSelectionContext(rounds as any, code, knownLang, selCfg.reviewMaxKnownSyllables > 0, courseMaxCycleLength(rounds as any))
  const selectedOut = new Set<string>()
  for (const r of rounds) for (const id of selectCyclesOutForMode(r as any, selCfg, ctx)) selectedOut.add(id)

  const repeatCount = normalizePhraseRepeatCount(cfg.phraseRepeatCount)
  const repeatTypes = normalizeRepeatedCycleTypes(cfg.repeatedCycleTypes)

  // The two overrides, transcribed from LearningPlayer.vue.
  const overrides = {
    getCycleRepeatCount: (cycle: any) => {
      if (cycle?.singleAudio) return 1
      if (cycle?.type && MODE_BYPASS_TYPES.has(cycle.type)) return 1
      if (repeatCount <= 1) return 1
      return repeatTypes.has(cycle?.type ?? '') ? repeatCount : 1
    },
    shouldSkipCycle: (cycle: any) => {
      if (isRepeatCopyCycle(cycle)) return true
      if (cycle?.id && selectedOut.has(cycle.id)) return true
      return false
    },
    getPostVoice2GapMs: () => 0,
  }

  stubFetch()
  const player = new SimplePlayer(rounds as any, overrides as any)
  const heard: Array<{ id: string; label: string }> = []
  player.on('phase_changed', (d: any) => {
    if (d.phase !== 'prompt') return
    const st = player.currentState
    const c = (rounds as any)[st.roundIndex]?.cycles[st.cycleIndex]
    if (!c) return
    heard.push({ id: cyclePromptIdentity(c), label: `r${(rounds as any)[st.roundIndex].roundNumber} ${String(c.type).padEnd(10)} ${String(c.id).padEnd(26)} ${c.known?.text} | ${c.target?.text}` })
  })

  player.play()
  const totalCycles = rounds.reduce((n: number, r: any) => n + r.cycles.length, 0)
  for (let i = 0; i < totalCycles * 3 + 20; i++) await soundOneCycle()

  console.log(`\n=== ${code} [${mode}] — PROMPTS THE PLAYER ACTUALLY STARTED (${heard.length}) ===`)
  let run = 1, worst = 1
  for (let i = 0; i < heard.length; i++) {
    if (i > 0) run = heard[i].id === heard[i - 1].id ? run + 1 : 1
    worst = Math.max(worst, run)
    console.log(`${String(i + 1).padStart(3)}  ${run > 2 ? '!!' : run === 2 ? ' *' : '  '} ${heard[i].label}`)
  }
  console.log(`\nlongest run of identical prompts the PLAYER emitted: ${worst}`)
}
main()
