<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsFriction } from '@/composables/admin/useAnalyticsFriction'
import { useAdminCourses } from '@/composables/admin/useAdminCourses'
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
    <!-- Filters bar -->
    <div class="filters-bar">
      <span class="schools-kicker">Course</span>
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
    <div v-if="friction.isLoading.value" class="loading schools-subtle">Loading friction data…</div>
    <div v-if="friction.error.value" class="error-banner">{{ friction.error.value }}</div>

    <template v-if="selectedCourse && !friction.isLoading.value && friction.data.value.length > 0">
      <!-- Top friction points -->
      <div class="schools-card chart-panel">
        <div class="panel-head">
          <span class="schools-kicker">Top friction points · seeds where most stop</span>
        </div>
        <div class="panel-body">
          <div class="friction-list">
            <div
              v-for="(fp, i) in topFriction"
              :key="fp.seed_number"
              class="friction-row"
            >
              <div class="friction-rank">#{{ i + 1 }}</div>
              <div class="friction-detail">
                <div class="friction-seed">
                  <span class="seed-label">Seed {{ fp.seed_number }}</span>
                  <span
                    class="friction-belt-dot"
                    :style="{ background: getBeltForSeeds(fp.seed_number).color }"
                  ></span>
                  <span class="friction-belt-name">{{ getBeltForSeeds(fp.seed_number).name }} belt</span>
                </div>
                <div class="friction-stats">
                  <span class="friction-count">{{ fp.stopped_here_count }} learners stopped</span>
                  <span class="friction-spike">{{ (fp.spike_rate * 100).toFixed(1) }}% spike</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Drop-off histogram -->
      <div class="schools-card chart-panel">
        <div class="panel-head">
          <span class="schools-kicker">Drop-off histogram · highest completed seed</span>
        </div>
        <div class="panel-body">
          <BarChart
            :data="histogramData"
            x-key="seed"
            y-key="count"
            color="var(--schools-red)"
            :height="280"
            :format-x="(v: any) => `S${v}`"
            :format-y="(v: number) => String(v)"
          />
        </div>
      </div>

      <!-- Belt abandonment -->
      <div class="schools-card chart-panel">
        <div class="panel-head">
          <span class="schools-kicker">Belt abandonment · % stuck at a belt</span>
        </div>
        <div class="panel-body">
          <div v-if="beltAbandonment.length === 0" class="empty-inline schools-subtle">
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
              <div class="abandonment-value">{{ ba.rate }}%</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Empty state -->
    <div
      v-if="selectedCourse && !friction.isLoading.value && friction.data.value.length === 0"
      class="schools-card schools-card-pad empty"
    >
      <div class="empty-ghost arsenal">friction</div>
      <div class="empty-copy">
        <strong class="arsenal">No friction data yet</strong>
        <p class="schools-subtle">Once learners practise this course, drop-off points will surface here.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Filters bar */
.filters-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* Panels */
.chart-panel { padding: 0; overflow: hidden; }

.panel-head {
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--schools-border);
}

.panel-body { padding: 16px 20px 20px; }

/* Friction rows */
.friction-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.friction-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 16px;
  background: #fafaf8;
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-md);
  transition: background 160ms ease-out;
}

.friction-row:hover { background: #fff; }

.friction-rank {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 400;
  color: var(--schools-red);
  min-width: 34px;
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
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--schools-fg);
}

.seed-label { letter-spacing: -0.005em; }

.friction-belt-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.friction-belt-name {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
}

.friction-stats {
  display: flex;
  gap: 16px;
}

.friction-count {
  font-size: 13px;
  color: var(--schools-fg-2);
}

.friction-spike {
  font-size: 13px;
  color: var(--schools-red);
  font-weight: 600;
}

/* Belt abandonment */
.abandonment-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.abandonment-row {
  display: flex;
  align-items: center;
  gap: 12px;
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
  font-size: 13.5px;
  font-weight: 500;
  color: var(--schools-fg);
  text-transform: capitalize;
}

.abandonment-bar-track {
  flex: 1;
  height: 18px;
  background: #f3f1ec;
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-md);
  overflow: hidden;
}

.abandonment-bar-fill {
  height: 100%;
  background: var(--schools-red);
  border-radius: var(--schools-radius-md);
  transition: width 0.4s ease;
  min-width: 2px;
}

.abandonment-value {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--schools-fg);
}

/* Status */
.loading {
  text-align: center;
  padding: 40px 20px;
  font-size: 13px;
}

.error-banner {
  padding: 10px 14px;
  background: rgba(219, 30, 23, 0.06);
  border: 1px solid rgba(219, 30, 23, 0.25);
  border-radius: var(--schools-radius-md);
  color: var(--schools-red-deep);
  font-size: 13px;
}

.empty-inline {
  text-align: center;
  padding: 22px 16px;
  font-size: 13px;
}

/* Empty state */
.empty {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 24px;
  align-items: center;
  padding: 36px 32px;
  min-height: 180px;
}

.empty-ghost {
  font-size: 88px;
  letter-spacing: -0.03em;
  color: var(--schools-fg-3);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-size: 18px;
  color: var(--schools-fg);
  margin-bottom: 4px;
  font-weight: 400;
}

.empty-copy p {
  margin: 0;
  font-size: 13px;
}
</style>
