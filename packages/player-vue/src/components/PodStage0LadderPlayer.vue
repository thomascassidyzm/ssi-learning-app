<!--
  PodStage0LadderPlayer.vue — demo-first surface for the Stage-0 pod-explainer ladder.

  Plays the whole-part-whole 5-tier ladder for any real pod sentence, reconstructed
  live from the DB (atom_map + pod_legos + course_audio) and timed by the live
  algorithm_config['stage0'] (the same row the Popty tuner writes). This is the
  in-app counterpart to public/stage0-tuner.html — proving DB → app → audio end to
  end before the ladder is slotted into the learner's pod flow.

  Route: /pods/stage0   (dev/demo)
-->
<template>
  <div class="s0">
    <header class="s0__head">
      <h1>Stage-0 pod-explainer ladder <span class="s0__tag">demo</span></h1>
      <p class="s0__sub">
        Live from the DB + the tuner's <code>stage0</code> config. Pick a sentence, hear the ladder.
      </p>
    </header>

    <div class="s0__controls">
      <label>
        Course
        <select v-model="courseCode">
          <option v-for="c in COURSES" :key="c.code" :value="c.code">{{ c.label }}</option>
        </select>
      </label>
      <span v-if="isLoading" class="s0__muted">loading…</span>
      <span v-else-if="error" class="s0__err">{{ error }}</span>
      <span v-else class="s0__muted">{{ sentences.length }} explainable sentences</span>
      <span class="s0__muted">· config: {{ stage0Config.model }}, gaps {fusion {{ stage0Config.gaps.fusionPairs }} · chunk {{ stage0Config.gaps.betweenChunks }}}</span>
    </div>

    <div class="s0__body">
      <!-- sentence picker -->
      <ul class="s0__list">
        <li
          v-for="s in sentences"
          :key="s.id"
          :class="['s0__row', { 'is-sel': s.id === selectedId, 'is-partial': !s.fullyResolved }]"
          @click="select(s.id)"
        >
          <span class="s0__order">{{ s.globalOrder }}</span>
          <span class="s0__texts">
            <span class="s0__target">{{ s.targetText }}</span>
            <span class="s0__known">{{ s.knownText }}</span>
          </span>
          <span class="s0__atoms" :title="s.resolvedCount + '/' + s.atomCount + ' atoms have clips'">
            {{ s.resolvedCount }}/{{ s.atomCount }}
          </span>
        </li>
      </ul>

      <!-- player -->
      <div class="s0__player" v-if="selected">
        <div class="s0__selhead">
          <strong>{{ selected.targetText }}</strong>
          <em>{{ selected.knownText }}</em>
        </div>

        <div class="s0__tiers">
          <button
            v-for="t in stage0Config.tiers"
            :key="t.key"
            :class="{ 'is-active': playingTier === t.key }"
            @click="playTier(t.key)"
          >{{ t.key }}</button>
          <button class="s0__all" :class="{ 'is-active': playingTier === '*all*' }" @click="playAll">▶ full ladder</button>
          <button class="s0__stop" v-if="isPlaying" @click="stop">■ stop</button>
        </div>

        <!-- sequence preview, current clip highlighted -->
        <div class="s0__seq" v-if="preview.length">
          <template v-for="(e, i) in preview" :key="i">
            <span
              v-if="e.type === 'clip'"
              :class="['s0__clip', 's0__clip--' + e.role, { 'is-now': i === nowIndex }]"
            >{{ e.label }}</span>
            <span v-else class="s0__gap" :style="{ width: gapWidth(e.ms) }" :title="e.ms + 'ms ' + e.kind"></span>
          </template>
        </div>
      </div>
      <div class="s0__player s0__player--empty" v-else>
        <p class="s0__muted">Select a sentence on the left.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'
import { usePodStage0 } from '../composables/usePodStage0'
import { useAlgorithmConfig } from '../composables/useAlgorithmConfig'
import { tierSequence, buildLadder, type Stage0Event } from '../composables/stage0Sequence'

const COURSES = [
  { code: 'spa_for_eng', label: 'Spanish' },
  { code: 'fra_for_eng', label: 'French' },
  { code: 'deu_for_eng', label: 'German' },
  { code: 'ita_for_eng', label: 'Italian' },
  { code: 'por_for_eng', label: 'Portuguese' },
  { code: 'gle_for_eng', label: 'Irish' },
  { code: 'hrv_for_eng', label: 'Croatian' },
  { code: 'zho_for_eng', label: 'Chinese' },
  { code: 'ara_for_eng', label: 'Arabic' },
  { code: 'jpn_for_eng', label: 'Japanese' },
  { code: 'kor_for_eng', label: 'Korean' },
]

const supabaseRef = inject<{ value: any | null }>('supabase') ?? { value: null }

const courseCode = ref('spa_for_eng')
const { sentences, isLoading, error, load, resolveSentence } = usePodStage0(courseCode)

const { stage0Config, loadConfigs } = useAlgorithmConfig(supabaseRef as Ref<any>)

const selectedId = ref<string | null>(null)
const selected = computed(() => sentences.value.find((s) => s.id === selectedId.value) || null)

const preview = ref<Stage0Event[]>([])
const nowIndex = ref(-1)
const isPlaying = ref(false)
const playingTier = ref<string | null>(null)

// single reusable <audio> element (mobile gesture-unlock survives) + proxy URLs
let audioEl: HTMLAudioElement | null = null
let runToken = 0

const audio = (): HTMLAudioElement => {
  if (!audioEl) audioEl = new Audio()
  return audioEl
}
const urlFor = (audioId: string) => `/api/audio/${audioId}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const playToEnd = (el: HTMLAudioElement) =>
  new Promise<void>((resolve) => {
    const done = () => {
      el.removeEventListener('ended', done)
      el.removeEventListener('error', done)
      resolve()
    }
    el.addEventListener('ended', done)
    el.addEventListener('error', done) // continue the cycle on a missing clip
    el.play().catch(done)
  })

async function runSequence(events: Stage0Event[], tierLabel: string) {
  stop() // cancel any in-flight run
  const token = ++runToken
  preview.value = events
  nowIndex.value = -1
  isPlaying.value = true
  playingTier.value = tierLabel
  const el = audio()
  for (let i = 0; i < events.length; i++) {
    if (token !== runToken) return // superseded/stopped
    const e = events[i]
    nowIndex.value = i
    if (e.type === 'gap') {
      await sleep(e.ms)
    } else {
      el.src = urlFor(e.audioId)
      el.playbackRate = e.speed || 1
      el.load()
      await playToEnd(el)
    }
  }
  if (token === runToken) {
    isPlaying.value = false
    playingTier.value = null
    nowIndex.value = -1
  }
}

function stop() {
  runToken++ // invalidate the running loop
  if (audioEl) {
    try { audioEl.pause() } catch { /* noop */ }
  }
  isPlaying.value = false
  playingTier.value = null
  nowIndex.value = -1
}

function buildFor(tierKey: string | '*all*'): Stage0Event[] {
  const r = resolveSentence(selectedId.value as string)
  if (!r) return []
  if (tierKey === '*all*') return buildLadder(r.atoms, r.clips, stage0Config.value)
  const tier = stage0Config.value.tiers.find((t) => t.key === tierKey)
  if (!tier) return []
  return tierSequence(tier, r.atoms, r.clips, stage0Config.value)
}

function playTier(tierKey: string) {
  if (!selectedId.value) return
  runSequence(buildFor(tierKey), tierKey)
}
function playAll() {
  if (!selectedId.value) return
  runSequence(buildFor('*all*'), '*all*')
}

function select(id: string) {
  selectedId.value = id
  stop()
  preview.value = buildFor('explainer') // show tier-1 by default
}

const gapWidth = (ms: number) => `${Math.min(40, Math.round(ms / 40))}px`

watch(
  courseCode,
  async () => {
    stop()
    selectedId.value = null
    preview.value = []
    await load()
    // auto-select the first fully-resolved sentence for instant gratification
    const first = sentences.value.find((s) => s.fullyResolved) || sentences.value[0]
    if (first) select(first.id)
  },
  { immediate: true },
)

loadConfigs()
onBeforeUnmount(stop)
</script>

<style scoped>
.s0 { max-width: 1000px; margin: 0 auto; padding: 24px 16px 64px; color: #2a2724; }
.s0__head h1 { font-size: 22px; margin: 0 0 4px; }
.s0__tag { font-size: 11px; background: #ffa630; color: #2a2724; padding: 2px 7px; border-radius: 10px; vertical-align: middle; }
.s0__sub { margin: 0 0 16px; color: #6b655d; }
.s0__sub code { background: #efeae3; padding: 1px 5px; border-radius: 4px; }
.s0__controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 16px; font-size: 13px; }
.s0__controls select { margin-left: 6px; padding: 5px 8px; border-radius: 6px; border: 1px solid #cfc8bf; }
.s0__muted { color: #8c857b; }
.s0__err { color: #c0392b; }
.s0__body { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
.s0__list { list-style: none; margin: 0; padding: 0; max-height: 70vh; overflow: auto; border: 1px solid #e4ded6; border-radius: 10px; background: #fff; }
.s0__row { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid #f1ece5; cursor: pointer; }
.s0__row:hover { background: #faf7f2; }
.s0__row.is-sel { background: #eef6f0; }
.s0__row.is-partial { opacity: 0.62; }
.s0__order { font-variant-numeric: tabular-nums; color: #b3aaa0; font-size: 12px; width: 26px; }
.s0__texts { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.s0__target { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.s0__known { color: #8c857b; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.s0__atoms { font-size: 11px; color: #34a06a; font-variant-numeric: tabular-nums; }
.s0__player { border: 1px solid #e4ded6; border-radius: 10px; background: #fff; padding: 16px; position: sticky; top: 12px; }
.s0__player--empty { display: flex; align-items: center; justify-content: center; min-height: 120px; }
.s0__selhead { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
.s0__selhead strong { font-size: 18px; }
.s0__selhead em { color: #8c857b; font-style: normal; }
.s0__tiers { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.s0__tiers button { padding: 6px 10px; border-radius: 7px; border: 1px solid #cfc8bf; background: #f6f2ec; cursor: pointer; font-size: 12px; }
.s0__tiers button.is-active { background: #34a06a; color: #fff; border-color: #34a06a; }
.s0__all { font-weight: 600; }
.s0__stop { border-color: #c0392b !important; color: #c0392b; }
.s0__seq { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; line-height: 2; }
.s0__clip { padding: 3px 7px; border-radius: 6px; font-size: 12px; background: #eef0f2; border: 1px solid transparent; }
.s0__clip--target { background: #e6eef8; }
.s0__clip--meansGloss, .s0__clip--meaning { background: #fdf0e2; }
.s0__clip--translation { background: #f0e8f6; }
.s0__clip--wholeTake { background: #e3f6ec; font-weight: 600; }
.s0__clip.is-now { border-color: #34a06a; box-shadow: 0 0 0 2px rgba(52,160,106,0.25); }
.s0__gap { display: inline-block; height: 2px; background: #d8d1c8; border-radius: 2px; }
@media (max-width: 760px) { .s0__body { grid-template-columns: 1fr; } }
</style>
