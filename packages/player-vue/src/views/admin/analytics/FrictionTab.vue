<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsFriction } from '@/composables/admin/useAnalyticsFriction'
import { useAdminCourses } from '@/composables/admin/useAdminCourses'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import FilterDropdown from '@/components/schools/shared/FilterDropdown.vue'
import BarChart from '@/components/admin/charts/BarChart.vue'
import { parseCourseCode, getBeltForSeeds } from '@/composables/admin/adminUtils'
import { BELTS } from '@/composables/useBeltProgress'

const { getClient } = useAdminClient()
const client = getClient()

const friction = useAnalyticsFriction(client)
const coursesComposable = useAdminCourses(client)

const selectedCourse = ref<string | number | null>(null)

const courseOptions = computed(() =>
  coursesComposable.courses.value.map(c => ({
    value: c.course_code,
    label: parseCourseCode(c.course_code).label,
  }))
)

// Top 3 friction points
const topFriction = computed(() =>
  [...friction.data.value]
    .sort((a, b) => b.stopped_here_count - a.stopped_here_count)
    .slice(0, 3)
)

// Histogram data
const histogramData = computed(() =>
  friction.data.value.map(fp => ({
    seed: String(fp.seed_number),
    count: fp.stopped_here_count,
    belt: getBeltForSeeds(fp.seed_number).name,
  }))
)

// Belt abandonment rates
const beltAbandonment = computed(() => {
  if (friction.data.value.length === 0) return []

  const results: Array<{ belt: string; color: string; rate: number }> = []

  for (let i = 0; i < BELTS.length - 1; i++) {
    const currentBelt = BELTS[i]
    const nextBelt = BELTS[i + 1]

    const stoppedInBelt = friction.data.value
      .filter(fp =>
        fp.seed_number >= currentBelt.seedsRequired &&
        fp.seed_number < nextBelt.seedsRequired
      )
      .reduce((sum, fp) => sum + fp.stopped_here_count, 0)

    const reachedThisBelt = friction.data.value
      .filter(fp => fp.seed_number >= currentBelt.seedsRequired)
      .reduce((sum, fp) => sum + fp.stopped_here_count, 0)

    if (reachedThisBelt > 0) {
      results.push({
        belt: currentBelt.name,
        color: currentBelt.color,
        rate: Math.round((stoppedInBelt / reachedThisBelt) * 100),
      })
    }
  }

  return results
})

function onCourseChange(v: string | number | null) {
  selectedCourse.value = v
  if (v) friction.fetch(String(v))
}

onMounted(async () => {
  await coursesComposable.fetchCourses()
  if (coursesComposable.courses.value.length > 0 && !selectedCourse.value) {
    const first = coursesComposable.courses.value[0].course_code
    selectedCourse.value = first
    friction.fetch(first)
  }
})

watch(selectedCourse, (v) => {
  if (v) friction.fetch(String(v))
})
</script>

<template>
  <div class="tab-content">
    <!-- Filters bar — canon §5.2 -->
    <div class="filters-bar">
      <span class="frost-eyebrow">Course</span>
      <FilterDropdown
        :model-value="selectedCourse"
        :options="courseOptions"
        placeholder="Select a course…"
        size="md"
        :disabled="coursesComposable.isLoading.value"
        @update:model-value="onCourseChange"
      />
    </div>

    <!-- Status -->
    <div v-if="friction.isLoading.value" class="loading">Loading friction data…</div>
    <div v-if="friction.error.value" class="error-banner">{{ friction.error.value }}</div>

    <template v-if="selectedCourse && !friction.isLoading.value && friction.data.value.length > 0">
      <!-- Top friction points -->
      <FrostCard variant="panel" class="chart-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">Top friction points · seeds where most stop</span>
        </div>
        <div class="panel-body">
          <div class="friction-list">
            <div
              v-for="(fp, i) in topFriction"
              :key="fp.seed_number"
              class="friction-row"
            >
              <div class="friction-rank frost-mono-nums">#{{ i + 1 }}</div>
              <div class="friction-detail">
                <div class="friction-seed">
                  <span class="seed-label">Seed <span class="frost-mono-nums">{{ fp.seed_number }}</span></span>
                  <span
                    class="friction-belt-dot"
                    :style="{ background: getBeltForSeeds(fp.seed_number).color }"
                  ></span>
                  <span class="friction-belt-name">{{ getBeltForSeeds(fp.seed_number).name }} belt</span>
                </div>
                <div class="friction-stats">
                  <span class="friction-count frost-mono-nums">{{ fp.stopped_here_count }} learners stopped</span>
                  <span class="friction-spike frost-mono-nums">{{ (fp.spike_rate * 100).toFixed(1) }}% spike</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </FrostCard>

      <!-- Drop-off histogram -->
      <FrostCard variant="panel" class="chart-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">Drop-off histogram · highest completed seed</span>
        </div>
        <div class="panel-body">
          <BarChart
            :data="histogramData"
            x-key="seed"
            y-key="count"
            color="rgb(var(--tone-red))"
            :height="280"
            :format-x="(v: any) => `S${v}`"
            :format-y="(v: number) => String(v)"
          />
        </div>
      </FrostCard>

      <!-- Belt abandonment -->
      <FrostCard variant="panel" class="chart-panel">
        <div class="panel-head">
          <span class="frost-eyebrow">Belt abandonment · % stuck at a belt</span>
        </div>
        <div class="panel-body">
          <div v-if="beltAbandonment.length === 0" class="empty-inline">
            Not enough data to compute belt abandonment.
          </div>
          <div v-else class="abandonment-list">
            <div
              v-for="ba in beltAbandonment"
              :key="ba.belt"
              class="abandonment-row"
            >
              <div class="abandonment-belt">
                <span class="abandonment-dot" :style="{ background: ba.color }"></span>
                <span class="abandonment-name">{{ ba.belt }}</span>
              </div>
              <div class="abandonment-bar-track">
                <div
                  class="abandonment-bar-fill"
                  :style="{ width: `${ba.rate}%` }"
                ></div>
              </div>
              <div class="abandonment-value frost-mono-nums">{{ ba.rate }}%</div>
            </div>
          </div>
        </div>
      </FrostCard>
    </template>

    <!-- Empty state — canon §5.5 -->
    <FrostCard
      v-if="selectedCourse && !friction.isLoading.value && friction.data.value.length === 0"
      variant="tile"
      class="empty"
    >
      <div class="empty-ghost">friction</div>
      <div class="empty-copy">
        <strong>No friction data yet</strong>
        <p>Once learners practise this course, drop-off points will surface here.</p>
      </div>
    </FrostCard>
  </div>
</template>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Filters bar */
.filters-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

/* Panels */
.chart-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.panel-body {
  padding: var(--space-5) var(--space-6);
}

/* Friction rows */
.friction-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.friction-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.45);
  border-radius: var(--radius-lg);
  transition: background var(--transition-fast);
}

.friction-row:hover {
  background: rgba(255, 255, 255, 0.72);
}

.friction-rank {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: rgb(var(--tone-red));
  min-width: 36px;
}

.friction-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.friction-seed {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--ink-primary);
}

.seed-label {
  letter-spacing: -0.01em;
}

.friction-belt-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.friction-belt-name {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--ink-muted);
  font-weight: var(--font-medium);
}

.friction-stats {
  display: flex;
  gap: var(--space-4);
}

.friction-count {
  font-size: var(--text-sm);
  color: var(--ink-secondary);
}

.friction-spike {
  font-size: var(--text-sm);
  color: rgb(var(--tone-red));
  font-weight: var(--font-medium);
}

/* Belt abandonment */
.abandonment-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.abandonment-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.abandonment-belt {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 110px;
  flex-shrink: 0;
}

.abandonment-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.abandonment-name {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--ink-primary);
  text-transform: capitalize;
}

.abandonment-bar-track {
  flex: 1;
  height: 18px;
  background: rgba(44, 38, 34, 0.05);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.abandonment-bar-fill {
  height: 100%;
  background: rgb(var(--tone-red));
  border-radius: var(--radius-md);
  transition: width 0.4s ease;
  min-width: 2px;
}

.abandonment-value {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--ink-primary);
}

/* Status */
.loading {
  text-align: center;
  padding: var(--space-12);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.error-banner {
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.25);
  border-radius: var(--radius-lg);
  color: rgb(var(--tone-red));
  font-size: var(--text-sm);
}

.empty-inline {
  text-align: center;
  padding: var(--space-6) var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Empty state — canon §5.5 */
.empty {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-6);
  align-items: center;
  padding: var(--space-10) var(--space-8);
  min-height: 180px;
}

.empty-ghost {
  font-family: var(--font-display);
  font-size: 88px;
  font-weight: var(--font-bold);
  letter-spacing: -0.03em;
  color: var(--ink-faint);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--ink-primary);
  margin-bottom: 4px;
}

.empty-copy p {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}
</style>
