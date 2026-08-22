<!--
  PodStageAuditioner.vue — admin-only tool: watch ONE pod sentence travel all 10
  stages of its journey.

    Stage 0  — the granular breakdown: 5 distinct tiers (explainer → translation
               → pairs200 → pairs0 → intention), built from the per-atom clips and
               timed by algorithm_config['stage0'].
    Stages 1-9 — the existing whole-sentence behaviours (drill / speeds / ×5),
               built from algorithm_config['pods'].stagePlaylist. Each is played
               ONCE here — within a stage the reps are exact repeats, so one pass
               shows the behaviour.

  Reached at /admin/pod-auditioner (behind the global admin guard). The live
  config drives it, so tuning the tuner / pods config reshapes it instantly.
-->
<template>
  <div class="aud">
    <header class="aud__head">
      <h1>Pod stage auditioner <span class="aud__tag">admin</span></h1>
      <p class="aud__sub">One sentence, all 10 stages — Stage-0's 5 tiers + Stages 1-9, each once.</p>
    </header>

    <div class="aud__controls">
      <label>Course
        <select v-model="courseCode">
          <option v-for="c in COURSES" :key="c.code" :value="c.code">{{ c.label }}</option>
        </select>
      </label>
      <span v-if="isLoading" class="aud__muted">loading…</span>
      <span v-else-if="error" class="aud__err">{{ error }}</span>
      <span v-else class="aud__muted">{{ sentences.length }} sentences</span>
    </div>

    <div class="aud__body">
      <ul class="aud__list">
        <li v-for="s in sentences" :key="s.id"
            :class="['aud__row', { 'is-sel': s.id === selectedId, 'is-partial': !s.fullyResolved }]"
            @click="select(s.id)">
          <span class="aud__order">{{ s.globalOrder }}</span>
          <span class="aud__texts">
            <span class="aud__target" :dir="dirFor(s.targetText)">{{ s.targetText }}</span>
            <span class="aud__known">{{ s.knownText }}</span>
          </span>
          <span class="aud__atoms">{{ s.resolvedCount }}/{{ s.atomCount }}</span>
        </li>
      </ul>

      <div class="aud__stages" v-if="selected">
        <div class="aud__selhead">
          <strong :dir="dirFor(selected.targetText)">{{ selected.targetText }}</strong><em>{{ selected.knownText }}</em>
          <button class="aud__journey" :class="{ 'is-active': playingKey === '*journey*' }" @click="playJourney">
            {{ isPlaying && playingKey === '*journey*' ? '■ stop' : '▶ play whole journey (0→9)' }}
          </button>
        </div>

        <div v-for="st in stages" :key="st.key"
             :class="['aud__stage', { 'is-now': nowStageKey === st.key, 'is-empty': !st.plays.length }]">
          <div class="aud__stagehd">
            <span class="aud__skey">{{ st.key }}</span>
            <span class="aud__slabel">{{ st.label }}</span>
            <button class="aud__play" :disabled="!st.plays.length"
                    :class="{ 'is-active': playingKey === st.key }" @click="playStage(st)">
              {{ isPlaying && playingKey === st.key ? '■' : '▶' }}
            </button>
          </div>
          <div class="aud__seq">
            <span v-for="(p, i) in st.plays" :key="i"
                  :class="['aud__clip', 'aud__clip--' + p.role, { 'is-now': nowStageKey === st.key && nowIndex === i }]"
                  :title="p.role + (p.gapAfterMs != null ? '  ·  +' + p.gapAfterMs + 'ms' : '')">
              {{ p.label }}<small v-if="p.speed !== 1"> {{ p.speed }}×</small>
            </span>
            <span v-if="!st.plays.length" class="aud__muted">— no audio for this stage —</span>
          </div>
        </div>
      </div>
      <div class="aud__stages aud__stages--empty" v-else>
        <p class="aud__muted">Select a sentence on the left.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, onBeforeUnmount } from 'vue'
import { dirFor } from '@ssi/core'
import type { Ref } from 'vue'
import { usePodStage0 } from '../composables/usePodStage0'
import { useAlgorithmConfig } from '../composables/useAlgorithmConfig'
import { ROLE_SPEED } from '../composables/usePodLapScheduler'
import { tierSequence, foldEventsToPlays } from '@ssi/core/pods'

const COURSES = [
  { code: 'spa_for_eng', label: 'Spanish' }, { code: 'fra_for_eng', label: 'French' },
  { code: 'deu_for_eng', label: 'German' }, { code: 'ita_for_eng', label: 'Italian' },
  { code: 'por_for_eng', label: 'Portuguese' }, { code: 'gle_for_eng', label: 'Irish' },
  { code: 'hrv_for_eng', label: 'Croatian' }, { code: 'zho_for_eng', label: 'Chinese' },
  { code: 'ara_for_eng', label: 'Arabic' }, { code: 'jpn_for_eng', label: 'Japanese' },
  { code: 'kor_for_eng', label: 'Korean' },
]

interface AudPlay { audioId: string; speed: number; gapAfterMs?: number; label: string; role: string }
interface StageView { key: string; label: string; kind: 'stage0' | 'main'; tierKey?: string; stage?: number; plays: AudPlay[] }

const supabaseRef = inject<{ value: any | null }>('supabase') ?? { value: null }
const courseCode = ref('spa_for_eng')
const { sentences, isLoading, error, load, resolveSentence, mainAudioFor } = usePodStage0(courseCode)
const { stage0Config, podsConfig, loadConfigs } = useAlgorithmConfig(supabaseRef as Ref<any>)

const selectedId = ref<string | null>(null)
const selected = computed(() => sentences.value.find((s) => s.id === selectedId.value) || null)

const isTargetRole = (r: string) => r !== 'trans' && r !== 'explainer'

// ── build the play list for one Stage-0 tier ───────────────────────────────
function stage0Plays(tierKey: string): AudPlay[] {
  const cfg = stage0Config.value
  const tier = cfg.tiers.find((t) => t.key === tierKey)
  if (!tier || !selectedId.value) return []
  const r = resolveSentence(selectedId.value)
  if (!r) return []
  return foldEventsToPlays(tierSequence(tier, r.atoms, r.clips, cfg)).map((tp) => ({
    audioId: tp.audioId,
    speed: tp.speed || 1,
    gapAfterMs: tp.gapAfterMs,
    label: tp.label,
    role: tp.role,
  }))
}

// ── build the play list for one main Stage 1-9 (the stagePlaylist, once) ────
function mainStagePlays(stage: number): AudPlay[] {
  if (!selectedId.value) return []
  const ma = mainAudioFor(selectedId.value)
  if (!ma) return []
  const pods = podsConfig.value
  const playlist: string[] = (pods.stagePlaylist as Record<string, string[]>)[String(stage)] || []
  const resolved = playlist
    .map((role) => {
      let r = role
      if (r === 'explainer' && !ma.explainerAudioId) {
        if (playlist.includes('trans')) return null // don't double the meaning
        r = 'trans'
      }
      if (r === 'trans' && !ma.knownAudioId) return null
      const audioId = r === 'explainer' ? ma.explainerAudioId : r === 'trans' ? ma.knownAudioId : ma.targetAudioId
      if (!audioId) return null
      return {
        audioId,
        speed: ROLE_SPEED[r] ?? 1,
        label: r === 'trans' ? (selected.value?.knownText ?? 'translation') : r === 'explainer' ? 'explainer' : (selected.value?.targetText ?? 'target'),
        role: r,
      }
    })
    .filter((p): p is { audioId: string; speed: number; label: string; role: string } => !!p)
  // within-sentence gaps mirror the runtime matrix (target→trans = tight; else super-tight)
  return resolved.map((p, i) => {
    const next = resolved[i + 1]
    let gapAfterMs: number | undefined
    if (next) gapAfterMs = isTargetRole(p.role) && next.role === 'trans' ? pods.gapTightMs : pods.gapSuperTightMs
    return { ...p, gapAfterMs }
  })
}

const stages = computed<StageView[]>(() => {
  if (!selected.value) return []
  const out: StageView[] = []
  stage0Config.value.tiers.forEach((t, i) => {
    out.push({ key: `0:${i + 1}`, label: `Stage 0 · ${t.key}`, kind: 'stage0', tierKey: t.key, plays: stage0Plays(t.key) })
  })
  Object.keys(podsConfig.value.stagePlaylist || {})
    .map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
    .forEach((s) => out.push({ key: String(s), label: `Stage ${s}`, kind: 'main', stage: s, plays: mainStagePlays(s) }))
  return out
})

// ── single reusable <audio> scheduler ──────────────────────────────────────
let audioEl: HTMLAudioElement | null = null
let runToken = 0
const isPlaying = ref(false)
const playingKey = ref<string | null>(null)
const nowStageKey = ref<string | null>(null)
const nowIndex = ref(-1)
const BETWEEN_STAGES_MS = 900

const audio = () => (audioEl ||= new Audio())
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const playToEnd = (el: HTMLAudioElement) =>
  new Promise<void>((resolve) => {
    const done = () => { el.removeEventListener('ended', done); el.removeEventListener('error', done); resolve() }
    el.addEventListener('ended', done); el.addEventListener('error', done)
    el.play().catch(done)
  })

function stop() {
  runToken++
  if (audioEl) { try { audioEl.pause() } catch { /* noop */ } }
  isPlaying.value = false; playingKey.value = null; nowStageKey.value = null; nowIndex.value = -1
}

async function runFlat(items: Array<AudPlay & { stageKey: string; localIndex: number }>, key: string) {
  stop()
  const token = ++runToken
  isPlaying.value = true; playingKey.value = key
  const el = audio()
  for (const it of items) {
    if (token !== runToken) return
    nowStageKey.value = it.stageKey; nowIndex.value = it.localIndex
    el.src = `/api/audio/${it.audioId}`; el.playbackRate = it.speed || 1; el.load()
    await playToEnd(el)
    if (it.gapAfterMs && token === runToken) await sleep(it.gapAfterMs)
  }
  if (token === runToken) { isPlaying.value = false; playingKey.value = null; nowStageKey.value = null; nowIndex.value = -1 }
}

function flatten(sts: StageView[]): Array<AudPlay & { stageKey: string; localIndex: number }> {
  const flat: Array<AudPlay & { stageKey: string; localIndex: number }> = []
  sts.forEach((st, si) => {
    st.plays.forEach((p, i) => {
      const last = i === st.plays.length - 1
      const betweenStages = last && si < sts.length - 1 ? BETWEEN_STAGES_MS : undefined
      flat.push({ ...p, gapAfterMs: p.gapAfterMs ?? betweenStages, stageKey: st.key, localIndex: i })
    })
  })
  return flat
}

function playStage(st: StageView) {
  if (isPlaying.value && playingKey.value === st.key) { stop(); return }
  if (!st.plays.length) return
  runFlat(flatten([st]), st.key)
}
function playJourney() {
  if (isPlaying.value && playingKey.value === '*journey*') { stop(); return }
  runFlat(flatten(stages.value.filter((s) => s.plays.length)), '*journey*')
}

function select(id: string) { selectedId.value = id; stop() }

watch(courseCode, async () => {
  stop(); selectedId.value = null
  await load()
  const first = sentences.value.find((s) => s.fullyResolved) || sentences.value[0]
  if (first) select(first.id)
}, { immediate: true })

loadConfigs()
onBeforeUnmount(stop)
</script>

<style scoped>
.aud { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; color: #2a2724; }
.aud__head h1 { font-size: 22px; margin: 0 0 4px; }
.aud__tag { font-size: 11px; background: #475569; color: #fff; padding: 2px 7px; border-radius: 10px; vertical-align: middle; }
.aud__sub { margin: 0 0 16px; color: #6b655d; }
.aud__controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; font-size: 13px; }
.aud__controls select { margin-left: 6px; padding: 5px 8px; border-radius: 6px; border: 1px solid #cfc8bf; }
.aud__muted { color: #8c857b; } .aud__err { color: #c0392b; }
.aud__body { display: grid; grid-template-columns: 360px 1fr; gap: 18px; align-items: start; }
.aud__list { list-style: none; margin: 0; padding: 0; max-height: 74vh; overflow: auto; border: 1px solid #e4ded6; border-radius: 10px; background: #fff; }
.aud__row { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid #f1ece5; cursor: pointer; }
.aud__row:hover { background: #faf7f2; } .aud__row.is-sel { background: #eef3f8; } .aud__row.is-partial { opacity: .62; }
.aud__order { color: #b3aaa0; font-size: 12px; width: 26px; font-variant-numeric: tabular-nums; }
.aud__texts { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.aud__target { unicode-bidi: isolate; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aud__known { color: #8c857b; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aud__atoms { font-size: 11px; color: #34a06a; font-variant-numeric: tabular-nums; }
.aud__stages { border: 1px solid #e4ded6; border-radius: 10px; background: #fff; padding: 14px 16px; }
.aud__stages--empty { display: flex; align-items: center; justify-content: center; min-height: 120px; }
.aud__selhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #f1ece5; }
.aud__selhead strong { font-size: 18px; } .aud__selhead em { color: #8c857b; font-style: normal; }
.aud__journey { margin-left: auto; padding: 6px 12px; border-radius: 7px; border: 1px solid #475569; background: #475569; color: #fff; cursor: pointer; font-size: 12px; font-weight: 600; }
.aud__journey.is-active { background: #c0392b; border-color: #c0392b; }
.aud__stage { padding: 8px 0; border-bottom: 1px dashed #efeae3; }
.aud__stage.is-now { background: #f4f8fb; border-radius: 8px; }
.aud__stage.is-empty { opacity: .5; }
.aud__stagehd { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; }
.aud__skey { font-variant-numeric: tabular-nums; font-weight: 700; color: #475569; width: 38px; }
.aud__slabel { flex: 1; font-size: 13px; }
.aud__play { width: 30px; height: 26px; border-radius: 6px; border: 1px solid #cfc8bf; background: #f6f2ec; cursor: pointer; }
.aud__play:disabled { opacity: .4; cursor: default; } .aud__play.is-active { background: #34a06a; color: #fff; border-color: #34a06a; }
.aud__seq { display: flex; flex-wrap: wrap; gap: 4px; padding-left: 48px; line-height: 1.9; }
.aud__clip { padding: 2px 7px; border-radius: 6px; font-size: 12px; background: #eef0f2; border: 1px solid transparent; }
.aud__clip small { opacity: .6; }
.aud__clip--target { background: #e6eef8; } .aud__clip--meansGloss, .aud__clip--meaning, .aud__clip--trans, .aud__clip--explainer, .aud__clip--translation { background: #fdf0e2; }
.aud__clip--wholeTake { background: #e3f6ec; font-weight: 600; }
.aud__clip.is-now { border-color: #34a06a; box-shadow: 0 0 0 2px rgba(52,160,106,.25); }
@media (max-width: 820px) { .aud__body { grid-template-columns: 1fr; } }
</style>
