<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAnalyticsFriction } from '@/composables/admin/useAnalyticsFriction'
import { useAdminCourses } from '@/composables/admin/useAdminCourses'
import Card from '@/components/schools/shared/Card.vue'
import BarChart from '@/components/admin/charts/BarChart.vue'
import { parseCourseCode, getBeltForSeeds } from '@/composables/admin/adminUtils'
import { BELTS } from '@/composables/useBeltProgress'

const { getClient } = useAdminClient()
const client = getClient()

const friction = useAnalyticsFriction(client)
const coursesComposable = useAdminCourses(client)

const selectedCourse = ref<string>('')

// Top 3 friction points
const topFriction = computed(() =>
  [...friction.data.value]
    .sort((a, b) => b.stopped_here_count - a.stopped_here_count)
    .slice(0, 3)
)

// Chart data: group by belt bands
const histogramData = computed(() =>
  friction.data.value.map(fp => ({
    seed: String(fp.seed_number),
    count: fp.stopped_here_count,
    belt: getBeltForSeeds(fp.seed_number).name,
  }))
)

// Belt abandonment rates: % who reach belt N but never reach N+1
const beltAbandonment = computed(() => {
  if (friction.data.value.length === 0) return []

  const results: Array<{ belt: string; color: string; rate: number }> = []

  for (let i = 0; i < BELTS.length - 1; i++) {
    const currentBelt = BELTS[i]
    const nextBelt = BELTS[i + 1]

    // Count learners who stopped in this belt range
    const stoppedInBelt = friction.data.value
      .filter(fp =>
        fp.seed_number >= currentBelt.seedsRequired &&
        fp.seed_number < nextBelt.seedsRequired
      )
      .reduce((sum, fp) => sum + fp.stopped_here_count, 0)

    // Count learners who reached this belt (stopped here + stopped later)
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

function formatCourseLabel(code: string): string {
  return parseCourseCode(code).label
}

function onCourseChange() {
  if (selectedCourse.value) {
    friction.fetch(selectedCourse.value)
  }
}

onMounted(async () => {
  await coursesComposable.fetchCourses()
  // Auto-select first course
  if (coursesComposable.courses.value.length > 0 && !selectedCourse.value) {
    selectedCourse.value = coursesComposable.courses.value[0].course_code
    friction.fetch(selectedCourse.value)
  }
})

watch(selectedCourse, onCourseChange)
</script>

<template>
  <div class="tab-content">
    <!-- Course Selector -->
    <div class="course-selector animate-in delay-1">
      <label class="selector-label">Course</label>
      <select
        v-model="selectedCourse"
        class="selector-dropdown"
        :disabled="coursesComposable.isLoading.value"
      >
        <option value="" disabled>Select a course...</option>
        <option
          v-for="course in coursesComposable.courses.value"
          :key="course.course_code"
          :value="course.course_code"
        >
          {{ formatCourseLabel(course.course_code) }}
        </option>
      </select>
    </div>

    <!-- Loading -->
    <div v-if="friction.isLoading.value" class="loading-state animate-in">
      Loading friction data...
    </div>
    <div v-if="friction.error.value" class="alert-error animate-in">
      {{ friction.error.value }}
    </div>

    <template v-if="selectedCourse && !friction.isLoading.value && friction.data.value.length > 0">
      <!-- Top 3 Friction Points -->
      <Card
        title="Top Friction Points"
        subtitle="Seeds where the most learners stop"
        accent="red"
        class="animate-in delay-2"
      >
        <div class="friction-highlights">
          <div
            v-for="(fp, i) in topFriction"
            :key="fp.seed_number"
            class="friction-highlight"
          >
            <div class="friction-rank">#{{ i + 1 }}</div>
            <div class="friction-detail">
              <div class="friction-seed">
                Seed {{ fp.seed_number }}
                <span
                  class="friction-belt-dot"
                  :style="{ background: getBeltForSeeds(fp.seed_number).color }"
                ></span>
                <span class="friction-belt-name">{{ getBeltForSeeds(fp.seed_number).name }} belt</span>
              </div>
              <div class="friction-stats">
                <span class="friction-count">{{ fp.stopped_here_count }} learners stopped</span>
                <span class="friction-spike">{{ (fp.spike_rate * 100).toFixed(1) }}% spike rate</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <!-- Histogram -->
      <Card
        title="Drop-off Histogram"
        subtitle="Learners whose highest completed seed is each seed number"
        accent="gradient"
        class="animate-in delay-3"
      >
        <BarChart
          :data="histogramData"
          x-key="seed"
          y-key="count"
          color="var(--ssi-red, #c23a3a)"
          :height="280"
          :format-x="(v: any) => `S${v}`"
          :format-y="(v: number) => String(v)"
        />
      </Card>

      <!-- Belt Abandonment Rates -->
      <Card
        title="Belt Abandonment Rates"
        subtitle="% of learners who reach a belt but never advance to the next"
        accent="gold"
        class="animate-in delay-4"
      >
        <div v-if="beltAbandonment.length === 0" class="empty-state">
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
      </Card>
    </template>

    <!-- No data state -->
    <div
      v-if="selectedCourse && !friction.isLoading.value && friction.data.value.length === 0"
      class="empty-state animate-in delay-2"
    >
      No friction data available for this course yet.
    </div>
  </div>
</template>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 24px);
}

/* Course Selector */
.course-selector {
  display: flex;
  align-items: center;
  gap: var(--space-3, 12px);
}

.selector-label {
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-semibold, 600);
  color: var(--text-secondary);
}

.selector-dropdown {
  flex: 1;
  max-width: 360px;
  padding: var(--space-2, 8px) var(--space-3, 12px);
  background: var(--bg-card);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md, 8px);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-sm, 0.875rem);
  cursor: pointer;
  transition: border-color var(--transition-base, 0.15s);
}

.selector-dropdown:focus {
  outline: none;
  border-color: var(--info, #3b82f6);
}

.selector-dropdown option {
  background: var(--bg-card);
  color: var(--text-primary);
}

/* Loading / Error / Empty */
.loading-state {
  text-align: center;
  padding: var(--space-10, 40px) var(--space-5, 20px);
  color: var(--text-secondary);
  font-size: var(--text-sm, 0.875rem);
}

.alert-error {
  padding: var(--space-3, 12px) var(--space-4, 16px);
  border-radius: var(--radius-lg, 12px);
  font-size: var(--text-sm, 0.875rem);
  background: var(--bg-card);
  border: 1px solid var(--ssi-red);
  color: var(--ssi-red-light, #ff8080);
}

.empty-state {
  text-align: center;
  padding: var(--space-8, 32px) var(--space-5, 20px);
  color: var(--text-muted);
  font-size: var(--text-sm, 0.875rem);
}

/* Top Friction Points */
.friction-highlights {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}

.friction-highlight {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4, 16px);
  padding: var(--space-3, 12px) var(--space-4, 16px);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--border-subtle);
}

.friction-rank {
  font-size: var(--text-xl, 1.25rem);
  font-weight: var(--font-bold, 700);
  color: var(--ssi-red);
  min-width: 36px;
}

.friction-detail {
  flex: 1;
}

.friction-seed {
  font-size: var(--text-base, 1rem);
  font-weight: var(--font-semibold, 600);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-2, 6px);
}

.friction-belt-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.friction-belt-name {
  font-size: var(--text-xs, 0.75rem);
  font-weight: var(--font-medium, 500);
  color: var(--text-muted);
  text-transform: capitalize;
}

.friction-stats {
  display: flex;
  gap: var(--space-4, 16px);
  margin-top: var(--space-1, 4px);
}

.friction-count {
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-secondary);
}

.friction-spike {
  font-size: var(--text-sm, 0.875rem);
  color: var(--ssi-red-light, #ff8080);
  font-weight: var(--font-medium, 500);
}

/* Belt Abandonment */
.abandonment-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}

.abandonment-row {
  display: flex;
  align-items: center;
  gap: var(--space-3, 12px);
}

.abandonment-belt {
  display: flex;
  align-items: center;
  gap: var(--space-2, 6px);
  width: 100px;
  flex-shrink: 0;
}

.abandonment-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.abandonment-name {
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-medium, 500);
  color: var(--text-primary);
  text-transform: capitalize;
}

.abandonment-bar-track {
  flex: 1;
  height: 20px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}

.abandonment-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ssi-red), var(--ssi-red-light, #ff8080));
  border-radius: var(--radius-md, 6px);
  transition: width 0.4s ease;
  min-width: 2px;
}

.abandonment-value {
  width: 48px;
  flex-shrink: 0;
  text-align: right;
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-semibold, 600);
  color: var(--text-primary);
}
</style>
