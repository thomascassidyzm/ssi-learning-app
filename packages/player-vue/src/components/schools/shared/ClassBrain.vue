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
 * THE LENS IS FOLDED (Tom, 2026-09-17: "log-fold plus cloth"). A class three
 * hundred chunks in cannot have three hundred chunks at even spacing, and the
 * old answer — the server sending only the last sixty — threw away the read
 * this card exists for. So the axis is folded instead: the frontier keeps the
 * spacing a short course gets and the past compresses logarithmically, so the
 * whole stretch the class has reached stands on one screen. Where the fold has
 * squeezed arcs past legibility they stop being lines and become CLOTH, a
 * woven band over the past; an arc reaching from the deep past out to the
 * frontier is always still a line, because that is the course picking old
 * material back up and it is the point of the picture. The expand keeps the
 * true, unfolded line, scrollable, for anyone who wants the real spacing.
 * The maths is classBrainFold.ts; the ink is classBrainFigure.ts.
 *
 * The rules — first light, the abandoned detour, hearings per cycle, NEW
 * PHRASES as distinct first meetings — are the server's
 * (api/_utils/classBrain.ts). Nothing is recomputed here.
 */
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { fetchClassBrain, type ClassBrainPayload } from './classBrainData'
import { stateAt } from './classBrainState'
import { foldAxis, unfoldedAxis } from './classBrainFold'
import { buildFigure, type CaptionSource } from './classBrainFigure'
import ClassBrainFigure from './ClassBrainFigure.vue'

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

// ─── the full-screen overlay, and the FOUR ways out of it ───
// Tom got stuck in it on a real phone, 2026-09-17: a small ✕ in the corner of
// an opaque sheet, and a back gesture that left the page entirely. So the
// overlay now leaves by all four of the ways a person actually tries — a large
// labelled Close that sits inside the safe area, a tap on the scrim above the
// sheet, the browser's own back gesture, and Escape on a desktop — and every
// one of them goes through closeFull().
const full = ref(false)
/** True while OUR history entry is the top of the stack, so back() is ours to spend. */
let historyPushed = false

function openFull(): void {
  if (full.value) return
  full.value = true
  replayOpen.value = true
  // A history entry of our own: the back gesture then closes the overlay
  // instead of leaving the class page, which is what a phone user means by it.
  if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
    try { window.history.pushState({ ssiClassBrainFull: true }, ''); historyPushed = true } catch { historyPushed = false }
  }
}

/** The one door out — Close, the scrim, Escape, and the back gesture all use it. */
function closeFull(): void {
  if (!full.value) return
  full.value = false
  stop()
  if (historyPushed) {
    historyPushed = false
    try { window.history.back() } catch { /* nothing to go back to: the overlay is shut either way */ }
  }
}

/** The back gesture. Our entry is already gone, so this must never spend another. */
function onPopState(): void {
  historyPushed = false
  if (full.value) { full.value = false; stop() }
}

function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') closeFull() }

function unbind(): void {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', onKey)
  }
  if (typeof window !== 'undefined') window.removeEventListener('popstate', onPopState)
}

watch(full, (isFull) => {
  if (typeof document === 'undefined') return
  if (isFull) {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPopState)
  } else unbind()
})
onBeforeUnmount(unbind)

// ─── the drawing ───
const legos = computed(() => data.value?.legos ?? [])
const state = computed(() => stateAt(data.value?.events ?? [], legos.value, data.value?.axisFrom ?? 0, step.value))

/** The card's lens: folded, 560 units wide with the line inset from the box. */
const W = 560
const PAD = 22
const cardAxis = computed(() => foldAxis(Math.max(legos.value.length, 1), W - PAD * 2, PAD))
/** The expand's lens: the true spacing, as wide as it needs to be, scrolled. */
const fullAxis = computed(() => unfoldedAxis(Math.max(legos.value.length, 1), undefined, PAD))

/** The phrase the class is on, and the chunks that made it. */
const captionSource = computed<CaptionSource | null>(() => {
  const last = state.value.last
  if (!last || step.value >= total.value) return null
  const from = data.value?.axisFrom ?? 0
  const fires = last.fires.map((f) => f - from).filter((f) => f >= 0 && f < legos.value.length)
  if (!fires.length) return null
  const phrase = last.phrase ? data.value?.phrases[last.phrase] : null
  return {
    fires,
    t: phrase ? phrase.t : legos.value[last.lego - from]?.t || '',
    k: phrase ? phrase.k : legos.value[last.lego - from]?.k || '',
  }
})

/** True once the axis is long enough that the fold has bent it. */
const isFolded = computed(() => cardAxis.value.lambda != null)
const cardFigure = computed(() => buildFigure(cardAxis.value, legos.value, state.value, {
  caption: captionSource.value,
  live: captionSource.value?.fires ?? [],
}))
// The unfolded line is long, so its arcs are long: it needs the height to fan
// them out, and it gets it by scrolling rather than by squashing.
const fullFigure = computed(() => buildFigure(fullAxis.value, legos.value, state.value, {
  caption: captionSource.value,
  live: captionSource.value?.fires ?? [],
  scroll: true,
  topRoom: 260,
}))

/** How far through the current belt, as a sentence or '' when unknowable. */
const beltLine = computed(() => {
  const b = data.value?.beltProgress
  if (!b || !b.total) return ''
  const pct = Math.min(100, Math.round((b.done / b.total) * 100))
  return t('org.brain.beltPercent', '{pct}% through the {belt} belt')
    .replace('{pct}', String(pct))
    .replace('{belt}', b.name.toLowerCase())
})

// ─── the four totals ───
// Each one is the class's own record and nothing else's. NEW PHRASES is an
// item first introduced; PRACTISED is hearings and repeats (Tom, 2026-09-17).
const tiles = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    {
      // THE LAST NEW PHRASE, IN THE LEARNER'S OWN WORDS (Tom, 2026-09-17:
      // "the idea of Sentence-3 is not helpful ... everything to the learner
      // is about the item introduced, that's being practised right now"). The
      // tile speaks the phrase itself, never an ordinal and never the words
      // sentence, round, lego or cycle. Underneath it, the prompt the class
      // hears, and how far through the belt these new phrases have carried
      // them — a figure counted over the live course, band by band.
      key: 'position',
      word: t('org.brain.statJustIntroduced', 'Just introduced'),
      value: d.reachedLegoText?.t || '—',
      detail: [d.reachedLegoText?.k || '', beltLine.value].filter(Boolean).join(' · '),
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
      detail: t('org.brain.practisedNTimes', 'practised {n} times').replace('{n}', String(d.tally.hearings)),
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
          <ClassBrainFigure :figure="cardFigure" :alt="t('org.brain.svgAlt', 'The chunks the class has met, joined where they were said together')" />
        </div>
        <p v-if="isFolded" class="cb-cap">{{ t('org.brain.foldCaption', 'Chunks stand on one line in the order the course introduces them, so how far right the ink reaches is how far into the course the class is. The line is folded: the newest chunks keep their room and the older ones crowd together, so the whole stretch the class has reached fits on one screen. Where old chunks sit too close for an arc to be read, the arcs are woven into a band, and the heavier the weave the more the class has practised there. An arc reaching from the far past out to today is always still drawn.') }}</p>
        <p v-if="!isFolded" class="cb-cap">{{ t('org.brain.caption', 'Chunks stand on one line in the order the course introduces them, so how far right the ink reaches is how far into the course the class is. A dot lights when the class has met that chunk; it grows with repetition. An arc joins two chunks the class has said together inside one phrase, and thickens with every repeat.') }}</p>

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
                <td class="cb-n">{{ t('org.brain.practisedN', 'practised {n}×').replace('{n}', String(row.n)) }}</td>
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
          <button type="button" class="cb-scrim" data-testid="cb-scrim" :aria-label="t('org.brain.close', 'Close')" @click="closeFull" />
          <header class="cb-full-bar">
            <span class="cb-full-title">{{ t('org.nodeHome.courseJourney', 'Course journey') }}</span>
            <button type="button" class="cb-close" data-testid="cb-close" @click="closeFull">
              <span aria-hidden="true">✕</span> {{ t('org.brain.close', 'Close') }}
            </button>
          </header>
          <div class="cb-full-scroll">
            <p class="cb-cap cb-unfolded-note">{{ t('org.brain.unfoldedNote', 'The true spacing, unfolded. Scroll it sideways to walk the course.') }}</p>
            <div class="cb-draw cb-draw-scroll">
              <ClassBrainFigure :figure="fullFigure" :alt="t('org.brain.svgAlt', 'The chunks the class has met, joined where they were said together')" />
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
                  <td class="cb-n">{{ t('org.brain.practisedN', 'practised {n}×').replace('{n}', String(row.n)) }}</td>
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
/* The unfolded line is wider than any phone and is meant to be walked. */
.cb-draw-scroll { overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
.cb-draw-scroll svg { width: auto; max-width: none; height: 300px; }
.cb-unfolded-note { margin-bottom: 4px; }
.cb-cap { font-size: 12px; line-height: 1.5; color: var(--schools-fg-3, #8A8078); margin: 6px 0 0; }

.cb-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0 8px; }
@media (min-width: 620px) { .cb-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.cb-stat { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border: 1px solid var(--schools-border, #E7E1D8); border-radius: 10px; background: #fff; min-width: 0; }
.cb-stat-word { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3, #8A8078); }
.cb-stat-value { font-size: 18px; font-weight: 600; line-height: 1.2; color: var(--schools-blue, #60A5FA); }
.cb-stat-detail { font-size: 11px; color: var(--schools-fg-3, #8A8078); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cb-actions { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.cb-btn { font: inherit; font-size: 13px; min-height: 40px; padding: 0 12px; border: 1px solid var(--schools-border, #E7E1D8); background: #fff; border-radius: 8px; color: var(--schools-fg-1, #2C2622); cursor: pointer; }
.cb-btn-icon { min-width: 44px; font-size: 16px; padding: 0; }

.cb-replay { margin-top: 10px; }
.cb-transport { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 10px 0 6px; }
.cb-transport button { font: inherit; font-size: 15px; min-width: 44px; min-height: 44px; border: 1px solid var(--schools-border, #E7E1D8); background: #fff; border-radius: 8px; color: var(--schools-fg-1, #2C2622); cursor: pointer; }
.cb-transport .cb-play { background: var(--schools-red, #DB1E17); color: #fff; border-color: var(--schools-red, #DB1E17); min-width: 56px; }
.cb-transport input[type='range'] { flex: 1 1 140px; min-width: 120px; accent-color: var(--schools-red, #DB1E17); }
.cb-speed { font-size: 11px; color: var(--schools-fg-3, #8A8078); display: flex; align-items: center; gap: 4px; }
.cb-where { font-size: 13px; color: var(--schools-fg-1, #2C2622); margin: 0 0 8px; min-height: 1.5em; }

.cb-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.cb-table td { padding: 5px 6px; border-top: 1px solid var(--schools-border, #E7E1D8); vertical-align: top; }
.cb-table td.cb-n { text-align: right; white-space: nowrap; color: var(--schools-blue, #60A5FA); font-weight: 600; width: 6em; font-size: 11px; }
.cb-known { color: var(--schools-fg-3, #8A8078); font-size: 12px; }
.cb-bar { height: 4px; background: var(--schools-blue, #60A5FA); border-radius: 3px; margin-top: 3px; opacity: 0.7; }
.cb-table tr.is-now td { background: rgba(96, 165, 250, 0.14); }

/* FULL SCREEN — phone first, and it must LEAVE. A scrim strip across the top
   is a tap target of its own, the bar under it owns the top inset so the Close
   pill can never sit in the notch, the scroller owns the bottom one, and both
   sides clear a landscape notch. z-index is above the schools shell's own
   chrome (SchoolsTopBar tops out at 70) so nothing can paint over Close. */
.cb-full { position: fixed; inset: 0; z-index: 1200; background: var(--schools-bg, #F7F4EF); display: flex; flex-direction: column; }
/* The strip of scrim above the sheet: tapping it closes, the way a phone
   sheet is expected to. It is a real button so a keyboard and a screen
   reader reach it too. */
.cb-scrim {
  flex: 0 0 auto; border: none; padding: 0; cursor: pointer; display: block; width: 100%;
  height: calc(30px + env(safe-area-inset-top, 0px));
  background: rgba(15, 18, 18, 0.55);
}
.cb-full-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 60px;
  padding: 0 max(12px, env(safe-area-inset-right, 0px)) 0 max(12px, env(safe-area-inset-left, 0px));
  background: #fff; border-bottom: 1px solid var(--schools-border, #E7E1D8);
  border-radius: 14px 14px 0 0;
}
.cb-full-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--schools-fg-3, #8A8078); }
/* Large, labelled and unmissable — a bare ✕ in a corner is what Tom could not
   find on his phone. */
.cb-close {
  font: inherit; font-size: 15px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;
  min-height: 46px; padding: 0 18px; border-radius: 999px;
  border: 1px solid var(--schools-border-strong, rgba(15, 18, 18, .18));
  background: var(--schools-card, #fff); color: var(--schools-fg, #0F1212); cursor: pointer;
}
.cb-full-scroll {
  flex: 1; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
  background: var(--schools-bg, #F7F4EF);
  padding: 12px max(12px, env(safe-area-inset-left, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-right, 0px));
}
</style>
