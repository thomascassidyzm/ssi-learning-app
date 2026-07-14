<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData, type ClassReport } from '@/composables/schools/useClassesData'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { getSchoolsClient } from '@/composables/schools/client'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import BeltStrip from '@/components/schools/shared/BeltStrip.vue'
import JourneyBar from '@/components/schools/shared/JourneyBar.vue'
import Bench from '@/components/schools/shared/Bench.vue'
import HealthDot from '@/components/schools/shared/HealthDot.vue'
import { getLanguageName } from '@/composables/useI18n'
import { deriveBelt, type Belt } from '@/composables/schools/belts'

type Health = 'excellent' | 'good' | 'needs-attention' | 'inactive'

const router = useRouter()
const route = useRoute()

const isAdminView = inject<boolean>('isAdminView', false)
const { currentUser: selectedUser, isGovtAdmin } = useSchoolContext()
const { classDetail, fetchClassDetail, getClassReport } = useClassesData()
const { viewingSchool } = useSchoolData()

// When a govt admin drilled group → school → class, "back" should return to
// the school dashboard, not the (empty for them) classes list.
const backToSchool = computed(() => isGovtAdmin.value && !!viewingSchool.value)

const classReport = ref<ClassReport | null>(null)
const copySuccess = ref(false)
const codeCopySuccess = ref(false)
const showCode = ref(false)
const searchQuery = ref('')

// Self-view route is `classes/:id`; the admin read-view nests this under
// `/admin/schools/:id/classes/:classId`, so under that nesting Vue Router
// merges BOTH params in and `route.params.id` resolves to the parent
// SCHOOL id, not the class id. Prefer `classId` when present — see
// finding #1c, 2026-07-13 audit.
const classIdParam = computed(() => (route.params.classId as string) || (route.params.id as string))

function getInitials(name: string): string {
  return name.split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

function formatLastActive(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return 'now'
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return '1d'
  if (diffDays < 30) return `${diffDays}d`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`
  return `${Math.floor(diffDays / 365)}y`
}

function deriveStudentHealth(seeds: number, lastActiveAt: string | null, classAvg: number): Health {
  if (!lastActiveAt) return 'inactive'
  const diffDays = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 86400000)
  if (diffDays > 14) return 'needs-attention'
  if (classAvg > 0 && seeds < classAvg * 0.5) return 'needs-attention'
  if (classAvg > 0 && seeds >= classAvg * 1.25 && diffDays <= 2) return 'excellent'
  return 'good'
}

const classData = computed(() => {
  if (classDetail.value) {
    return {
      id: classDetail.value.class_id,
      class_name: classDetail.value.class_name,
      course_code: classDetail.value.course_code,
      student_count: classDetail.value.students.length,
      current_seed: classDetail.value.current_seed || 1,
      join_code: classDetail.value.student_join_code || 'N/A',
    }
  }
  const stored = sessionStorage.getItem('ssi-class-detail')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      return {
        id: parsed.id || '',
        class_name: parsed.class_name || '',
        course_code: parsed.course_code || '',
        student_count: parsed.student_count || 0,
        current_seed: parsed.current_seed || 1,
        join_code: parsed.student_join_code || '',
      }
    } catch { /* fall through */ }
  }
  return { id: '', class_name: '', course_code: '', student_count: 0, current_seed: 1, join_code: '' }
})

const courseLabel = computed(() => {
  const code = classData.value.course_code
  const match = code?.match(/^([a-z_]+?)_for_/)
  return match ? getLanguageName(match[1]) : code
})

const classAvgSeeds = computed(() => {
  const list = classDetail.value?.students ?? []
  if (!list.length) return 0
  return Math.round(list.reduce((s, x) => s + x.seeds_completed, 0) / list.length)
})

const classBelt = computed<Belt>(() => deriveBelt(classAvgSeeds.value))

const students = computed(() => {
  const list = classDetail.value?.students ?? []
  const avg = classAvgSeeds.value
  return list.map(s => {
    const belt = deriveBelt(s.seeds_completed)
    return {
      id: s.learner_id,
      user_id: s.user_id,
      name: s.display_name,
      initials: getInitials(s.display_name),
      belt,
      seeds_completed: s.seeds_completed,
      legos_mastered: s.legos_mastered,
      hours7d: Math.round((s.total_practice_minutes / 60) * 10) / 10,
      last_active_display: formatLastActive(s.last_active_at),
      health: deriveStudentHealth(s.seeds_completed, s.last_active_at, avg),
    }
  })
})

const beltDistribution = computed<Record<string, number>>(
  () => classDetail.value?.belt_distribution ?? {},
)

const beltOrder: Belt[] = ['white', 'yellow', 'orange', 'green', 'blue', 'black']
const beltDistributionOrdered = computed(() => {
  return beltOrder
    .filter(b => beltDistribution.value[b])
    .map(b => ({ belt: b, count: beltDistribution.value[b] }))
})

const journeyTotal = computed(() => classDetail.value?.journey_total ?? 60)
const journeyDone = computed(() => classDetail.value?.journey_done ?? 0)

const benchData = computed(() => {
  if (!classReport.value) return { class: 0, school: 0, course: 0 }
  const totalSec = classReport.value.class.total_practice_seconds
  const studentCount = classReport.value.class.active_students || classData.value.student_count || 1
  const classMin = Math.round(totalSec / 60 / Math.max(1, studentCount))

  const fromAvg = (avg: ClassReport['schoolAvg']): number => {
    if (!avg) return 0
    return Math.round(avg.avg_cycles_per_session * 0.6)
  }

  return {
    class: classMin,
    school: fromAvg(classReport.value.schoolAvg),
    course: fromAvg(classReport.value.courseAvg),
  }
})

const filteredStudents = computed(() => {
  if (!searchQuery.value.trim()) return students.value
  const q = searchQuery.value.toLowerCase()
  return students.value.filter(s => s.name.toLowerCase().includes(q))
})

async function loadReport(classId: string) {
  classReport.value = await getClassReport(classId)
}

onMounted(() => {
  const classId = classIdParam.value
  if (classId && selectedUser.value) {
    fetchClassDetail(classId)
    loadReport(classId)
  } else if (!classId) {
    const stored = sessionStorage.getItem('ssi-class-detail')
    if (!stored) router.push({ name: 'classes' })
  }
})

watch(selectedUser, (newUser) => {
  const classId = classIdParam.value
  if (newUser && classId) {
    fetchClassDetail(classId)
    loadReport(classId)
  }
})

function handleBack() {
  // Govt drill-down returns to the school dashboard (viewingSchool stays set),
  // everyone else to the classes list.
  if (backToSchool.value) {
    router.push('/schools')
  } else {
    router.push({ name: 'classes' })
  }
}

function handlePlay() {
  // Launch the player inside the schools surface so the SchoolsTopBar stays
  // above it (teacher keeps classroom context while running a session).
  // The /schools/play route renders PlayerContainer as a child of
  // SchoolsContainer.
  localStorage.setItem('ssi-last-course', classData.value.course_code)
  localStorage.setItem('ssi-active-class', JSON.stringify({
    id: classData.value.id,
    name: classData.value.class_name,
    course_code: classData.value.course_code,
    current_seed: classData.value.current_seed,
    timestamp: new Date().toISOString(),
  }))
  router.push({ path: '/schools/play', query: { class: classData.value.id } })
}

// Same /redeem/:code door as every other invite in the app (group leader,
// school admin, teacher — SchoolsSetup.vue's schoolAdminInviteLink). The
// underlying invite_codes row is unchanged (code_type: 'student',
// max_uses: null) — many students redeem the same link, it's just delivered
// as a link instead of a bare code now.
const classJoinLink = computed(() => `${window.location.origin}/redeem/${classData.value.join_code}`)

async function copyJoinLink() {
  try {
    await navigator.clipboard.writeText(classJoinLink.value)
    copySuccess.value = true
    setTimeout(() => { copySuccess.value = false }, 2000)
  } catch {
    /* ignore */
  }
}

async function copyJoinCode() {
  try {
    await navigator.clipboard.writeText(classData.value.join_code)
    codeCopySuccess.value = true
    setTimeout(() => { codeCopySuccess.value = false }, 2000)
  } catch {
    /* ignore */
  }
}

async function handleRemoveStudent(student: { user_id: string; name: string }) {
  if (!confirm(`Remove ${student.name} from this class?`)) return
  const supabase = getSchoolsClient()
  const { error } = await supabase
    .from('user_tags')
    .update({ removed_at: new Date().toISOString() })
    .eq('user_id', student.user_id)
    .eq('tag_type', 'class')
    .eq('tag_value', `CLASS:${classData.value.id}`)
    .is('removed_at', null)
  if (!error) fetchClassDetail(classData.value.id)
}

// Rename the class. classes now grants authenticated UPDATE (the create-class
// grant fix), so a direct client update works — mirrors the native-dialog
// pattern used by handleRemoveStudent above.
async function renameClass() {
  const next = (window.prompt('Rename class', classData.value.class_name) || '').trim()
  if (!next || next === classData.value.class_name) return
  const supabase = getSchoolsClient()
  const { error } = await supabase
    .from('classes')
    .update({ class_name: next })
    .eq('id', classData.value.id)
  if (error) {
    console.error('[ClassDetail] rename failed:', error)
    window.alert('Could not rename the class. Please try again.')
    return
  }
  fetchClassDetail(classData.value.id)
}
</script>

<template>
  <main class="detail">
    <nav class="breadcrumb">
      <a href="#" @click.prevent="handleBack">{{ backToSchool ? (viewingSchool?.school_name || 'School') : 'Classes' }}</a>
      <span class="crumb-sep">/</span>
      <span class="crumb-current">{{ classData.class_name }}</span>
    </nav>

    <header class="page-head">
      <div class="page-head-text">
        <div class="schools-kicker page-eyebrow">{{ courseLabel }}</div>
        <h1 class="arsenal page-title">
          {{ classData.class_name }}
          <button
            type="button"
            title="Rename class"
            aria-label="Rename class"
            @click="renameClass"
            style="margin-left:10px;background:none;border:none;cursor:pointer;color:var(--schools-fg-3);vertical-align:middle;padding:4px;"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
        </h1>
        <div class="meta-row">
          <span class="meta-belt">
            <BeltDot :belt="classBelt" :size="12" ring />
            {{ classBelt.charAt(0).toUpperCase() + classBelt.slice(1) }} belt class
          </span>
          <span class="meta-dot">·</span>
          <span>{{ students.length }} students</span>
          <span class="meta-dot">·</span>
          <span>Position {{ classData.current_seed }}</span>
        </div>
      </div>

      <div class="page-head-actions">
        <button v-if="!isAdminView" type="button" class="btn-play btn-play-lg" @click="handlePlay">
          <span class="play-glyph">&#9654;</span>
          Play as class
        </button>
      </div>
    </header>

    <div class="body-grid">
      <section class="roster schools-card">
        <header class="roster-head">
          <h3 class="arsenal roster-title">Roster</h3>
          <div class="roster-tools">
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Search students..."
              class="roster-search"
            />
          </div>
        </header>

        <div class="roster-scroll">
          <table class="ssi-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Belt</th>
                <th>Seeds</th>
                <th>Practice</th>
                <th>Last active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in filteredStudents" :key="s.id">
                <td>
                  <div class="student-cell">
                    <div class="avatar">{{ s.initials }}</div>
                    <div class="student-info">
                      <div class="student-name">{{ s.name }}</div>
                      <div class="student-sub">
                        <HealthDot :health="s.health" />
                        <span>{{ s.health.replace('-', ' ') }}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="belt-cell">
                    <BeltDot :belt="s.belt" :size="14" />
                    {{ s.belt }}
                  </span>
                </td>
                <td>{{ s.seeds_completed }}</td>
                <td>{{ s.hours7d }}h</td>
                <td><span class="schools-subtle">{{ s.last_active_display }}</span></td>
                <td class="row-action">
                  <button
                    v-if="!isAdminView"
                    type="button"
                    class="btn-ghost btn-small remove-btn"
                    @click="handleRemoveStudent({ user_id: s.user_id, name: s.name })"
                  >
                    Remove
                  </button>
                </td>
              </tr>
              <tr v-if="filteredStudents.length === 0">
                <td colspan="6" class="empty-row">
                  <span v-if="searchQuery">No students match "{{ searchQuery }}"</span>
                  <span v-else>No students have joined this class yet.</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside class="rail">
        <div class="schools-card schools-card-pad rail-card">
          <div class="schools-kicker rail-kicker">Course Journey</div>
          <JourneyBar :done="journeyDone" :total="journeyTotal" label="Course Journey" />
          <p class="rail-note">
            {{ classAvgSeeds }} seeds avg across the class.<br />
            Next milestone: seed {{ Math.min(journeyTotal, journeyDone + 10) }}.
          </p>
        </div>

        <div class="schools-card schools-card-pad rail-card">
          <div class="schools-kicker rail-kicker">Belt distribution</div>
          <BeltStrip
            v-if="students.length > 0"
            :distribution="beltDistribution"
            :height="8"
          />
          <div v-if="students.length > 0" class="belt-legend">
            <div
              v-for="row in beltDistributionOrdered"
              :key="row.belt"
              class="belt-legend-item"
            >
              <BeltDot :belt="row.belt" :size="20" ring />
              <div class="arsenal belt-legend-count">{{ row.count }}</div>
              <div class="belt-legend-label">{{ row.belt }}</div>
            </div>
          </div>
          <p v-else class="rail-note schools-subtle">No students enrolled yet.</p>
        </div>

        <div class="schools-card schools-card-pad rail-card">
          <div class="schools-kicker rail-kicker">Practice min/student/week</div>
          <Bench v-if="classReport" :data="benchData" unit="m" />
          <p v-else class="rail-note schools-subtle">Benchmark loading...</p>
        </div>

        <div class="schools-card schools-card-pad rail-card join-card">
          <div class="schools-kicker join-kicker">Invite students</div>
          <p class="join-help">
            Share this link — students click it, sign up, and land straight in the class.
          </p>
          <button
            type="button"
            class="btn-ghost btn-small join-copy"
            :class="{ copied: copySuccess }"
            @click="copyJoinLink"
          >
            {{ copySuccess ? 'Copied' : 'Copy invite link' }}
          </button>

          <button
            v-if="!showCode"
            type="button"
            class="btn-text join-show-code"
            @click="showCode = true"
          >
            Show code instead
          </button>
          <template v-else>
            <div class="join-code">{{ classData.join_code }}</div>
            <p class="join-help join-help-small">
              For writing on a whiteboard — students enter it at
              <strong>saysomethingin.com/redeem</strong>.
            </p>
            <button
              type="button"
              class="btn-ghost btn-small join-copy"
              :class="{ copied: codeCopySuccess }"
              @click="copyJoinCode"
            >
              {{ codeCopySuccess ? 'Copied' : 'Copy code' }}
            </button>
          </template>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.detail {
  padding: 18px 32px 32px;
  max-width: 1320px;
  margin: 0 auto;
}

.breadcrumb {
  font-size: 12.5px;
  color: var(--schools-fg-2);
  margin-bottom: 10px;
}
.breadcrumb a {
  color: inherit;
  text-decoration: none;
}
.breadcrumb a:hover { color: var(--schools-red); }
.crumb-sep { margin: 0 8px; opacity: 0.4; }
.crumb-current { color: var(--schools-fg); }

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.page-head-text { min-width: 280px; flex: 1; }

.page-eyebrow {
  color: var(--schools-red);
  margin-bottom: 6px;
}

.page-title {
  font-size: 34px;
  line-height: 1.05;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--schools-fg-2);
  margin-top: 8px;
  flex-wrap: wrap;
}

.meta-belt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.meta-dot { opacity: 0.3; }

.page-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-play-lg {
  padding: 12px 22px;
  font-size: 14.5px;
}

.play-glyph {
  font-size: 11px;
  line-height: 1;
}

.body-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 14px;
}

.roster {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 640px;
}

.roster-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--schools-border);
}

.roster-title { font-size: 17px; }

.roster-search {
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fafaf6;
  font-family: var(--font-body);
  width: 200px;
  color: var(--schools-fg);
}

.roster-search:focus {
  outline: none;
  border-color: var(--schools-red);
  background: #fff;
}

.roster-scroll {
  overflow: auto;
  flex: 1;
}

.student-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #eee;
  color: #555;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.student-info {
  min-width: 0;
  line-height: 1.3;
}

.student-name {
  font-weight: 600;
  font-size: 13.5px;
}

.student-sub {
  font-size: 11px;
  color: var(--schools-fg-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-transform: capitalize;
}

.belt-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-transform: capitalize;
}

.row-action { text-align: right; }

.remove-btn:hover {
  color: var(--schools-red-deep);
  border-color: var(--schools-red-deep);
}

.empty-row {
  text-align: center;
  padding: 40px 16px;
  color: var(--schools-fg-2);
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rail-card {
  display: flex;
  flex-direction: column;
}

.rail-kicker {
  margin-bottom: 8px;
}

.rail-note {
  font-size: 12px;
  color: var(--schools-fg-2);
  margin-top: 8px;
  line-height: 1.5;
}

.belt-legend {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  gap: 8px;
  flex-wrap: wrap;
}

.belt-legend-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.belt-legend-count {
  font-size: 18px;
  line-height: 1;
}

.belt-legend-label {
  font-size: 10.5px;
  color: var(--schools-fg-2);
  text-transform: capitalize;
}

.join-card {
  background: #fdf6df;
  border-color: #f0d97a;
}

.join-kicker {
  color: #7a5418;
}

.join-code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 22px;
  letter-spacing: 0.1em;
  color: var(--schools-fg);
  margin-top: 4px;
}

.join-help {
  font-size: 12px;
  color: #5a3e10;
  margin-top: 6px;
  line-height: 1.5;
}

.join-copy {
  align-self: flex-start;
  margin-top: 10px;
}

.join-copy.copied {
  background: var(--schools-success);
  border-color: var(--schools-success);
  color: #fff;
}

.join-show-code {
  align-self: flex-start;
  margin-top: 10px;
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: #7a5418;
  text-decoration: underline;
  cursor: pointer;
}

.join-help-small {
  margin-top: 8px;
}

@media (max-width: 960px) {
  .detail { padding: 16px; }
  .body-grid { grid-template-columns: 1fr; }
  .roster { max-height: none; }
  .roster-scroll { overflow-x: auto; }
  .ssi-table { min-width: 640px; }
}
</style>
