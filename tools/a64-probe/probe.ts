import { createClient } from '@supabase/supabase-js'
import handler from '../api/courses/[code]/cycles'
import { backendCyclesToRounds } from '../packages/player-vue/src/providers/backendCyclesToRounds'
import { cyclePromptIdentity } from '../packages/player-vue/src/playback/capConsecutiveRepeats'
import { selectCyclesOutForMode, makeModeSelectionContext, courseMaxCycleLength } from '../packages/player-vue/src/playback/modeCycleSelection'
import { DEFAULT_EASY, DEFAULT_FAST, normalizePhraseRepeatCount, normalizeRepeatedCycleTypes, makeUseWordCap, normalizeReviewFilterMaxRound } from '../packages/player-vue/src/composables/useAlgorithmConfig'

const SUPA_URL = process.env.SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(SUPA_URL, KEY)

const MODE_BYPASS_TYPES = new Set(['intro', 'listening', 'pod', 'listen_intro', 'listen_outro', 'component_intro'])

async function callCycles(code: string, from: string, limit: number): Promise<any> {
  const req: any = { method: 'GET', query: { code, from, limit: String(limit) }, headers: {}, cookies: {} }
  let body: any = null; let status = 200
  const res: any = {
    setHeader() { return res }, status(s: number) { status = s; return res },
    json(b: any) { body = b; return res }, end() { return res }, getHeader() { return undefined },
  }
  await handler(req, res)
  return { status, body }
}

let LIVE: Record<string, any> = {}
async function loadLiveConfig() {
  const { data } = await supabase.from('algorithm_config').select('key, config')
  for (const r of (data ?? []) as any[]) LIVE[r.key] = r.config
}

async function run(code: string, maxRounds: number) {
  const { data: courseRow } = await supabase.from('courses').select('known_lang, target_lang').eq('course_code', code).maybeSingle()
  const knownLang = (courseRow as any)?.known_lang ?? null
  const targetLang = (courseRow as any)?.target_lang ?? null
  // round map, straight from the same table the round-map route serves
  const { data: mapRows, error } = await supabase
    .from('course_round_index').select('round_index, lego_id, seed_number')
    .eq('course_code', code).order('round_index', { ascending: true }).limit(maxRounds)
  if (error) throw error
  if (!mapRows?.length) { console.log(`${code}: no round map`); return }
  const roundMap = { course_code: code, version: 1, rounds: mapRows.map((r: any) => ({ r: r.round_index, legoId: r.lego_id, seed: r.seed_number })) }

  // paginate the real cycles endpoint across the window
  const byLego = new Map<string, any[]>()
  let from: string | null = mapRows[0].lego_id
  let guard = 0
  while (from && guard++ < 200) {
    const { status, body } = await callCycles(code, from, 100)
    if (status !== 200) { console.log(`${code}: cycles ${status} ${JSON.stringify(body).slice(0, 200)}`); break }
    for (const c of body.cycles as any[]) {
      const key = c.round_lego_id ?? c.lego_id
      let list = byLego.get(key)
      if (!list) { list = []; byLego.set(key, list) }
      if (list.some((x: any) => x.id === c.id)) continue   // pagination windows overlap
      list.push(c)
    }
    from = body.next_lego_id
    if (byLego.size >= maxRounds) break
  }

  const rounds = backendCyclesToRounds(
    (legoId: string) => byLego.get(legoId) ?? [],
    roundMap as any,
    () => true,
    {},
    { count: 1, types: new Set<string>() },   // MODE_NEUTRAL_REPEATS, as LearningPlayer passes
  )
  if (!rounds.length) { console.log(`${code}: no rounds built`); return }

  for (const mode of ['easy', 'fast'] as const) {
    const cfg: any = { ...(mode === 'easy' ? DEFAULT_EASY : DEFAULT_FAST), ...(LIVE[mode === 'easy' ? 'easy_mode' : 'fast_mode'] ?? {}) }
    const selCfg: any = {
      maxPhraseLengthFraction: (cfg as any).maxPhraseLengthFraction ?? 1,
      reviewMaxKnownSyllables: (cfg as any).reviewMaxKnownSyllables ?? 0,
      reviewSyllableFilterMaxRound: normalizeReviewFilterMaxRound((cfg as any).reviewSyllableFilterMaxRound),
      useWordCap: makeUseWordCap(knownLang, targetLang, (cfg as any).useWordCapTiers),
      filterBuildPhrases: (cfg as any).filterBuildPhrases !== false,
    }
    const ctx = makeModeSelectionContext(rounds as any, code, knownLang, selCfg.reviewMaxKnownSyllables > 0, courseMaxCycleLength(rounds as any))
    const out = new Set<string>()
    for (const r of rounds) for (const id of selectCyclesOutForMode(r as any, selCfg, ctx)) out.add(id)

    const repeatCount = normalizePhraseRepeatCount((cfg as any).phraseRepeatCount)
    const repeatTypes = normalizeRepeatedCycleTypes((cfg as any).repeatedCycleTypes)

    // Walk exactly as SimplePlayer.advanceCycle does
    const plays: Array<{ id: string; round: number; type: string; cid: string }> = []
    for (const r of rounds) {
      for (const c of r.cycles as any[]) {
        if (out.has(c.id)) continue                        // shouldSkipCycle → modeSelectsCycleOut
        let n = 1
        if (!c.singleAudio && !MODE_BYPASS_TYPES.has(c.type) && repeatCount > 1 && repeatTypes.has(c.type ?? '')) n = repeatCount
        for (let i = 0; i < n; i++) plays.push({ id: cyclePromptIdentity(c), round: r.roundNumber, type: c.type, cid: c.id })
      }
    }
    // Every maximal run of identical prompt identity
    const runs: Array<{ len: number; end: number }> = []
    let run = 1
    for (let i = 1; i <= plays.length; i++) {
      if (i < plays.length && plays[i].id === plays[i - 1].id) { run++; continue }
      if (run >= 3) runs.push({ len: run, end: i - 1 })
      run = 1
    }
    const longest = runs.length ? Math.max(...runs.map(r => r.len)) : (plays.length ? 1 : 0)
    const four = runs.filter(r => r.len >= 4)
    console.log(`${code} [${mode}] rounds=${rounds.length} plays=${plays.length} runs>=3: ${runs.length} (of which >=4: ${four.length}) longest=${longest}`)
    for (const r of runs.slice(0, 3)) {
      const s0 = r.end - r.len + 1
      console.log(`   run of ${r.len}:`)
      for (let i = Math.max(0, s0 - 1); i <= Math.min(plays.length - 1, r.end + 1); i++) {
        const mark = i >= s0 && i <= r.end ? '>' : ' '
        console.log(`    ${mark} r${plays[i].round} ${plays[i].type.padEnd(10)} ${plays[i].cid.padEnd(26)} ${plays[i].id.slice(0, 64)}`)
      }
    }
  }
}

async function main() {
  await loadLiveConfig()
  const codes = (process.env.CODES ?? 'spa_for_eng').split(',')
  const N = Number(process.env.ROUNDS ?? '120')
  for (const c of codes) { try { await run(c.trim(), N) } catch (e: any) { console.log(`${c}: ERROR ${e.message}`) } }
}
main()
