<script setup lang="ts">
// ============================================================================
// widgets/NarrativeCard.vue — the .disc discover card
//
// Pure HTML (no ECharts). Mirrors the gallery's .disc block exactly:
//   · moved kicker (signal line from data.moved)
//   · optional metric pill (data.metricLabel + data.metricValue)
//   · annotation highlights (at:'datum' marks surfaced as coloured chips)
//
// What this widget does NOT render (the InsightWidget wrapper owns it):
//   · title / why? button / frame tag     → .fig-head
//   · spec.story                          → .read
//   · spec.actions                        → .fig-actions footer
//   · annotation note captions            → .read-note
//
// Props: { data: NarrativeCardData, annotations?: Annotation[] }
// Emits: nothing — the wrapper owns all events.
//
// Frostwell tokens only. NO hardcoded hex/rgba.
// Desktop-first. Handles empty/zero data without throwing.
// ============================================================================
import { computed } from 'vue'
import type { NarrativeCardData, Annotation } from '../spec'
import { tone, toneRgb } from '../theme'

const props = withDefaults(defineProps<{
  data: NarrativeCardData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// Datum annotations (key → note + tone) — rendered as coloured chips inside the disc body.
// A band annotation on a narrative card is a threshold mark; rendered as a rule below the metric.
const datumAnnotations = computed<Array<Annotation & { at: 'datum' }>>(() =>
  (props.annotations ?? []).filter((a): a is Annotation & { at: 'datum' } => a.at === 'datum'),
)

const bandAnnotations = computed<Array<Annotation & { at: 'band' }>>(() =>
  (props.annotations ?? []).filter((a): a is Annotation & { at: 'band' } => a.at === 'band'),
)

const hasMetric = computed(() => !!props.data.metricLabel && props.data.metricValue != null)

function annotationColor(t: Annotation['tone']) { return tone(t) }
function annotationRgb(t: Annotation['tone']) { return toneRgb(t) }
</script>

<template>
  <div class="disc">
    <!-- kicker: the "▲ moved this week · by acceleration" signal line -->
    <span class="disc-moved">{{ data.moved }}</span>

    <!-- story headline — the primary finding, gallery .disc .story (Arsenal bold 23px) -->
    <p v-if="data.headline" class="disc-story">{{ data.headline }}</p>

    <!-- optional metric pill — sits between the kicker and the story prose -->
    <div v-if="hasMetric" class="disc-metric">
      <span class="disc-metric-value">{{ data.metricValue }}</span>
      <span class="disc-metric-label">{{ data.metricLabel }}</span>
    </div>

    <!-- band annotations: threshold marks rendered as a hairline with a note label -->
    <div v-if="bandAnnotations.length" class="disc-bands">
      <div
        v-for="(a, i) in bandAnnotations"
        :key="i"
        class="disc-band"
        :style="{ borderColor: annotationColor(a.tone) }"
      >
        <span
          class="disc-band-note"
          :style="{ color: annotationColor(a.tone) }"
        >{{ a.note }}</span>
      </div>
    </div>

    <!-- datum annotation chips: coloured marks Claude flagged as the story -->
    <div v-if="datumAnnotations.length" class="disc-chips">
      <span
        v-for="(a, i) in datumAnnotations"
        :key="i"
        class="disc-chip"
        :style="{
          background: `rgba(${annotationRgb(a.tone)}, 0.13)`,
          borderColor: `rgba(${annotationRgb(a.tone)}, 0.38)`,
          color: annotationColor(a.tone),
        }"
        :title="a.note"
      >{{ a.key }}</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * .disc — ports the gallery block near-verbatim.
 * Frostwell tokens only. No hex literals.
 */
.disc {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* The wrapper's .fig-body supplies 18px 22px padding; we add our own vertical rhythm. */
  padding: 4px 0 6px;
}

/* kicker: gallery .disc .moved */
.disc-moved {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
  display: block;
}

/* story headline — gallery .disc .story; the primary finding */
.disc-story {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 23px;
  line-height: 1.22;
  color: var(--ink-primary);
  margin: 4px 0 2px;
}

/* optional metric pill */
.disc-metric {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 14px;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  align-self: flex-start;
  margin-top: 2px;
}
.disc-metric-value {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1;
  color: var(--ink-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.disc-metric-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

/* band threshold marks */
.disc-bands {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}
.disc-band {
  border-left: 2px solid;
  padding-left: 10px;
}
.disc-band-note {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.4;
}

/* datum annotation chips */
.disc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.disc-chip {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 3px 10px;
  border: 1px solid;
  border-radius: 999px;
  white-space: nowrap;
  cursor: default;
}
</style>
