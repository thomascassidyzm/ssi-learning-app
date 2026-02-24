<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import Card from '@/components/schools/shared/Card.vue'
import { useGodMode } from '@/composables/schools/useGodMode'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { useAnalyticsData, type RegionReport } from '@/composables/schools/useAnalyticsData'
import { getSchoolsClient } from '@/composables/schools/client'

const { selectedUser, isGovtAdmin } = useGodMode()
const {
  schools,
  currentSchool,
  regionSummary,
  viewingSchool,
  isViewingSchool,
  totalStudents,
  totalTeachers,
  totalClasses,
  totalPracticeHours,
  fetchSchools,
  selectSchoolToView,
  clearViewingSchool,
  isLoading,
  error
} = useSchoolData()

// Display values
const schoolName = computed(() => {
  // If govt admin is viewing a specific school (drilled down)
  if (isViewingSchool.value && viewingSchool.value) return viewingSchool.value.school_name
  // If govt admin at regional level
  if (isGovtAdmin.value && regionSummary.value) return regionSummary.value.region_name
  return currentSchool.value?.school_name || selectedUser.value?.school_name || 'Your School'
})

// Breadcrumb for drill-down navigation
const breadcrumb = computed(() => {
  if (!isViewingSchool.value) return null
  return {
    region: regionSummary.value?.region_name || 'Region',
    school: viewingSchool.value?.school_name || 'School'
  }
})

const practiceHoursDisplay = computed(() => Math.round(totalPracticeHours.value))

// Region report and contribution counter
const { getRegionReport } = useAnalyticsData()
const regionReport = ref<RegionReport | null>(null)

interface DailyContribution {
  phrases_count: number
  minutes_practiced: number
  unique_speakers: number
  target_language: string
}
const todayContributions = ref<DailyContribution | null>(null)

const languageNames: Record<string, string> = {
  cym: 'Welsh', gla: 'Scottish Gaelic', gle: 'Irish', cor: 'Cornish',
  glv: 'Manx', bre: 'Breton', eus: 'Basque', cat: 'Catalan',
  spa: 'Spanish', fra: 'French', deu: 'German', nld: 'Dutch',
}

async function loadRegionData() {
  if (!isGovtAdmin.value || !selectedUser.value?.region_code) return
  regionReport.value = await getRegionReport(selectedUser.value.region_code)
}

async function loadContributions() {
  if (!isGovtAdmin.value) return
  const client = getSchoolsClient()
  const today = new Date().toISOString().split('T')[0]
  const { data } = await client
    .from('daily_contributions')
    .select('phrases_count, minutes_practiced, unique_speakers, target_language')
    .eq('contribution_date', today)
    .limit(1)
    .single()
  todayContributions.value = data
}

// Debug info for testing
const debugInfo = computed(() => ({
  hasUser: !!selectedUser.value,
  userName: selectedUser.value?.display_name,
  role: selectedUser.value?.educational_role,
  regionCode: selectedUser.value?.region_code,
  isGovtAdmin: isGovtAdmin.value,
  hasRegionSummary: !!regionSummary.value,
  error: error.value,
}))

// Fetch data when user changes
watch(selectedUser, (user) => {
  if (user) {
    fetchSchools()
    loadRegionData()
    loadContributions()
  }
}, { immediate: true })

onMounted(() => {
  if (selectedUser.value) {
    fetchSchools()
    loadRegionData()
    loadContributions()
  }
})
</script>

<template>
  <div class="dashboard-view">
    <!-- Breadcrumb (when drilled down) -->
    <nav v-if="breadcrumb" class="breadcrumb animate-in">
      <button class="breadcrumb-link" @click="clearViewingSchool">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        {{ breadcrumb.region }}
      </button>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-current">{{ breadcrumb.school }}</span>
    </nav>

    <!-- Page Header -->
    <header class="page-header animate-in">
      <div class="page-title">
        <h1>Dashboard</h1>
        <p class="page-subtitle">
          <template v-if="selectedUser">
            <template v-if="isViewingSchool">
              Viewing {{ schoolName }}
            </template>
            <template v-else-if="isGovtAdmin">
              Regional overview for {{ schoolName }}
            </template>
            <template v-else>
              Welcome back! {{ schoolName }}
            </template>
          </template>
          <template v-else>
            Select a user from God Mode to view dashboard data
          </template>
        </p>
      </div>
    </header>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-state animate-in delay-1">
      <p>Loading dashboard data...</p>
    </div>

    <!-- Stats Grid -->
    <div v-else class="stats-grid animate-in delay-1">
      <Card variant="stats" accent="blue">
        <div class="stat-card">
          <div class="stat-icon">&#128101;</div>
          <div class="stat-content">
            <div class="stat-value">{{ totalStudents.toLocaleString() }}</div>
            <div class="stat-label">{{ isGovtAdmin ? 'Total Students' : 'Active Students' }}</div>
          </div>
        </div>
      </Card>

      <Card variant="stats" accent="gold">
        <div class="stat-card">
          <div class="stat-icon">&#128337;</div>
          <div class="stat-content">
            <div class="stat-value">{{ practiceHoursDisplay.toLocaleString() }}</div>
            <div class="stat-label">Hours Practiced</div>
          </div>
        </div>
      </Card>

      <Card variant="stats" accent="red">
        <div class="stat-card">
          <div class="stat-icon">&#128218;</div>
          <div class="stat-content">
            <div class="stat-value">{{ totalClasses }}</div>
            <div class="stat-label">{{ isGovtAdmin ? 'Total Classes' : 'Active Classes' }}</div>
          </div>
        </div>
      </Card>

      <Card variant="stats" accent="green">
        <div class="stat-card">
          <div class="stat-icon">&#127979;</div>
          <div class="stat-content">
            <div class="stat-value">{{ totalTeachers }}</div>
            <div class="stat-label">Teachers</div>
          </div>
        </div>
      </Card>
    </div>

    <!-- Schools in Region (Govt Admin only, at regional level) -->
    <section v-if="isGovtAdmin && !isViewingSchool && schools.length > 0" class="region-schools animate-in delay-2">
      <Card :title="`Schools in ${regionSummary?.region_name || 'Region'}`" :subtitle="`${schools.length} schools`">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </template>
        <div class="schools-grid">
          <button
            v-for="school in schools"
            :key="school.id"
            class="school-card"
            @click="selectSchoolToView(school)"
          >
            <div class="school-header">
              <div class="school-avatar">{{ school.school_name.substring(0, 2).toUpperCase() }}</div>
              <div class="school-info">
                <h4>{{ school.school_name }}</h4>
                <span class="school-meta">{{ school.teacher_count }} teachers · {{ school.class_count }} classes</span>
              </div>
              <svg class="school-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
            <div class="school-stats">
              <div class="school-stat">
                <span class="stat-num">{{ school.student_count }}</span>
                <span class="stat-label">Students</span>
              </div>
              <div class="school-stat">
                <span class="stat-num">{{ Math.round(school.total_practice_hours) }}</span>
                <span class="stat-label">Hours</span>
              </div>
            </div>
          </button>
        </div>
      </Card>
    </section>

    <!-- Quick Actions -->
    <section class="quick-actions animate-in delay-3">
      <Card title="Quick Actions">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </template>
        <div class="actions-grid">
          <router-link to="/classes" class="action-card">
            <div class="action-icon">&#9658;</div>
            <span>Start Session</span>
          </router-link>
          <router-link to="/students" class="action-card">
            <div class="action-icon">&#128100;</div>
            <span>Add Student</span>
          </router-link>
          <router-link to="/teachers" class="action-card">
            <div class="action-icon">&#128188;</div>
            <span>Add Teacher</span>
          </router-link>
          <router-link to="/analytics" class="action-card">
            <div class="action-icon">&#128200;</div>
            <span>View Reports</span>
          </router-link>
        </div>
      </Card>
    </section>

    <!-- Contribution Counter (Govt Admin) -->
    <section v-if="isGovtAdmin && todayContributions" class="contribution-counter animate-in delay-3">
      <div class="contribution-card">
        <div class="contribution-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
          <span>{{ languageNames[todayContributions.target_language] || todayContributions.target_language }} spoken today</span>
        </div>
        <div class="contribution-stats">
          <div class="contrib-stat">
            <span class="contrib-value">{{ todayContributions.phrases_count.toLocaleString() }}</span>
            <span class="contrib-label">phrases</span>
          </div>
          <div class="contrib-divider"></div>
          <div class="contrib-stat">
            <span class="contrib-value">{{ todayContributions.minutes_practiced.toLocaleString() }}</span>
            <span class="contrib-label">minutes</span>
          </div>
          <div class="contrib-divider"></div>
          <div class="contrib-stat">
            <span class="contrib-value">{{ todayContributions.unique_speakers.toLocaleString() }}</span>
            <span class="contrib-label">speakers</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Region Cycles Summary (Govt Admin) -->
    <section v-if="isGovtAdmin && regionReport && !isViewingSchool" class="region-cycles animate-in delay-3">
      <Card title="Speaking Opportunities by School" :subtitle="`${regionReport.regionTotal.toLocaleString()} total across region`">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        </template>
        <div class="region-school-list">
          <div
            v-for="school in regionReport.schools"
            :key="school.school_id"
            class="region-school-row"
          >
            <div class="region-school-name">{{ school.school_name }}</div>
            <div class="region-school-meta">{{ school.class_count }} classes · {{ school.active_students }} students</div>
            <div class="region-school-cycles">{{ school.total_cycles.toLocaleString() }}</div>
          </div>
        </div>
      </Card>
    </section>

    <!-- Debug Panel (temporary) -->
    <section class="debug-panel animate-in delay-4">
      <Card title="Debug Info" subtitle="God Mode state">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </template>
        <pre class="debug-output">{{ JSON.stringify(debugInfo, null, 2) }}</pre>
      </Card>
    </section>
  </div>
</template>

<style scoped>
.dashboard-view {
  max-width: 1200px;
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  font-size: var(--text-sm);
}

.breadcrumb-link {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: none;
  border: none;
  color: var(--ssi-red);
  cursor: pointer;
  font-size: inherit;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  transition: all var(--transition-base);
}

.breadcrumb-link:hover {
  background: var(--bg-elevated);
}

.breadcrumb-separator {
  color: var(--text-muted);
}

.breadcrumb-current {
  color: var(--text-secondary);
  font-weight: var(--font-medium);
}

.page-header {
  margin-bottom: var(--space-8);
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

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-6);
  margin-bottom: var(--space-8);
}

.stat-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-6);
}

.stat-icon {
  font-size: var(--text-3xl);
  line-height: 1;
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  line-height: 1;
  margin-bottom: var(--space-1);
}

.stat-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.stat-badge {
  flex-shrink: 0;
}

/* Region Schools */
.region-schools {
  margin-bottom: var(--space-8);
}

.schools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

.school-card {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  transition: all var(--transition-base);
  border: 1px solid transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: inherit;
}

.school-card:hover {
  background: var(--bg-elevated);
  transform: translateY(-2px);
  border-color: var(--ssi-red);
}

.school-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.school-chevron {
  margin-left: auto;
  color: var(--text-muted);
  opacity: 0;
  transform: translateX(-4px);
  transition: all var(--transition-base);
}

.school-card:hover .school-chevron {
  opacity: 1;
  transform: translateX(0);
  color: var(--ssi-red);
}

.school-avatar {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold);
  font-size: var(--text-sm);
  color: white;
}

.school-info h4 {
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
  margin-bottom: var(--space-1);
}

.school-meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.school-stats {
  display: flex;
  gap: var(--space-6);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.school-stat {
  display: flex;
  flex-direction: column;
}

.school-stat .stat-num {
  font-family: var(--font-display);
  font-weight: var(--font-bold);
  font-size: var(--text-lg);
}

.school-stat .stat-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* Contribution Counter */
.contribution-counter {
  margin-bottom: var(--space-8);
}

.contribution-card {
  background: linear-gradient(135deg, var(--bg-card) 0%, rgba(194, 58, 58, 0.08) 100%);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl, 18px);
  padding: var(--space-6);
}

.contribution-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-6);
}

.contribution-header svg {
  color: var(--ssi-gold);
}

.contribution-stats {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.contrib-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.contrib-value {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  color: var(--ssi-gold);
}

.contrib-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.contrib-divider {
  width: 1px;
  height: 40px;
  background: var(--border-subtle);
}

/* Region Cycles */
.region-cycles {
  margin-bottom: var(--space-8);
}

.region-school-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.region-school-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
}

.region-school-name {
  flex: 1;
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
}

.region-school-meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.region-school-cycles {
  font-family: var(--font-display);
  font-weight: var(--font-bold);
  font-size: var(--text-lg);
  color: var(--ssi-gold);
  min-width: 80px;
  text-align: right;
}

/* Quick Actions */
.quick-actions {
  margin-bottom: var(--space-8);
}

.actions-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  text-decoration: none;
  color: var(--text-secondary);
  transition: all var(--transition-base);
}

.action-card:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  transform: translateY(-2px);
}

.action-icon {
  font-size: var(--text-2xl);
}

/* Debug Panel */
.debug-panel {
  margin-top: var(--space-8);
}

.debug-output {
  background: var(--bg-secondary);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  font-family: monospace;
  font-size: var(--text-sm);
  overflow-x: auto;
  white-space: pre-wrap;
  color: var(--text-secondary);
}

/* Responsive */
@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .actions-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .actions-grid {
    grid-template-columns: 1fr;
  }
}
</style>
