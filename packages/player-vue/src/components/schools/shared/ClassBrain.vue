<script setup lang="ts">
/**
 * ClassBrain — THE COURSE JOURNEY, drawn honestly (Tom's ruling, 2026-09-17:
 * shape B of the class-stats exploration, docs/specimens/class-stats/).
 *
 * The chunks of the course stand on one line in the order the course
 * introduces them, so how far right the ink reaches is how far into the course
 * the class is. A dot lights the moment the class first meets a chunk and
 * grows with repetition; an arc joins two chunks the class has said together
 * inside one phrase, and thickens every time that happens again. That is the
 * old progress bar with its reasons showing — it replaces the bar, it does not
 * sit beside it.
 *
 * THE CLASS IS THE UNIT. Everything here comes from the class's own account,
 * the one Play as class runs on. No pupil is behind any of it, nothing is
 * broken out per pupil, and there is NO COMPARISON LAYER anywhere under the
 * brain — comparison is the Insights lens's job, not this card's.
 *
 * Two controls, both staying on the page: REPLAY opens the transport inline,
 * and EXPAND opens the same brain full screen for a phone, as an overlay with
 * an obvious close rather than a route of its own.
 *
 * The rules — first light, the abandoned detour, hearings per cycle, NEW
 * PHRASES as distinct first meetings — are the server's
 * (api/_utils/classBrain.ts). Nothing is recomputed here.
 */
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { fetchClassBrain, type ClassBrainPayload } from './classBrainData'
import { stateAt, edgeWidth, edgeOpacity, dotRadius } from './classBrainState'

const props = defineProps<{
  classId: string
  getToken: () => Promise<string | null> | string | null
}>()

const { t } = useI18n()

const data = ref<ClassBrainPayload | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await fetchClassBrain(props.classId, await props.getToken())
    step.value = data.value.events.length
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
watch(() => props.classId, (id) => { if (id) void load() }, { immediate: true })

// ─── the replay transport ───
// One interval, rebuilt on a speed change, stopping itself at the end. The
// scrubber starts at the LATEST frame: the card's job is to show where the
// class is now, and the replay is the thing you ask for.
const step = ref(0)
const playing = ref(false)
const speed = ref(2)
let timer: ReturnType<typeof setInterval> | null = null
const total = computed(() => data.value?.events.length ?? 0)

function stop(): void { playing.value = false; if (timer) clearInterval(timer); timer = null }
function start(): void {
  if (playing.value || !total.value) return
  if (step.value >= total.value) step.value = 0
  playing.value = true
  timer = setInterval(() => {
    if (step.value >= total.value) { stop(); return }
    step.value += 1
  }, 420 / speed.value)
}
function toggle(): void { playing.value ? stop() : start() }
function setStep(k: number): void { stop(); step.value = Math.max(0, Math.min(total.value, k)) }
watch(speed, () => { if (playing.value) { stop(); start() } })
onBeforeUnmount(stop)

/** The cycle index at the end of sitting `s`. */
function sittingEnd(s: number): number {
  const events = data.value?.events ?? []
  let k = 0
  for (let i = 0; i < events.length; i++) if (events[i].s <= s) k = i + 1
  return k
}
const currentSitting = computed(() => (step.value ? (data.value?.events[step.value - 1]?.s ?? 0) : -1))
function nextSitting(): void { setStep(sittingEnd(currentSitting.value + 1)) }
function prevSitting(): void {
  const cur = Math.max(0, currentSitting.value)
  const atStartOfCur = step.value === sittingEnd(cur)
  setStep(atStartOfCur ? sittingEnd(cur - 1) : sittingEnd(cur - 1))
}

const replayOpen = ref(false)
const full = ref(false)
function openFull(): void { full.value = true; replayOpen.value = true }
function closeFull(): void { full.value = false; stop() }
function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') closeFull() }
watch(full, (isFull) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = isFull ? 'hidden' : ''
  if (isFull) document.addEventListener('keydown', onKey)
  else document.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKey)
})

// ─── the drawing ───
const legos = computed(() => data.value?.legos ?? [])
const state = computed(() => stateAt(data.value?.events ?? [], legos.value, data.value?.axisFrom ?? 0, step.value))
// Labels only where they can be read. Beyond that the dots and the arcs carry
// the picture and the words would be a grey smear.
const showLabels = computed(() => legos.value.length <= (full.value ? 26 : 14))
const W = 560
const PAD = 22
const geom = computed(() => {
  const n = Math.max(legos.value.length, 1)
  const y = showLabels.value ? 150 : 96
  const h = showLabels.value ? 280 : 150
  // The labels lean right at 58°, so the last one runs past the last dot. The
  // box is wider than the line to hold it; the dots do not move.
  const w = W + (showLabels.value ? 80 : 0)
  const x = (i: number): number => (n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1))
  return { y, h, w, x }
})
const arcs = computed(() => {
  const { x, y } = geom.value
  return [...state.value.edge.entries()]
    .sort((p, q) => p[1] - q[1])
    .map(([key, n]) => {
      const [a, b] = key.split('|').map(Number)
      const x1 = x(a)
      const x2 = x(b)
      const r = (x2 - x1) / 2
      return { d: `M${x1} ${y} A${r} ${r * 0.9} 0 0 1 ${x2} ${y}`, w: edgeWidth(n), o: edgeOpacity(n) }
    })
})
const dots = computed(() => {
  const { x, y } = geom.value
  const max = Math.max(1, ...state.value.node)
  return legos.value.map((l, i) => ({
    key: l.id,
    cx: x(i),
    cy: y,
    r: dotRadius(state.value.node[i], max),
    lit: state.value.node[i] > 0,
    text: l.t,
  }))
})
/** The phrase the class is on, written above the chunks that made it. */
const caption = computed(() => {
  const last = state.value.last
  if (!last || step.value >= total.value) return null
  const { x } = geom.value
  const from = data.value?.axisFrom ?? 0
  const fs = last.fires.map((f) => f - from).filter((f) => f >= 0 && f < legos.value.length)
  if (!fs.length) return null
  const phrase = last.phrase ? data.value?.phrases[last.phrase] : null
  return {
    cx: fs.reduce((s, f) => s + x(f), 0) / fs.length,
    t: phrase ? phrase.t : legos.value[last.lego - from]?.t || '',
    k: phrase ? phrase.k : legos.value[last.lego - from]?.k || '',
  }
})

// ─── the four totals ───
// Each one is the class's own record and nothing else's. NEW PHRASES is an
// item first introduced; PRACTISED is hearings and repeats (Tom, 2026-09-17).
const tiles = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    {
      key: 'position',
      word: t('org.brain.statPosition', 'Position'),
      value: d.reachedSeed ? t('org.brain.sentenceN', 'sentence {n}').replace('{n}', String(d.reachedSeed)) : '—',
      detail: d.reachedSeedText?.k || '',
    },
    {
      key: 'minutes',
      word: t('org.brain.statMinutes', 'In-app minutes'),
      value: d.minutes >= 0 ? String(d.minutes) : '—',
      detail: d.sittings.length === 1
        ? t('org.brain.acrossOneSitting', 'in one sitting')
        : t('org.brain.acrossSittings', 'across {n} sittings').replace('{n}', String(d.sittings.length)),
    },
    {
      key: 'practised',
      word: t('org.brain.statPractised', 'Practised'),
      value: t('org.brain.nPhrases', '{n} phrases').replace('{n}', String(d.distinctPhrases)),
      detail: t('org.brain.heardNTimes', 'heard {n} times').replace('{n}', String(d.tally.hearings)),
    },
    {
      key: 'new',
      word: t('org.brain.statNewPhrases', 'New phrases'),
      value: String(d.introducedCount),
      detail: t('org.brain.metForTheFirstTime', 'met for the first time'),
    },
  ]
})

/** The phrases practised, in course order, counted as at the scrubber. */
const practisedRows = computed(() => {
  const d = data.value
  if (!d) return []
  const ids = [...state.value.phraseCounts.keys()].sort((a, b) => {
    const pa = d.phrases[a]
    const pb = d.phrases[b]
    if (!pa || !pb) return 0
    return (pa.lego * 1000 + (pa.role === 'use' ? 500 : 0) + pa.pos) - (pb.lego * 1000 + (pb.role === 'use' ? 500 : 0) + pb.pos)
  })
  const max = Math.max(1, ...state.value.phraseCounts.values())
  return ids.map((id) => ({
    id,
    t: d.phrases[id]?.t || '',
    k: d.phrases[id]?.k || '',
    n: state.value.phraseCounts.get(id) || 0,
    pct: 8 + (92 * (state.value.phraseCounts.get(id) || 0)) / max,
    now: state.value.last?.phrase === id,
  }))
})

const whereLine = computed(() => {
  const d = data.value
  const e = state.value.last
  if (!d || !e) return t('org.brain.beforeFirstSitting', 'Before the first sitting. Press play.')
  const day = new Date(e.t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const phrase = e.phrase ? d.phrases[e.phrase]?.t : legos.value[e.lego - d.axisFrom]?.t
  return t('org.brain.whereLine', 'Sitting {s} of {of}, {day} · cycle {k} of {n} · {phrase}')
    .replace('{s}', String(e.s + 1))
    .replace('{of}', String(d.sittings.length))
    .replace('{day}', day)
    .replace('{k}', String(step.value))
    .replace('{n}', String(total.value))
    .replace('{phrase}', phrase || '')
})

const hasPlayed = computed(() => (data.value?.events.length ?? 0) > 0)
</script>

<template>
  <div class="cb">
    <p v-if="loading" class="cb-quiet">{{ t('org.brain.loading', 'Reading the class’s own record…') }}</p>
    <p v-else-if="error" class="cb-quiet">{{ t('org.brain.readError', 'Could not read this class’s journey.') }}</p>
    <p v-else-if="!hasPlayed" class="cb-quiet">{{ t('org.brain.nothingToDraw', 'Nothing to draw yet — the first lesson played as class starts the ink.') }}</p>

    <template v-else>
      <!-- INLINE: the brain at its latest frame, the four totals, two controls -->
      <div v-if="!full" class="cb-body">
        <div class="cb-draw">
          <svg :viewBox="`0 0 ${geom.w} ${geom.h}`" role="img" :aria-label="t('org.brain.svgAlt', 'The chunks the class has met, joined where they were said together')">
            <path v-for="(a, i) in arcs" :key="`a${i}`" :d="a.d" fill="none" stroke="var(--schools-red, #2563eb)" :stroke-opacity="a.o" :stroke-width="a.w" />
            <line :x1="geom.x(0)" :y1="geom.y" :x2="geom.x(legos.length - 1)" :y2="geom.y" stroke="#e4dfd8" stroke-width="3" />
            <g v-for="(d, i) in dots" :key="d.key">
              <circle :cx="d.cx" :cy="d.cy" :r="d.r" :fill="d.lit ? 'var(--schools-red, #2563eb)' : '#e4dfd8'" :stroke="d.lit ? '#ffffff' : '#c9c2b8'" stroke-width="1" />
              <text v-if="showLabels" :transform="`translate(${d.cx} ${geom.y + 26}) rotate(58)`" font-size="12" :fill="d.lit ? '#2C2622' : '#c4bdb2'" :font-weight="d.lit ? 600 : 400">{{ dots[i].text }}</text>
            </g>
            <template v-if="caption">
              <text :x="caption.cx" y="30" font-size="13" fill="var(--schools-red, #2563eb)" text-anchor="middle">{{ caption.t }}</text>
              <text :x="caption.cx" y="46" font-size="12" fill="#8A8078" text-anchor="middle">{{ caption.k }}</text>
            </template>
          </svg>
        </div>
        <p class="cb-cap">{{ t('org.brain.caption', 'Chunks stand on one line in the order the course introduces them, so how far right the ink reaches is how far into the course the class is. A dot lights when the class has met that chunk; it grows with repetition. An arc joins two chunks the class has said together inside one phrase, and thickens with every repeat.') }}</p>

        <div class="cb-stats">
          <div v-for="tile in tiles" :key="tile.key" class="cb-stat">
            <span class="cb-stat-word">{{ tile.word }}</span>
            <span class="cb-stat-value">{{ tile.value }}</span>
            <span class="cb-stat-detail">{{ tile.detail }}</span>
          </div>
        </div>

        <div class="cb-actions">
          <button type="button" class="cb-btn" :aria-expanded="replayOpen" aria-controls="cb-replay" @click="replayOpen = !replayOpen">
            {{ replayOpen ? t('org.brain.hideReplay', 'Hide the replay') : t('org.brain.replay', '▶ Replay how it grew') }}
          </button>
          <button type="button" class="cb-btn cb-btn-icon" :title="t('org.brain.expand', 'Open full screen')" :aria-label="t('org.brain.expand', 'Open full screen')" @click="openFull">⤢</button>
        </div>

        <div v-if="replayOpen" id="cb-replay" class="cb-replay">
          <div class="cb-transport" role="group" :aria-label="t('org.brain.transportLabel', 'Replay')">
            <button type="button" :title="t('org.brain.restart', 'Restart')" @click="setStep(0)">⟲</button>
            <button type="button" :title="t('org.brain.prevSitting', 'Previous sitting')" @click="prevSitting">◀</button>
            <button type="button" class="cb-play" :title="t('org.brain.playPause', 'Play or pause')" @click="toggle">{{ playing ? '❚❚' : '▶' }}</button>
            <button type="button" :title="t('org.brain.nextSitting', 'Next sitting')" @click="nextSitting">▶|</button>
            <input type="range" min="0" :max="total" :value="step" step="1" :aria-label="t('org.brain.scrub', 'Position in time')" @input="setStep(Number(($event.target as HTMLInputElement).value))" />
            <label class="cb-speed">{{ t('org.brain.speed', 'speed') }}
              <select v-model.number="speed"><option :value="1">1×</option><option :value="2">2×</option><option :value="4">4×</option></select>
            </label>
          </div>
          <p class="cb-where">{{ whereLine }}</p>
          <span class="schools-kicker">{{ t('org.brain.practisedTitle', 'Phrases practised') }}</span>
          <p class="cb-cap">{{ t('org.brain.practisedCap', 'In course order, counts as at the scrubber. The highlighted row is the phrase just played.') }}</p>
          <table v-if="practisedRows.length" class="cb-table">
            <tbody>
              <tr v-for="row in practisedRows" :key="row.id" :class="{ 'is-now': row.now }">
                <td>
                  <div>{{ row.t }}</div>
                  <div class="cb-known">{{ row.k }}</div>
                  <div class="cb-bar" :style="{ width: `${row.pct}%` }" />
                </td>
                <td class="cb-n">{{ t('org.brain.heardN', 'heard {n}×').replace('{n}', String(row.n)) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="cb-cap">{{ t('org.brain.nothingYet', 'Nothing practised yet at this point.') }}</p>
        </div>
      </div>

      <!-- FULL SCREEN: the same brain, phone first. An in-app overlay with an
           obvious close, padded out of the notch and the home indicator. -->
      <Teleport v-if="full" to="body">
        <div class="cb-full schools-surface" role="dialog" aria-modal="true" :aria-label="t('org.brain.fullTitle', 'The class’s course journey')">
          <header class="cb-full-bar">
            <span class="cb-full-title">{{ t('org.nodeHome.courseJourney', 'Course journey') }}</span>
            <button type="button" class="cb-close" :aria-label="t('org.brain.close', 'Close')" @click="closeFull">✕</button>
          </header>
          <div class="cb-full-scroll">
            <div class="cb-draw">
              <svg :viewBox="`0 0 ${geom.w} ${geom.h}`" role="img" :aria-label="t('org.brain.svgAlt', 'The chunks the class has met, joined where they were said together')">
                <path v-for="(a, i) in arcs" :key="`fa${i}`" :d="a.d" fill="none" stroke="var(--schools-red, #2563eb)" :stroke-opacity="a.o" :stroke-width="a.w" />
                <line :x1="geom.x(0)" :y1="geom.y" :x2="geom.x(legos.length - 1)" :y2="geom.y" stroke="#e4dfd8" stroke-width="3" />
                <g v-for="(d, i) in dots" :key="`f${d.key}`">
                  <circle :cx="d.cx" :cy="d.cy" :r="d.r" :fill="d.lit ? 'var(--schools-red, #2563eb)' : '#e4dfd8'" :stroke="d.lit ? '#ffffff' : '#c9c2b8'" stroke-width="1" />
                  <text v-if="showLabels" :transform="`translate(${d.cx} ${geom.y + 26}) rotate(58)`" font-size="12" :fill="d.lit ? '#2C2622' : '#c4bdb2'" :font-weight="d.lit ? 600 : 400">{{ dots[i].text }}</text>
                </g>
                <template v-if="caption">
                  <text :x="caption.cx" y="30" font-size="13" fill="var(--schools-red, #2563eb)" text-anchor="middle">{{ caption.t }}</text>
                  <text :x="caption.cx" y="46" font-size="12" fill="#8A8078" text-anchor="middle">{{ caption.k }}</text>
                </template>
              </svg>
            </div>
            <div class="cb-transport" role="group" :aria-label="t('org.brain.transportLabel', 'Replay')">
              <button type="button" :title="t('org.brain.restart', 'Restart')" @click="setStep(0)">⟲</button>
              <button type="button" :title="t('org.brain.prevSitting', 'Previous sitting')" @click="prevSitting">◀</button>
              <button type="button" class="cb-play" :title="t('org.brain.playPause', 'Play or pause')" @click="toggle">{{ playing ? '❚❚' : '▶' }}</button>
              <button type="button" :title="t('org.brain.nextSitting', 'Next sitting')" @click="nextSitting">▶|</button>
              <input type="range" min="0" :max="total" :value="step" step="1" :aria-label="t('org.brain.scrub', 'Position in time')" @input="setStep(Number(($event.target as HTMLInputElement).value))" />
              <label class="cb-speed">{{ t('org.brain.speed', 'speed') }}
                <select v-model.number="speed"><option :value="1">1×</option><option :value="2">2×</option><option :value="4">4×</option></select>
              </label>
            </div>
            <p class="cb-where">{{ whereLine }}</p>
            <div class="cb-stats">
              <div v-for="tile in tiles" :key="`f${tile.key}`" class="cb-stat">
                <span class="cb-stat-word">{{ tile.word }}</span>
                <span class="cb-stat-value">{{ tile.value }}</span>
                <span class="cb-stat-detail">{{ tile.detail }}</span>
              </div>
            </div>
            <p class="cb-cap">{{ t('org.brain.caption', 'Chunks stand on one line in the order the course introduces them, so how far right the ink reaches is how far into the course the class is. A dot lights when the class has met that chunk; it grows with repetition. An arc joins two chunks the class has said together inside one phrase, and thickens with every repeat.') }}</p>
            <span class="schools-kicker">{{ t('org.brain.practisedTitle', 'Phrases practised') }}</span>
            <table v-if="practisedRows.length" class="cb-table">
              <tbody>
                <tr v-for="row in practisedRows" :key="`f${row.id}`" :class="{ 'is-now': row.now }">
                  <td>
                    <div>{{ row.t }}</div>
                    <div class="cb-known">{{ row.k }}</div>
                    <div class="cb-bar" :style="{ width: `${row.pct}%` }" />
                  </td>
                  <td class="cb-n">{{ t('org.brain.heardN', 'heard {n}×').replace('{n}', String(row.n)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
.cb { width: 100%; }
.cb-quiet { font-size: var(--text-sm, 13px); color: var(--schools-fg-2, #6B6259); margin: 0; }
.cb-draw svg { width: 100%; height: auto; display: block; }
.cb-cap { font-size: 12px; line-height: 1.5; color: var(--schools-fg-3, #8A8078); margin: 6px 0 0; }

.cb-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0 8px; }
@media (min-width: 620px) { .cb-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.cb-stat { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border: 1px solid var(--schools-border, #E7E1D8); border-radius: 10px; background: #fff; min-width: 0; }
.cb-stat-word { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3, #8A8078); }
.cb-stat-value { font-size: 18px; font-weight: 600; line-height: 1.2; color: var(--schools-red, #2563eb); }
.cb-stat-detail { font-size: 11px; color: var(--schools-fg-3, #8A8078); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cb-actions { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.cb-btn { font: inherit; font-size: 13px; min-height: 40px; padding: 0 12px; border: 1px solid var(--schools-border, #E7E1D8); background: #fff; border-radius: 8px; color: var(--schools-fg-1, #2C2622); cursor: pointer; }
.cb-btn-icon { min-width: 44px; font-size: 16px; padding: 0; }

.cb-replay { margin-top: 10px; }
.cb-transport { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 10px 0 6px; }
.cb-transport button { font: inherit; font-size: 15px; min-width: 44px; min-height: 44px; border: 1px solid var(--schools-border, #E7E1D8); background: #fff; border-radius: 8px; color: var(--schools-fg-1, #2C2622); cursor: pointer; }
.cb-transport .cb-play { background: var(--schools-red, #2563eb); color: #fff; border-color: var(--schools-red, #2563eb); min-width: 56px; }
.cb-transport input[type='range'] { flex: 1 1 140px; min-width: 120px; accent-color: var(--schools-red, #2563eb); }
.cb-speed { font-size: 11px; color: var(--schools-fg-3, #8A8078); display: flex; align-items: center; gap: 4px; }
.cb-where { font-size: 13px; color: var(--schools-fg-1, #2C2622); margin: 0 0 8px; min-height: 1.5em; }

.cb-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.cb-table td { padding: 5px 6px; border-top: 1px solid var(--schools-border, #E7E1D8); vertical-align: top; }
.cb-table td.cb-n { text-align: right; white-space: nowrap; color: var(--schools-red, #2563eb); font-weight: 600; width: 6em; font-size: 11px; }
.cb-known { color: var(--schools-fg-3, #8A8078); font-size: 12px; }
.cb-bar { height: 4px; background: var(--schools-red, #2563eb); border-radius: 3px; margin-top: 3px; opacity: 0.7; }
.cb-table tr.is-now td { background: rgba(37, 99, 235, 0.07); }

/* FULL SCREEN — phone first. The bar owns the top inset, the scroller owns
   the bottom one, and both sides clear a landscape notch. */
.cb-full { position: fixed; inset: 0; z-index: 1200; background: var(--schools-bg, #F7F4EF); display: flex; flex-direction: column; }
.cb-full-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  height: calc(54px + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) max(12px, env(safe-area-inset-right, 0px)) 0 max(12px, env(safe-area-inset-left, 0px));
  background: #fff; border-bottom: 1px solid var(--schools-border, #E7E1D8);
}
.cb-full-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--schools-fg-3, #8A8078); }
.cb-close { font: inherit; font-size: 18px; min-width: 44px; min-height: 44px; border: none; background: transparent; color: var(--schools-fg-1, #2C2622); cursor: pointer; }
.cb-full-scroll {
  flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 12px max(12px, env(safe-area-inset-left, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-right, 0px));
}
</style>
