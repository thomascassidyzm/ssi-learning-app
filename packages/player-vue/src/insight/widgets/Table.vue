<script setup lang="ts">
// ============================================================================
// widgets/Table.vue — sortable HTML table widget
//
// Mirrors Stat.vue EXACTLY for structure:
//   · props { data: TableData, annotations: Annotation[] }
//   · emits NOTHING — the wrapper owns all events
//   · renders ONLY the table + annotation marks — the wrapper owns all chrome
//   · NO echarts (pure HTML table — no canvas import needed)
//   · ResizeObserver pattern not needed (DOM table reflows naturally)
//   · NO hardcoded hex — every colour comes from theme.ts (palette()/tone())
//   · frost-mono-nums on numeric cells
//
// Annotation shape used: { at: 'row', rowId, note, tone }
//   A highlighted row gets a left-border stripe in the annotation tone colour.
//   Other at-shapes are silently ignored (degrade, never throw).
//
// Format helpers:
//   'number'  → tabular-nums, 1 dp when fractional
//   'minutes' → floor(value/60) + 'm' (matching learner_speaking_opportunities convention)
//   'percent' → value + '%'
//   'text'    → raw string pass-through
// ============================================================================
import { ref, computed } from 'vue'
import type { TableData, Annotation } from '../spec'
import { tone } from '../theme'

const props = withDefaults(defineProps<{
  data: TableData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ---- sort state ----
const sortKey = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')

function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

// ---- resolved annotation map: rowId -> Annotation (row shape only) ----
const rowAnnotations = computed<Map<string, Annotation & { at: 'row' }>>(() => {
  const m = new Map<string, Annotation & { at: 'row' }>()
  for (const a of props.annotations) {
    if (a.at === 'row') m.set(a.rowId, a)
  }
  return m
})

// ---- sorted rows ----
const sortedRows = computed(() => {
  const rows = [...props.data.rows]
  if (!sortKey.value) return rows
  const key = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    const av = a.cells[key] ?? ''
    const bv = b.cells[key] ?? ''
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv)) * dir
  })
})

// ---- cell formatter ----
function formatCell(value: string | number, format?: 'number' | 'minutes' | 'percent' | 'text'): string {
  if (value === null || value === undefined || value === '') return '—'
  switch (format) {
    case 'number': {
      const n = Number(value)
      if (isNaN(n)) return String(value)
      return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)
    }
    case 'minutes': {
      const secs = Number(value)
      if (isNaN(secs)) return String(value)
      return `${Math.floor(secs / 60)}m`
    }
    case 'percent': {
      const p = Number(value)
      if (isNaN(p)) return String(value)
      return `${p}%`
    }
    case 'text':
    default:
      return String(value)
  }
}

// ---- is a column numeric (for frost-mono-nums class) ----
function isNumericFormat(format?: string): boolean {
  return format === 'number' || format === 'minutes' || format === 'percent'
}

// ---- sort indicator ----
function sortIndicator(key: string): string {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? ' ↑' : ' ↓'
}

// ---- row annotation highlight style ----
function rowStyle(rowId: string): Record<string, string> {
  const ann = rowAnnotations.value.get(rowId)
  if (!ann) return {}
  const c = tone(ann.tone)
  return {
    'border-left': `3px solid ${c}`,
    '--row-ann-bg': hexWithAlpha(c, 0.06),
  }
}

// Build an rgba() wash from a resolved colour string (hex or rgb/rgba).
// Used only for the annotated-row background tint.
function hexWithAlpha(color: string, alpha: number): string {
  // If already rgb/rgba, convert to rgba with our alpha
  const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
  if (rgbMatch) return `rgba(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]},${alpha})`
  // Hex: 6-digit (#rrggbb)
  const hex = color.replace('#', '')
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  // Fallback — neutral wash via token (no hardcoded literal)
  return `color-mix(in srgb, var(--ink-primary) ${Math.round(alpha * 100)}%, transparent)`
}

// expose tone for template bindings
const _tone = tone
</script>

<template>
  <div class="table-widget">
    <div v-if="data.rows.length === 0" class="table-empty">
      No rows to display.
    </div>
    <div v-else class="table-scroll">
      <table class="dt">
        <thead>
          <tr>
            <th
              v-for="col in data.columns"
              :key="col.key"
              class="dt-th"
              :class="{
                'is-right': col.align === 'right',
                'is-active': sortKey === col.key,
              }"
              @click="toggleSort(col.key)"
            >
              <span class="dt-th-label">{{ col.label }}{{ sortIndicator(col.key) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sortedRows"
            :key="row.id"
            class="dt-tr"
            :class="{ 'is-annotated': rowAnnotations.has(row.id), [`tone-${row.tone ?? 'neutral'}`]: true }"
            :style="rowStyle(row.id)"
          >
            <td
              v-for="col in data.columns"
              :key="col.key"
              class="dt-td"
              :class="{
                'is-right': col.align === 'right',
                'frost-mono-nums': isNumericFormat(col.format),
              }"
            >
              {{ formatCell(row.cells[col.key], col.format) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- annotation tone chips: one per annotated row (note text) -->
    <ul v-if="rowAnnotations.size" class="ann-list">
      <li
        v-for="[rowId, ann] in rowAnnotations"
        :key="rowId"
        class="ann-item"
        :style="{ color: _tone(ann.tone) }"
      >
        <span class="ann-dot" :style="{ background: _tone(ann.tone) }" />
        {{ ann.note }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.table-widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  font-family: var(--font-mono);
}

/* ---- empty state ---- */
.table-empty {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-muted);
  padding: 32px 0;
  text-align: center;
}

/* ---- scroll container (clips horizontally on narrow admin panes) ---- */
.table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid color-mix(in srgb, var(--ink-primary) 10%, transparent);
  border-radius: 10px;
}

/* ---- the table itself ---- */
.dt {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  color: var(--ink-secondary);
}

/* ---- header ---- */
.dt-th {
  padding: 10px 14px;
  text-align: left;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--ink-muted);
  border-bottom: 1px solid color-mix(in srgb, var(--ink-primary) 10%, transparent);
  background: color-mix(in srgb, var(--ink-primary) 3%, transparent);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s;
}
.dt-th:hover {
  color: var(--ink-secondary);
}
.dt-th.is-active {
  color: var(--ink-primary);
}
.dt-th.is-right {
  text-align: right;
}
.dt-th-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

/* ---- rows ---- */
.dt-tr {
  border-bottom: 1px solid color-mix(in srgb, var(--ink-primary) 7%, transparent);
  transition: background 0.12s;
}
.dt-tr:last-child {
  border-bottom: none;
}
.dt-tr:hover {
  background: color-mix(in srgb, var(--ink-primary) 3%, transparent);
}

/* annotated row: left border + bg wash both set inline via rowStyle() */
.dt-tr.is-annotated {
  background: var(--row-ann-bg, color-mix(in srgb, var(--ink-primary) 5%, transparent));
}

/* per-row tone rows (from row.tone field, non-annotated colouring) */
.dt-tr.tone-good   { color: rgba(var(--tone-green), 1); }
.dt-tr.tone-warn   { color: rgba(var(--tone-gold), 1); }
.dt-tr.tone-alarm  { color: rgba(var(--tone-red), 1); }
.dt-tr.tone-neutral { color: var(--ink-secondary); }

/* ---- cells ---- */
.dt-td {
  padding: 10px 14px;
  color: var(--ink-secondary);
  white-space: nowrap;
}
.dt-td.is-right {
  text-align: right;
}
/* frost-mono-nums: tabular-nums for numbers/minutes/percent */
.dt-td.frost-mono-nums {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ink-primary);
  font-weight: 500;
}

/* ---- annotation note chips below the table ---- */
.ann-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ann-item {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.4;
}
.ann-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}

/* desktop-first; on narrow screens allow the scroll container to do the work */
@media (max-width: 640px) {
  .dt-th,
  .dt-td {
    padding: 8px 10px;
  }
  .dt {
    font-size: 12px;
  }
}
</style>
