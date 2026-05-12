<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import HealthDot from '@/components/schools/shared/HealthDot.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData, type School } from '@/composables/schools/useSchoolData'

const router = useRouter()
const { currentUser } = useSchoolContext()
const {
  schools,
  groupSummary,
  totalStudents,
  totalTeachers,
  totalClasses,
  totalPracticeHours,
  fetchSchools,
  selectSchoolToView,
} = useSchoolData()

const searchQuery = ref('')
type SortKey = 'hours' | 'students' | 'name'
const sortKey = ref<SortKey>('hours')

const filteredSchools = computed<School[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const list = q
    ? schools.value.filter((s) => s.school_name.toLowerCase().includes(q))
    : [...schools.value]

  return list.sort((a, b) => {
    if (sortKey.value === 'students') return b.student_count - a.student_count
    if (sortKey.value === 'name') return a.school_name.localeCompare(b.school_name)
    return b.total_practice_hours - a.total_practice_hours
  })
})

const headerEyebrow = computed(() => {
  return (
    currentUser.value?.organization_name ||
    groupSummary.value?.group_name ||
    (currentUser.value?.region_code ? `${currentUser.value.region_code.toUpperCase()} Authority` : 'Programme view')
  )
})

const headerLede = computed(() => {
  const n = schools.value.length
  if (!n) return 'No schools registered in this programme yet.'
  return `Programme view of every school on SSi. ${n} school${n === 1 ? '' : 's'} active.`
})

const hoursThisWeek = computed(() => Math.round(totalPracticeHours.value))

function schoolInitial(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const last = parts[parts.length - 1] || name
  return (last[0] || '?').toUpperCase()
}

function formatJoined(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

function handleSchoolClick(school: School) {
  selectSchoolToView(school)
  router.push('/schools')
}

onMounted(() => {
  if (currentUser.value) fetchSchools()
})

watch(currentUser, (u) => {
  if (u) fetchSchools()
})
</script>

<template>
  <main class="schools-list-screen">
    <div class="hero">
      <div class="hero-text">
        <div class="hero-eyebrow">{{ headerEyebrow }}</div>
        <h1 class="arsenal hero-title">All schools</h1>
        <p class="hero-lede schools-subtle">{{ headerLede }}</p>
      </div>
      <div class="hero-actions">
        <button type="button" class="btn-ghost">Export</button>
        <button type="button" class="btn-play">+ Onboard new school</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ schools.length }}</span>
        <span class="kpi-label">Schools</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ totalStudents.toLocaleString() }}</span>
        <span class="kpi-label">Students</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ totalTeachers }}</span>
        <span class="kpi-label">Teachers</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ totalClasses }}</span>
        <span class="kpi-label">Classes</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">{{ hoursThisWeek }}h</span>
        <span class="kpi-label">Practice hours</span>
      </div>
      <div class="schools-card kpi">
        <span class="arsenal kpi-value">—</span>
        <span class="kpi-label">Active in 7d</span>
      </div>
    </div>

    <div class="schools-card list-card">
      <div class="list-header">
        <h3 class="arsenal list-title">{{ schools.length }} school{{ schools.length === 1 ? '' : 's' }}</h3>
        <div class="list-controls">
          <input
            v-model="searchQuery"
            class="list-search"
            type="text"
            placeholder="Search…"
            aria-label="Search schools"
          />
          <select v-model="sortKey" class="list-sort" aria-label="Sort schools">
            <option value="hours">Sort by hours</option>
            <option value="students">Sort by students</option>
            <option value="name">Sort by name</option>
          </select>
        </div>
      </div>

      <table class="ssi-table">
        <thead>
          <tr>
            <th>School</th>
            <th>City</th>
            <th>Students</th>
            <th>Teachers</th>
            <th>Classes</th>
            <th>Hours</th>
            <th>Joined</th>
            <th>Health</th>
            <th aria-label="actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="school in filteredSchools" :key="school.id">
            <td>
              <div class="school-cell">
                <div class="school-mark">{{ schoolInitial(school.school_name) }}</div>
                <div class="school-name">{{ school.school_name }}</div>
              </div>
            </td>
            <td class="schools-subtle">—</td>
            <td>{{ school.student_count }}</td>
            <td>{{ school.teacher_count }}</td>
            <td>{{ school.class_count }}</td>
            <td>{{ Math.round(school.total_practice_hours) }}h</td>
            <td class="schools-subtle">{{ formatJoined(school.created_at) }}</td>
            <td>
              <span class="health-cell">
                <HealthDot health="inactive" />
                <span class="schools-subtle">n/a</span>
              </span>
            </td>
            <td class="row-action">
              <button type="button" class="row-link" @click="handleSchoolClick(school)">
                Open →
              </button>
            </td>
          </tr>
          <tr v-if="!filteredSchools.length">
            <td colspan="9" class="empty-row schools-subtle">
              <template v-if="searchQuery">No schools match "{{ searchQuery }}".</template>
              <template v-else>No schools to show.</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</template>

<style scoped>
.schools-list-screen {
  padding: 24px 32px 32px;
  max-width: 1280px;
  margin: 0 auto;
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

.hero-text {
  max-width: 620px;
}

.hero-eyebrow {
  font-size: 11px;
  color: var(--schools-red);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 6px;
}

.hero-title {
  font-size: 36px;
  line-height: 1.05;
  margin: 0;
}

.hero-lede {
  font-size: 14px;
  margin-top: 6px;
  line-height: 1.5;
  max-width: 560px;
}

.hero-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px;
}

.kpi-value {
  font-size: 26px;
  line-height: 1;
}

.kpi-label {
  font-size: 11.5px;
  color: var(--schools-fg-2);
}

.list-card {
  overflow: hidden;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--schools-border);
  gap: 12px;
  flex-wrap: wrap;
}

.list-title {
  font-size: 18px;
  margin: 0;
}

.list-controls {
  display: flex;
  gap: 8px;
}

.list-search {
  padding: 5px 10px;
  font-size: 12px;
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fafaf6;
  font-family: var(--font-body);
  width: 200px;
  color: var(--schools-fg);
}

.list-search:focus {
  outline: none;
  border-color: var(--schools-red);
  background: #fff;
}

.list-sort {
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fff;
  font-family: var(--font-body);
  color: var(--schools-fg);
  cursor: pointer;
}

.school-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.school-mark {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: var(--schools-red);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 14px;
  flex: none;
}

.school-name {
  font-weight: 600;
}

.health-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.row-action {
  text-align: right;
}

.row-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--schools-red);
  font-family: var(--font-body);
  cursor: pointer;
}

.row-link:hover {
  color: var(--schools-red-deep);
}

.empty-row {
  text-align: center;
  padding: 32px 12px;
  font-size: 13px;
}

@media (max-width: 1200px) {
  .kpi-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 960px) {
  .schools-list-screen {
    padding: 20px 16px 28px;
  }

  .hero {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .list-header {
    flex-direction: column;
    align-items: stretch;
  }

  .list-controls {
    flex-wrap: wrap;
  }

  .list-search {
    flex: 1;
    min-width: 160px;
  }
}
</style>
