<!--
  TeleprompterScroll.vue — the Spotify/karaoke-style scrolling line display
  ("the teleprompter"): a vertical stack of text rows, the current line at
  full prominence, past lines scrolled up and dimmed, upcoming lines visible
  below at reduced opacity.

  Extracted 2026-07-22 from ListeningOverlay.vue, where this pattern
  originated as the Dialogues/Core/All listening-mode row display, so
  main-flow pod dialogues (PodTurnDisplay.vue) and ListeningOverlay's
  Dialogues scene view share ONE implementation instead of two.

  Purely presentational + self-windowing: given the FULL ordered `lines`
  list and a `currentIndex`, it slices the visible window, tracks
  current/past/future, and auto-scrolls the current row to center whenever
  the index changes. Callers own playback/timing; this component only ever
  displays. A `#line` scoped slot lets a caller (ListeningOverlay) fully
  override a row's inner content (e.g. fusion-drill strips, interleaved
  gloss pairs) while still getting the shared windowing/scroll/CSS for free;
  omit it and the default target+known+speaker-chip rendering applies.
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { dirFor } from '@ssi/core'

export interface TeleprompterLine {
  id: string | number
  target?: string
  known?: string
  speakerName?: string
  speakerColor?: string
}

const props = withDefaults(defineProps<{
  /** Full ordered line list — NOT pre-windowed; this component windows it. */
  lines: TeleprompterLine[]
  /** Index into `lines` of the currently-active row. -1/null = none active. */
  currentIndex: number | null
  /** Rows kept mounted around the current one (odd number centers evenly). */
  windowSize?: number
  /** Show the known-language gloss under the current row (default fallback
   *  content only — a `#line` slot override controls its own gloss). */
  showGloss?: boolean
  /** ISO 639-3 of the target / known text, declared on the rows so the
   *  glyph-coverage CSS can give a Greek, Cyrillic, Devanagari or Yoruba run
   *  the font that can actually spell it (styles/design-tokens.css). One
   *  language per teleprompter instance, so these are component-level props
   *  rather than per-line fields. */
  targetLang?: string
  knownLang?: string
  /** Vertical breathing room (vh) above/below the list so the first/last
   *  row can still reach the anchor position. */
  padBlockVh?: number
  /** Where the current row is pinned, as a fraction of the container's
   *  height from its top (0 = top, 0.5 = centre, 1 = bottom). Default is
   *  centre; PodTurnDisplay anchors to the upper third so the current line
   *  reads as fixed while other lines move past it, conveyor-belt style,
   *  rather than a highlight jumping down an otherwise static page
   *  (Tom 2026-07-22). */
  anchorFraction?: number
  /** Clickable rows emitting `select` — off by default (main-flow pod
   *  display is a passive teleprompter; ListeningOverlay opts in). */
  interactive?: boolean
}>(), {
  currentIndex: -1,
  windowSize: 7,
  showGloss: true,
  padBlockVh: 25,
  anchorFraction: 0.5,
  interactive: false,
})

const emit = defineEmits<{ (e: 'select', index: number): void }>()

const rootEl = ref<HTMLElement | null>(null)

const visibleLines = computed(() => {
  const cur = props.currentIndex ?? -1
  const center = Math.max(0, cur)
  const half = Math.floor(props.windowSize / 2)
  const start = Math.max(0, center - half)
  const end = Math.min(props.lines.length, start + props.windowSize)
  return props.lines.slice(start, end).map((line, i) => {
    const displayIndex = start + i
    return {
      line,
      displayIndex,
      isCurrent: displayIndex === cur,
      isPast: displayIndex < cur,
    }
  })
})

// Pins the current row's centre at anchorFraction of the container's height,
// rather than relying on scrollIntoView's fixed 'center' — a plain
// scrollIntoView only reaches true centre when there's exactly half a
// container's worth of blank space on each side (padBlockVh), so short lists
// or a non-centre anchor would drift. Computing the offset directly keeps the
// anchor position consistent regardless of list length or anchorFraction.
//
// offsetTop is measured from the offsetParent, so .teleprompter itself must
// be positioned (position: relative below) — when it wasn't, the nearest
// positioned ancestor was the CALLER's absolutely-positioned wrapper and the
// wrapper's top PADDING inflated every offset, over-scrolling the current row
// clean under the app's top chrome (2026-07-23 staging report: teleprompter
// obscured by the belt pill).
const scrollCurrentIntoView = (behavior: ScrollBehavior = 'smooth') => {
  const container = rootEl.value
  const current = container?.querySelector('.phrase-row.current') as HTMLElement | null | undefined
  if (!container || !current) return
  const targetTop = current.offsetTop + current.offsetHeight / 2 - container.clientHeight * props.anchorFraction
  container.scrollTo({ top: targetTop, behavior })
}

watch(() => props.currentIndex, async () => {
  await nextTick()
  scrollCurrentIntoView()
})
// First anchor is INSTANT and runs before the browser paints (mounted +
// nextTick both flush pre-paint): the very first visible frame already has
// the current row at its anchor. With the old smooth first scroll the row
// painted at scrollTop 0 — low on the bare background — then visibly slid
// ~400px into place, reading as "text renders, then the card pops in"
// (2026-07-23 staging report).
onMounted(() => { void nextTick(() => scrollCurrentIntoView('auto')) })

// Re-anchor (instantly, frame-by-frame) whenever the container resizes —
// e.g. PodTurnDisplay's reminder-band padding collapsing when the transient
// reminder fades. Without this the anchor was computed against the old
// height and the rows drifted upward, stranded until the next line change.
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !rootEl.value) return
  let first = true
  resizeObserver = new ResizeObserver(() => {
    // The observer fires once on observe() — skip it, mount already anchored.
    if (first) { first = false; return }
    scrollCurrentIntoView('auto')
  })
  resizeObserver.observe(rootEl.value)
})
onBeforeUnmount(() => { resizeObserver?.disconnect(); resizeObserver = null })

const handleRowClick = (displayIndex: number) => {
  if (props.interactive) emit('select', displayIndex)
}
</script>

<template>
  <div ref="rootEl" class="teleprompter">
    <div class="phrase-list" :style="{ paddingBlock: `${padBlockVh}vh` }">
      <div
        v-for="row in visibleLines"
        :key="row.line.id"
        class="phrase-row"
        :class="{
          current: row.isCurrent,
          past: row.isPast,
          future: !row.isCurrent && !row.isPast,
          interactive,
        }"
        @click.stop="handleRowClick(row.displayIndex)"
      >
        <slot name="line" :line="row.line" :is-current="row.isCurrent" :index="row.displayIndex">
          <div v-if="row.line.speakerName" class="phrase-speaker" :style="{ color: row.line.speakerColor }">
            <span class="phrase-speaker-dot" :style="{ background: row.line.speakerColor }"></span>{{ row.line.speakerName }}
          </div>
          <div :lang="targetLang" class="phrase-target" :dir="dirFor(row.line.target)">{{ row.line.target }}</div>
          <div :lang="knownLang" v-if="row.isCurrent && showGloss && row.line.known" class="phrase-known" :dir="dirFor(row.line.known)">{{ row.line.known }}</div>
        </slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.teleprompter {
  /* Positioned so it is its own offsetParent: scrollCurrentIntoView's
     offsetTop maths must be relative to THIS scroll container, not a padded
     positioned ancestor (see the anchoring comment in <script>). */
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.teleprompter::-webkit-scrollbar {
  display: none;
}

.phrase-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  max-width: 600px;
}

.phrase-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.75rem 1.5rem;
  border-radius: 12px;
  text-align: center;
  will-change: transform, opacity;
  transition:
    opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.4s ease;
}

.phrase-row.interactive {
  cursor: pointer;
}

.phrase-row.past {
  /* Legible-but-secondary (Tom 2026-07-22: was watermark-faint against the
     sketch background) — still clearly de-emphasised next to .current's 1. */
  opacity: 0.55;
  transform: scale(0.92) translateY(-2px);
}

.phrase-row.future {
  opacity: 0.75;
  transform: scale(0.96);
}

.phrase-row.current {
  opacity: 1;
  transform: scale(1.05);
  padding: 1rem 1.5rem;
  background: #ffffff;
  border: 1px solid var(--border-medium);
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
}

.phrase-row.interactive:hover:not(.current) {
  opacity: 0.8;
  background: var(--bg-card-hover);
}

/* Target text is a bidi run of its own: without isolation a trailing
   neutral (`!` `.` `,` — bidi class ON) resolves against this LTR page
   instead of the Arabic run and lands on the wrong side. `dir` is bound
   per-string in the template; this keeps the run from leaking. */
.phrase-target {
  unicode-bidi: isolate;
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--text-primary);
  text-align: center;
  line-height: 1.4;
  transition:
    font-size 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    font-weight 0.2s ease,
    color 0.3s ease,
    text-shadow 0.4s ease;
}

.phrase-row.current .phrase-target {
  font-size: clamp(1.75rem, 5vmin, 2.25rem);
  font-weight: 600;
  color: var(--text-primary);
}

.phrase-known {
  /* Known text is its own bidi run too: on eng_for_ara / eng_for_urd the
     KNOWN side is Arabic/Urdu, so it has the same trailing-neutral bug.
     dirFor returns 'ltr' for English, so English courses are unchanged. */
  unicode-bidi: isolate;

  font-size: 1rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
  font-style: italic;
}

.phrase-speaker {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin-bottom: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.phrase-speaker-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
