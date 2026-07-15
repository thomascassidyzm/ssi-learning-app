<script setup lang="ts">
// Renders one InlineSegment[] run (renderBoardMarkdown.ts) — shared by
// headings, paragraphs and list items in BoardReportView / BoardSnapshotView
// so bold/metric/unknown handling lives in exactly one place.
import type { InlineSegment } from '@/utils/renderBoardMarkdown'
import { formatMetricValue } from '@/utils/boardTokens'

defineProps<{ segments: InlineSegment[] }>()

function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function metricTitle(seg: Extract<InlineSegment, { type: 'metric' }>): string {
  return `${seg.metric.method} — as of ${formatAsOf(seg.metric.asOf)}`
}
</script>

<template>
  <template v-for="(seg, i) in segments" :key="i">
    <component :is="seg.bold ? 'strong' : 'span'">
      <span v-if="seg.type === 'text'">{{ seg.text }}</span>
      <span v-else-if="seg.type === 'metric'" class="metric-value" :title="metricTitle(seg)">{{ formatMetricValue(seg.metric) }}</span>
      <span v-else class="metric-unknown">⚠ unresolved: {{ seg.slug }}</span>
    </component>
  </template>
</template>

<style scoped>
.metric-value {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  color: rgb(var(--tone-red, 194, 58, 58));
  cursor: help;
  border-bottom: 1px dashed rgba(var(--tone-red, 194, 58, 58), 0.4);
}
.metric-unknown {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  color: #fff;
  background: rgb(var(--tone-red, 194, 58, 58));
  padding: 1px 6px;
  border-radius: 4px;
}
</style>
