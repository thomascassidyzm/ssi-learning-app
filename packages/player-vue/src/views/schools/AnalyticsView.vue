<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useGodMode } from '@/composables/schools/useGodMode'
import { useClassesData } from '@/composables/schools/useClassesData'
import { getSchoolsClient } from '@/composables/schools/client'

type TimePeriod = '7d' | '30d' | 'all'

const { selectedUser } = useGodMode()
const { classes: classesData, fetchClasses } = useClassesData()

const selectedPeriod = ref<TimePeriod>('30d')
const classSessions = ref<any[]>([])
const isLoading = ref(false)
const isVisible = ref(false)

// Course code → target language name
const languageNames: Record<string, string> = {
  'cym_for_eng': 'Welsh', 'cym_n_for_eng': 'Welsh', 'cym_s_for_eng': 'Welsh',
  'spa_for_eng': 'Spanish', 'fra_for_eng': 'French', 'deu_for_eng': 'German',
  'nld_for_eng': 'Dutch', 'gle_for_eng': 'Irish', 'jpn_for_eng': 'Japanese',
  'ara_for_eng': 'Arabic', 'kor_for_eng': 'Korean', 'ita_for_eng': 'Italian',
  'por_for_eng': 'Portuguese', 'eng_for_spa': 'English', 'zho_for_eng': 'Chinese',
  'cmn_for_eng': 'Chinese', 'gla_for_eng': 'Scottish Gaelic', 'cor_for_eng': 'Cornish',
  'glv_for_eng': 'Manx', 'eus_for_spa': 'Basque', 'cat_for_spa': 'Catalan',
  'bre_for_fre': 'Breton', 'rus_for_eng': 'Russian', 'pol_for_eng': 'Polish',
}

// Belt thresholds (same as useBeltProgress)
const BELTS = [
  { name: 'White', seedsRequired: 0, color: '#e0e0e0' },
  { name: 'Yellow', seedsRequired: 8, color: '#fbbf24' },
  { name: 'Orange', seedsRequired: 20, color: '#f97316' },
  { name: 'Green', seedsRequired: 40, color: '#22c55e' },
  { name: 'Blue', seedsRequired: 60, color: '#3b82f6' },
  { name: 'Purple', seedsRequired: 150, color: '#8b5cf6' },
  { name: 'Brown', seedsRequired: 280, color: '#92400e' },
  { name: 'Black', seedsRequired: 400, color: '#1f2937' },
]

function getBeltForSeed(seed: number) {
  let belt = BELTS[0]
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seed >= BELTS[i].seedsRequired) {
      belt = BELTS[i]
      break
    }
  }
  const beltIndex = BELTS.indexOf(belt)
  const nextBelt = beltIndex + 1 < BELTS.length ? BELTS[beltIndex + 1] : null
  const sectionsInBelt = nextBelt
    ? nextBelt.seedsRequired - belt.seedsRequired
    : 300 - belt.seedsRequired // fallback for highest belt
  const sectionsComplete = seed - belt.seedsRequired
  return {
    name: belt.name,
    color: belt.color,
    sectionsComplete,
    sectionsInBelt,
  }
}

// Date filter boundary
const periodStart = computed(() => {
  if (selectedPeriod.value === 'all') return null
  const d = new Date()
  if (selectedPeriod.value === '7d') d.setDate(d.getDate() - 7)
  else if (selectedPeriod.value === '30d') d.setDate(d.getDate() - 30)
  return d.toISOString()
})

// Fetch class sessions from DB
async function fetchClassSessions() {
  const classIds = classesData.value.map(c => c.id)
  if (classIds.length === 0) {
    classSessions.value = []
    return
  }
  const client = getSchoolsClient()
  let query = client
    .from('class_sessions')
    .select('id, class_id, cycles_completed, duration_seconds, started_at, start_lego_id, end_lego_id')
    .in('class_id', classIds)
    .order('started_at', { ascending: false })

  if (periodStart.value) {
    query = query.gte('started_at', periodStart.value)
  }

  const { data, error } = await query
  if (error) {
    console.warn('[Analytics] Failed to fetch class sessions:', error.message)
    classSessions.value = []
    return
  }
  classSessions.value = data || []
}

// Aggregate volume stats across all classes
const totalSpeakingOpportunities = computed(() =>
  classSessions.value.reduce((sum, s) => sum + (s.cycles_completed || 0), 0)
)

const totalMinutes = computed(() =>
  Math.round(classSessions.value.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60)
)

// Per-class stats
const classStats = computed(() => {
  return classesData.value.map(cls => {
    const sessions = classSessions.value.filter(s => s.class_id === cls.id)
    const cycles = sessions.reduce((sum, s) => sum + (s.cycles_completed || 0), 0)
    const minutes = Math.round(sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60)
    const sessionCount = sessions.length
    const language = languageNames[cls.course_code] || cls.course_code
    const belt = getBeltForSeed(cls.current_seed || 0)

    return {
      id: cls.id,
      name: cls.class_name,
      courseCode: cls.course_code,
      language,
      cycles,
      minutes,
      sessionCount,
      currentSeed: cls.current_seed || 0,
      belt,
    }
  })
})

// Primary language (most common across classes)
const primaryLanguage = computed(() => {
  const langs = classesData.value.map(c => languageNames[c.course_code] || c.course_code)
  if (langs.length === 0) return 'the target language'
  // Most frequent
  const freq: Record<string, number> = {}
  langs.forEach(l => { freq[l] = (freq[l] || 0) + 1 })
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
})

// New sections covered (sum of current_seed across all classes — rough proxy)
const totalSectionsCovered = computed(() =>
  classesData.value.reduce((sum, c) => sum + (c.current_seed || 0), 0)
)

// Period label for display
const periodLabel = computed(() => {
  if (selectedPeriod.value === '7d') return 'Last 7 days'
  if (selectedPeriod.value === '30d') return 'Last 30 days'
  return 'All time'
})

// Load data
async function loadData() {
  isLoading.value = true
  await fetchClasses()
  await fetchClassSessions()
  isLoading.value = false
}

onMounted(() => {
  setTimeout(() => { isVisible.value = true }, 50)
  if (selectedUser.value) loadData()
})

watch(selectedUser, (u) => { if (u) loadData() })
watch(selectedPeriod, () => fetchClassSessions())
</script>

<template>
  <div class="analytics-view" :class="{ 'is-visible': isVisible }">
    <!-- Header -->
    <header class="page-header animate-item" :class="{ show: isVisible }">
      <div class="page-title">
        <h1>Class Activity</h1>
        <p class="page-subtitle">How your classes are using SaySomethingin</p>
      </div>
      <div class="period-selector">
        <button
          v-for="p in ([
            { key: '7d', label: '7 days' },
            { key: '30d', label: '30 days' },
            { key: 'all', label: 'All time' },
          ] as const)"
          :key="p.key"
          class="period-btn"
          :class="{ active: selectedPeriod === p.key }"
          @click="selectedPeriod = p.key as TimePeriod"
        >
          {{ p.label }}
        </button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="isLoading" class="loading-state">
      <p>Loading class activity...</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="classesData.length === 0" class="empty-state animate-item delay-1" :class="{ show: isVisible }">
      <p>No classes found. Create a class to start tracking activity.</p>
    </div>

    <template v-else>
      <!-- Volume Stats -->
      <div class="volume-cards animate-item delay-1" :class="{ show: isVisible }">
        <div class="volume-card">
          <div class="volume-value">{{ totalSpeakingOpportunities.toLocaleString() }}</div>
          <div class="volume-label">Speaking opportunities in {{ primaryLanguage }}</div>
          <div class="volume-period">{{ periodLabel }}</div>
        </div>
        <div class="volume-card">
          <div class="volume-value">{{ totalMinutes.toLocaleString() }}</div>
          <div class="volume-label">Minutes speaking {{ primaryLanguage }}</div>
          <div class="volume-period">{{ periodLabel }}</div>
        </div>
        <div class="volume-card">
          <div class="volume-value">{{ totalSectionsCovered.toLocaleString() }}</div>
          <div class="volume-label">New sections covered</div>
          <div class="volume-period">Across {{ classesData.length }} {{ classesData.length === 1 ? 'class' : 'classes' }}</div>
        </div>
      </div>

      <!-- Per-class breakdown -->
      <div class="class-table animate-item delay-2" :class="{ show: isVisible }">
        <h2 class="section-title">By class</h2>
        <div class="class-rows">
          <div
            v-for="cls in classStats"
            :key="cls.id"
            class="class-row"
          >
            <!-- Class identity -->
            <div class="class-identity">
              <div class="class-name">{{ cls.name }}</div>
              <div class="class-language">{{ cls.language }}</div>
            </div>

            <!-- Volume stats for this class -->
            <div class="class-volumes">
              <div class="class-stat">
                <span class="class-stat-value">{{ cls.cycles.toLocaleString() }}</span>
                <span class="class-stat-label">speaking opps</span>
              </div>
              <div class="class-stat">
                <span class="class-stat-value">{{ cls.minutes }}</span>
                <span class="class-stat-label">minutes</span>
              </div>
              <div class="class-stat">
                <span class="class-stat-value">{{ cls.sessionCount }}</span>
                <span class="class-stat-label">sessions</span>
              </div>
            </div>

            <!-- Belt position -->
            <div class="class-position">
              <div class="belt-badge" :style="{ background: cls.belt.color }">
                {{ cls.belt.name }}
              </div>
              <div class="belt-progress-text">
                {{ cls.belt.sectionsComplete }} / {{ cls.belt.sectionsInBelt }} sections
              </div>
              <div class="belt-progress-bar">
                <div
                  class="belt-progress-fill"
                  :style="{
                    width: cls.belt.sectionsInBelt > 0
                      ? `${Math.min((cls.belt.sectionsComplete / cls.belt.sectionsInBelt) * 100, 100)}%`
                      : '0%',
                    background: cls.belt.color
                  }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.analytics-view {
  max-width: 1100px;
}

/* Header */
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-8);
  flex-wrap: wrap;
}

.page-title h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  margin-bottom: var(--space-1);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

.period-selector {
  display: flex;
  gap: var(--space-1);
  background: var(--bg-card);
  padding: var(--space-1);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
}

.period-btn {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: all 0.15s ease;
}

.period-btn.active {
  background: var(--ssi-red);
  color: white;
}

.period-btn:hover:not(.active) {
  background: var(--bg-elevated);
}

/* Volume Cards */
.volume-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-5);
  margin-bottom: var(--space-8);
}

.volume-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
}

.volume-value {
  font-size: 2.5rem;
  font-weight: var(--font-bold);
  line-height: 1;
  margin-bottom: var(--space-2);
  color: var(--text-primary);
}

.volume-label {
  font-size: var(--text-base);
  color: var(--text-secondary);
  margin-bottom: var(--space-1);
}

.volume-period {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* Class Table */
.section-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  margin-bottom: var(--space-4);
}

.class-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.class-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: var(--space-6);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-5) var(--space-6);
  transition: border-color 0.15s ease;
}

.class-row:hover {
  border-color: var(--ssi-red);
}

.class-identity {
  min-width: 0;
}

.class-name {
  font-weight: var(--font-semibold);
  font-size: var(--text-base);
  color: var(--text-primary);
}

.class-language {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-top: 2px;
}

.class-volumes {
  display: flex;
  gap: var(--space-6);
}

.class-stat {
  text-align: center;
  min-width: 70px;
}

.class-stat-value {
  display: block;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
}

.class-stat-label {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 2px;
}

/* Belt Position */
.class-position {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-1);
  min-width: 140px;
}

.belt-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 100px;
  font-size: var(--text-xs);
  font-weight: var(--font-bold);
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.belt-progress-text {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.belt-progress-bar {
  width: 100%;
  height: 4px;
  background: var(--bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.belt-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.6s ease;
}

/* States */
.loading-state, .empty-state {
  text-align: center;
  padding: var(--space-12);
  color: var(--text-muted);
}

/* Animations */
.animate-item {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.animate-item.show {
  opacity: 1;
  transform: translateY(0);
}

.delay-1 { transition-delay: 0.1s; }
.delay-2 { transition-delay: 0.2s; }

/* Responsive */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
  }

  .volume-cards {
    grid-template-columns: 1fr;
  }

  .class-row {
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  .class-volumes {
    justify-content: space-between;
  }

  .class-position {
    align-items: flex-start;
  }
}
</style>
