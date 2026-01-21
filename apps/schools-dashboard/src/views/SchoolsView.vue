<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import SearchBox from '@/components/shared/SearchBox.vue'
import { useGodMode } from '@/composables/useGodMode'
import { useSchoolData } from '@/composables/useSchoolData'

const router = useRouter()
const { selectedUser } = useGodMode()
const { schools, regionSummary, totalClasses, fetchSchools, selectSchoolToView } = useSchoolData()

// Search
const searchQuery = ref('')

// Filtered schools
const filteredSchools = computed(() => {
  if (!searchQuery.value) return schools.value
  const query = searchQuery.value.toLowerCase()
  return schools.value.filter(school =>
    school.school_name.toLowerCase().includes(query)
  )
})

// Handle school click - drill down
function handleSchoolClick(school: typeof schools.value[0]) {
  selectSchoolToView(school)
  router.push('/')
}

// Format hours
function formatHours(hours: number): string {
  if (hours >= 1000) return `${(hours / 1000).toFixed(1)}k`
  return hours.toFixed(0)
}

// Animation
const isVisible = ref(false)
onMounted(() => {
  setTimeout(() => { isVisible.value = true }, 50)
  if (selectedUser.value) {
    fetchSchools()
  }
})

watch(selectedUser, (newUser) => {
  if (newUser) {
    fetchSchools()
  }
})
</script>

<template>
  <div class="schools-view" :class="{ 'is-visible': isVisible }">
    <!-- Page Header -->
    <header class="page-header animate-item" :class="{ 'show': isVisible }">
      <div class="page-title">
        <h1>Schools</h1>
        <div class="school-count" v-if="regionSummary">
          <span class="count-value">{{ regionSummary.school_count }}</span> schools in {{ regionSummary.region_code }}
        </div>
      </div>
    </header>

    <!-- Region Summary -->
    <div class="region-stats animate-item delay-1" :class="{ 'show': isVisible }" v-if="regionSummary">
      <div class="stat-card">
        <div class="stat-value">{{ regionSummary.school_count }}</div>
        <div class="stat-label">Schools</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ regionSummary.teacher_count }}</div>
        <div class="stat-label">Teachers</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ totalClasses }}</div>
        <div class="stat-label">Classes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ regionSummary.student_count.toLocaleString() }}</div>
        <div class="stat-label">Students</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ formatHours(regionSummary.total_practice_hours) }}</div>
        <div class="stat-label">Hours Learned</div>
      </div>
    </div>

    <!-- Search -->
    <div class="search-bar animate-item delay-1" :class="{ 'show': isVisible }">
      <SearchBox
        v-model="searchQuery"
        placeholder="Search schools..."
        block
      />
    </div>

    <!-- Schools Grid -->
    <div class="schools-grid animate-item delay-2" :class="{ 'show': isVisible }">
      <button
        v-for="school in filteredSchools"
        :key="school.id"
        class="school-card"
        @click="handleSchoolClick(school)"
      >
        <div class="school-header">
          <div class="school-avatar">
            {{ school.school_name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() }}
          </div>
          <div class="school-info">
            <h3 class="school-name">{{ school.school_name }}</h3>
            <span class="school-region">{{ school.region_code || 'Region' }}</span>
          </div>
        </div>
        <div class="school-stats">
          <div class="school-stat">
            <span class="stat-number">{{ school.teacher_count }}</span>
            <span class="stat-label">Teachers</span>
          </div>
          <div class="school-stat">
            <span class="stat-number">{{ school.class_count }}</span>
            <span class="stat-label">Classes</span>
          </div>
          <div class="school-stat">
            <span class="stat-number">{{ school.student_count }}</span>
            <span class="stat-label">Students</span>
          </div>
          <div class="school-stat">
            <span class="stat-number">{{ formatHours(school.total_practice_hours) }}</span>
            <span class="stat-label">Hours</span>
          </div>
        </div>
        <div class="school-action">
          <span>View Dashboard</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </button>
    </div>

    <!-- Empty State -->
    <div v-if="filteredSchools.length === 0 && !searchQuery" class="empty-state">
      <h3>No schools found</h3>
      <p>No schools are registered in this region yet.</p>
    </div>

    <div v-if="filteredSchools.length === 0 && searchQuery" class="empty-state">
      <h3>No results</h3>
      <p>No schools match "{{ searchQuery }}"</p>
    </div>
  </div>
</template>

<style scoped>
.schools-view {
  max-width: 1400px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-8);
}

.page-title {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.page-title h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
}

.school-count {
  background: var(--bg-card);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.school-count .count-value {
  color: var(--ssi-gold);
  font-weight: var(--font-bold);
}

/* Region Stats */
.region-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  text-align: center;
}

.stat-card .stat-value {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--ssi-gold);
  margin-bottom: var(--space-1);
}

.stat-card .stat-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* Search */
.search-bar {
  margin-bottom: var(--space-6);
  max-width: 400px;
}

/* Schools Grid */
.schools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-5);
}

.school-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  cursor: pointer;
  transition: all var(--transition-base);
  text-align: left;
  width: 100%;
}

.school-card:hover {
  border-color: var(--ssi-red);
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.school-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.school-avatar {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold);
  font-size: var(--text-lg);
  color: white;
  flex-shrink: 0;
}

.school-info {
  flex: 1;
  min-width: 0;
}

.school-name {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  margin-bottom: var(--space-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.school-region {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-transform: capitalize;
}

.school-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.school-stat {
  text-align: center;
}

.school-stat .stat-number {
  display: block;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
}

.school-stat .stat-label {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.school-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-4);
  color: var(--ssi-red);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: var(--space-20);
}

.empty-state h3 {
  font-size: var(--text-xl);
  margin-bottom: var(--space-2);
}

.empty-state p {
  color: var(--text-secondary);
}

/* Animations */
.animate-item {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.animate-item.show {
  opacity: 1;
  transform: translateY(0);
}

.animate-item.delay-1 { transition-delay: 0.1s; }
.animate-item.delay-2 { transition-delay: 0.2s; }

/* Responsive */
@media (max-width: 1024px) {
  .region-stats {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .region-stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .schools-grid {
    grid-template-columns: 1fr;
  }

  .school-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
