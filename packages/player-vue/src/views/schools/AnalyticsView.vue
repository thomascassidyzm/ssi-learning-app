<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData } from '@/composables/schools/useClassesData'
import { getSchoolsClient } from '@/composables/schools/client'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import Sparkline from '@/components/schools/shared/Sparkline.vue'
import Bench from '@/components/schools/shared/Bench.vue'
import { deriveBelt as getBelt, type BeltName } from '@/composables/schools/belts'

type Period = 'week' | 'month' | 'term'

const { currentUser } = useSchoolContext()
const { classes: classesData, fetchClasses } = useClassesData()

const period = ref<Period>('week')
const classSessions = ref<Array<{
  class_id: string
  cycles_completed: number | null
  duration_seconds: number | null
  started_at: string
}>>([])
const isLoading = ref(false)

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

const periodDays = computed(() => {
  if (period.value === 'week') return 7
  if (period.value === 'month') return 30
  return 90
})

const periodStart = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() - periodDays.value)
  return d.toISOString()
})

const periodLabel = computed(() => {
  if (period.value === 'week') return 'week'
  if (period.value === 'month') return 'month'
  return 'term'
})

async function fetchSessions() {
  const classIds = classesData.value.map(c => c.id)
  if (classIds.length === 0) {
    classSessions.value = []
    return
  }
  const client = getSchoolsClient()
  const { data, error: err } = await client
    .from('class_sessions')
    .select('class_id, cycles_completed, duration_seconds, started_at')
    .in('class_id', classIds)
    .gte('started_at', periodStart.value)
    .order('started_at', { ascending: false })

  if (err) {
    console.warn('[Analytics] Failed to fetch class sessions:', err.message)
    classSessions.value = []
    return
  }
  classSessions.value = data || []
}

async function loadAll() {
  if (!currentUser.value) return
  isLoading.value = true
  await fetchClasses()
  await fetchSessions()
  isLoading.value = false
}

onMounted(() => {
  if (currentUser.value) loadAll()
})

watch(currentUser, (u) => { if (u) loadAll() })
watch(period, () => { fetchSessions() })

// ---------- KPIs ----------

const totalHours = computed(() => {
  const seconds = classSessions.value.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
  return seconds / 3600
})

const totalSessions = computed(() => classSessions.value.length)

const avgSessionMins = computed(() => {
  if (totalSessions.value === 0) return 0
  const seconds = classSessions.value.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
  return Math.round((seconds / totalSessions.value) / 60)
})

const totalStudents = computed(() =>
  classesData.value.reduce((sum, c) => sum + (c.student_count || 0), 0),
)

const classCount = computed(() => classesData.value.length)

// Primary language across classes
const primaryLanguage = computed(() => {
  if (classesData.value.length === 0) return ''
  const freq: Record<string, number> = {}
  classesData.value.forEach(c => {
    const lang = languageNames[c.course_code] || c.course_code
    freq[lang] = (freq[lang] || 0) + 1
  })
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
  return sorted[0]?.[0] ?? ''
})

const schoolName = computed(() => currentUser.value?.school_name || 'your school')

// ---------- Practice-by-day chart ----------

type DayBar = { label: string; hours: number }

const dayBars = computed<DayBar[]>(() => {
  const out: DayBar[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    const dayLabel = d.toLocaleDateString('en-GB', { weekday: 'short' })
    const totalSec = classSessions.value
      .filter(s => s.started_at.split('T')[0] === key)
      .reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
    out.push({ label: dayLabel, hours: Math.round((totalSec / 3600) * 10) / 10 })
  }
  return out
})

const maxDayHours = computed(() => Math.max(...dayBars.value.map(d => d.hours), 1))

// ---------- Per-class breakdown ----------

type ClassRow = {
  id: string
  name: string
  belt: BeltName
  students: number
  hoursWk: number
  sessionsWk: number
  avgMins: number
  legosRetired: number
  activity: number[]
}

function buildSparklineForClass(classId: string): number[] {
  const out: number[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    const totalSec = classSessions.value
      .filter(s => s.class_id === classId && s.started_at.split('T')[0] === key)
      .reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
    out.push(Math.round((totalSec / 3600) * 10) / 10)
  }
  return out
}

const classRows = computed<ClassRow[]>(() =>
  classesData.value.map(c => {
    const sessions = classSessions.value.filter(s => s.class_id === c.id)
    const seconds = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
    const cycles = sessions.reduce((sum, s) => sum + (s.cycles_completed || 0), 0)
    const sessionCount = sessions.length
    return {
      id: c.id,
      name: c.class_name,
      belt: getBelt(c.current_seed || 0),
      students: c.student_count || 0,
      hoursWk: Math.round((seconds / 3600) * 10) / 10,
      sessionsWk: sessionCount,
      avgMins: sessionCount > 0 ? Math.round(seconds / sessionCount / 60) : 0,
      legosRetired: Math.round(cycles / 30),
      activity: buildSparklineForClass(c.id),
    }
  }),
)

// Benchmark uses computed avg minutes per student per period (no school/global data
// available — placeholdered with class data + n/a markers).
const benchData = computed(() => {
  const totalMins = totalHours.value * 60
  const perStudent = totalStudents.value > 0 ? Math.round(totalMins / totalStudents.value) : 0
  return { class: perStudent, school: 0, course: 0 }
})

function formatHours(h: number): string {
  if (h < 0.1) return '0h'
  return `${h.toFixed(1)}h`
}
</script>

<template>
  <div class="analytics-page">
    <header class="page-head">
      <div>
        <h1 class="arsenal page-title">Analytics</h1>
        <p class="page-sub schools-subtle">
          How {{ schoolName }} is using SSi this {{ periodLabel }}.
        </p>
      </div>
      <div class="period-toggle" role="radiogroup" aria-label="Time period">
        <button
          v-for="p in (['week', 'month', 'term'] as const)"
          :key="p"
          type="button"
          :class="['period-btn', { active: period === p }]"
          @click="period = p"
        >
          {{ p }}
        </button>
      </div>
    </header>

    <div v-if="isLoading" class="state-msg schools-subtle">Loading…</div>

    <template v-else-if="classesData.length === 0">
      <div class="state-msg schools-subtle">
        No classes yet. Create a class to start tracking activity.
      </div>
    </template>

    <template v-else>
      <!-- KPI cards -->
      <div class="kpi-grid">
        <div class="schools-card schools-card-pad kpi">
          <span class="arsenal kpi-value">{{ formatHours(totalHours) }}</span>
          <div class="kpi-label">Total practice</div>
          <div class="kpi-detail schools-subtle">across {{ classCount }} {{ classCount === 1 ? 'class' : 'classes' }}</div>
        </div>
        <div class="schools-card schools-card-pad kpi">
          <span class="arsenal kpi-value">{{ totalSessions }}</span>
          <div class="kpi-label">Class sessions</div>
          <div class="kpi-detail schools-subtle">this {{ periodLabel }}</div>
        </div>
        <div class="schools-card schools-card-pad kpi">
          <span class="arsenal kpi-value">{{ totalStudents }}</span>
          <div class="kpi-label">Learners</div>
          <div class="kpi-detail schools-subtle">in {{ primaryLanguage || 'your courses' }}</div>
        </div>
        <div class="schools-card schools-card-pad kpi">
          <span class="arsenal kpi-value">{{ avgSessionMins }}m</span>
          <div class="kpi-label">Avg session</div>
          <div class="kpi-detail schools-subtle">{{ totalSessions > 0 ? 'per class run' : '—' }}</div>
        </div>
      </div>

      <!-- Practice-by-day + benchmarks -->
      <div class="middle-grid">
        <div class="schools-card schools-card-pad practice-card">
          <h3 class="arsenal section-title">Practice by day</h3>
          <div class="bars-row" :style="{ height: '160px' }">
            <div v-for="(d, i) in dayBars" :key="i" class="bar-col">
              <div class="bar-value">{{ d.hours > 0 ? d.hours : '' }}</div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :style="{ height: `${(d.hours / maxDayHours) * 100}%` }"
                />
              </div>
              <div class="bar-label">{{ d.label }}</div>
            </div>
          </div>
        </div>

        <div class="schools-card schools-card-pad bench-card">
          <h3 class="arsenal section-title">Benchmarks</h3>
          <div class="bench-sub schools-subtle">Min/student this {{ periodLabel }}</div>
          <Bench :data="benchData" unit="m" />
          <div class="bench-foot schools-subtle">
            School and global benchmarks not yet wired — class average shown.
          </div>
        </div>
      </div>

      <!-- Per-class breakdown -->
      <div class="schools-card breakdown-card">
        <div class="breakdown-head">
          <h3 class="arsenal section-title">Per-class breakdown</h3>
        </div>
        <table class="ssi-table">
          <thead>
            <tr>
              <th>Class</th>
              <th>Students</th>
              <th>Hours / {{ periodLabel }}</th>
              <th>Sessions</th>
              <th>Avg session</th>
              <th>LEGOs covered</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in classRows" :key="c.id">
              <td>
                <div class="class-cell">
                  <BeltDot :belt="c.belt" :size="16" ring />
                  <span class="class-cell-name">{{ c.name }}</span>
                </div>
              </td>
              <td>{{ c.students }}</td>
              <td>{{ formatHours(c.hoursWk) }}</td>
              <td>{{ c.sessionsWk }}</td>
              <td>{{ c.avgMins }}m</td>
              <td>{{ c.legosRetired }}</td>
              <td><Sparkline :data="c.activity" :width="100" :height="22" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.analytics-page {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}

.page-title {
  font-size: 32px;
  line-height: 1.05;
  letter-spacing: -0.01em;
}

.page-sub {
  font-size: 13.5px;
  margin-top: 4px;
}

.period-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: #f3f1ec;
  border: 1px solid var(--schools-border);
  border-radius: 8px;
}

.period-btn {
  padding: 6px 14px;
  font-size: 12.5px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--schools-fg-2);
  font-weight: 500;
  cursor: pointer;
  font-family: var(--font-body);
  text-transform: capitalize;
  transition: background 160ms ease-out, color 160ms ease-out;
}
.period-btn.active {
  background: #fff;
  color: var(--schools-fg);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.state-msg {
  padding: 48px 0;
  text-align: center;
  font-size: 14px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi-value {
  font-size: 30px;
  line-height: 1;
}

.kpi-label {
  font-size: 13px;
  color: var(--schools-fg);
  margin-top: 4px;
}

.kpi-detail {
  font-size: 11px;
  margin-top: 2px;
}

.middle-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 14px;
}

.section-title {
  font-size: 18px;
  margin-bottom: 6px;
}

.practice-card .bars-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding-top: 8px;
}

.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
}

.bar-value {
  font-size: 11px;
  color: var(--schools-fg-2);
  min-height: 14px;
}

.bar-track {
  width: 100%;
  flex: 1;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  position: relative;
  display: flex;
  align-items: flex-end;
}

.bar-fill {
  width: 100%;
  background: var(--schools-red);
  border-radius: 4px;
  transition: height 0.3s ease;
}

.bar-label {
  font-size: 11px;
  color: var(--schools-fg-2);
}

.bench-card {
  display: flex;
  flex-direction: column;
}

.bench-sub {
  font-size: 12.5px;
  margin-bottom: 8px;
}

.bench-foot {
  font-size: 11px;
  margin-top: 10px;
  line-height: 1.4;
}

.breakdown-card {
  overflow: hidden;
}

.breakdown-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--schools-border);
}

.class-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.class-cell-name {
  font-weight: 600;
}

@media (max-width: 960px) {
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .middle-grid {
    grid-template-columns: 1fr;
  }
}
</style>
