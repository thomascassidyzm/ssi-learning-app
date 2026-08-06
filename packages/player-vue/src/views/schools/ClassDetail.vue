<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData, type ClassReport, type ClassDeleteImpact } from '@/composables/schools/useClassesData'
import { useTeachersData, type TeacherOption } from '@/composables/schools/useTeachersData'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { getSchoolsClient } from '@/composables/schools/client'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import BeltStrip from '@/components/schools/shared/BeltStrip.vue'
import JourneyBar from '@/components/schools/shared/JourneyBar.vue'
import Bench from '@/components/schools/shared/Bench.vue'
import HealthDot from '@/components/schools/shared/HealthDot.vue'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'
import WalkOffer from '@/components/admin/WalkOffer.vue'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import { getLanguageName } from '@/composables/useI18n'
import { deriveBelt, BELTS, type Belt } from '@/composables/schools/belts'
import { usePlayAsClass } from '@/composables/schools/usePlayAsClass'
import { useSchoolsNav } from '@/composables/schools/useSchoolsNav'

type Health = 'excellent' | 'good' | 'needs-attention' | 'inactive'

const router = useRouter()
const route = useRoute()

const isAdminView = inject<boolean>('isAdminView', false)
const { schoolsLink } = useSchoolsNav()
const { currentUser: selectedUser, isGovtAdmin } = useSchoolContext()
const {
  classDetail,
  isLoading: classDetailLoading,
  error: classDetailError,
  fetchClassDetail,
  getClassReport,
  renameClass: renameClassApi,
  fetchClassDeleteImpact,
  deleteClass: deleteClassApi,
  addClassTeacher,
  removeClassTeacher,
} = useClassesData()
const { fetchClassTeacherCandidates } = useTeachersData()
const { viewingSchool } = useSchoolData()
const { canPlayAsClass, launchClassSession, playError } = usePlayAsClass()

// When a govt admin drilled group → school → class, "back" should return to
// the school dashboard, not the (empty for them) classes list.
const backToSchool = computed(() => isGovtAdmin.value && !!viewingSchool.value)

const classReport = ref<ClassReport | null>(null)
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
      last_lego_id: classDetail.value.last_lego_id || null,
      join_code: classDetail.value.student_join_code || 'N/A',
      class_learner_id: classDetail.value.class_learner_id || null,
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
        last_lego_id: parsed.last_lego_id || null,
        join_code: parsed.student_join_code || '',
        class_learner_id: parsed.class_learner_id || null,
      }
    } catch { /* fall through */ }
  }
  return { id: '', class_name: '', course_code: '', student_count: 0, current_seed: 1, last_lego_id: null, join_code: '', class_learner_id: null }
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

// Customer-facing copy never says "seed" (position-is-LEGO ruling) — belt
// thresholds are internally seed-cardinality (BELTS' `min`), but the rail
// note surfaces only the LEGO average and the belt-remaining count, mirroring
// StudentProgressView.vue's own "X more to your Y belt" phrasing, which never
// names the unit either.
const classAvgLegos = computed(() => {
  const list = classDetail.value?.students ?? []
  if (!list.length) return 0
  return Math.round(list.reduce((s, x) => s + x.legos_mastered, 0) / list.length)
})

const nextBeltInfo = computed(() => {
  const idx = BELTS.findIndex(b => b.key === classBelt.value)
  const next = BELTS[idx + 1]
  if (!next) return null
  return { name: next.name, remaining: Math.max(0, next.min - classAvgSeeds.value) }
})

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

// The ONE refresh protocol: reload this class's detail + report on demand via
// the navbar button / pull-to-refresh. No polling — the class view holds still.
async function loadClass(): Promise<void> {
  const classId = classIdParam.value
  if (classId && selectedUser.value) {
    await Promise.all([fetchClassDetail(classId), loadReport(classId)])
  }
}
const { registerRefresh, refresh } = useDashboardRefresh()
registerRefresh(loadClass, { immediate: false })

onMounted(() => {
  const classId = classIdParam.value
  if (classId && selectedUser.value) {
    void refresh()
  } else if (!classId) {
    const stored = sessionStorage.getItem('ssi-class-detail')
    // Admin-aware: never fall back into the member /schools tree (see handleBack).
    if (!stored) router.push(isAdminView ? schoolsLink('classes') : { name: 'classes' })
  }
})

watch(selectedUser, (newUser) => {
  const classId = classIdParam.value
  if (newUser && classId) {
    fetchClassDetail(classId)
    loadReport(classId)
  }
})

// Vue Router reuses this component instance across two `class-detail` routes
// that only differ by :id/:classId (e.g. an admin paging through several
// classes in the same school) — onMounted does NOT fire again, so without
// this the previous class's data stays on screen under the new URL.
watch(classIdParam, (classId, previousClassId) => {
  if (classId && classId !== previousClassId && selectedUser.value) {
    fetchClassDetail(classId)
    loadReport(classId)
  }
})

function handleBack() {
  // In the ssi_admin read-view this component is mounted under
  // /admin/schools/:id/classes/:classId. Hardcoded learner routes ('/schools',
  // { name: 'classes' }) resolve into the member /schools tree, whose guard
  // ejects platform admins to /admin/structure — the bounce founder-reported
  // 2026-07-19 (e.g. after deleting a class). Route through schoolsLink so the
  // admin stays on its own /admin/schools/:id surface. Learner paths unchanged.
  if (isAdminView) {
    router.push(schoolsLink(backToSchool.value ? 'schools-list' : 'classes'))
    return
  }
  // Govt drill-down returns to the school dashboard (viewingSchool stays set),
  // everyone else to the classes list.
  if (backToSchool.value) {
    router.push('/schools')
  } else {
    router.push({ name: 'classes' })
  }
}

// classData falls back to an EMPTY shell ({ id: '', course_code: '' }) while
// the detail fetch is in flight — the button stays disabled until the class
// is genuinely launchable, and launchClassSession refuses regardless.
const canLaunch = computed(() => !!classData.value.id && !!classData.value.course_code)

async function handlePlay() {
  await launchClassSession(classData.value)
}

// Same /redeem/:code door as every other invite in the app (group leader,
// school admin, teacher — AdminStructure.vue's schoolAdminInviteLink). The
// underlying invite_codes row is unchanged (code_type: 'student',
// max_uses: null) — many students redeem the same link, it's just delivered
// as a link instead of a bare code now.
const classJoinLink = computed(() => `${window.location.origin}/redeem/${classData.value.join_code}`)

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

// Rename the class via the server-mediated endpoint (api/school/rename-class)
// — a direct client `classes.update()` has no ownership check at all (classes
// is RLS-off by design), so ownership is enforced server-side instead.
async function renameClass() {
  const next = (window.prompt('Rename class', classData.value.class_name) || '').trim()
  if (!next || next === classData.value.class_name) return
  const ok = await renameClassApi(classData.value.id, next)
  if (!ok) {
    window.alert('Could not rename the class. Please try again.')
    return
  }
  fetchClassDetail(classData.value.id)
}

// Delete the class — the reported gap ("a teacher can't delete a class they
// set up wrongly"). api/school/delete-class.ts enforces ownership; this view
// just drives the confirm modal off its impact preview / real-activity flag.
const showDeleteModal = ref(false)
const deleteImpact = ref<ClassDeleteImpact | null>(null)
const isDeletingClass = ref(false)
const deleteClassError = ref('')

async function openDeleteModal() {
  deleteClassError.value = ''
  deleteImpact.value = await fetchClassDeleteImpact(classData.value.id)
  showDeleteModal.value = true
}

function closeDeleteModal() {
  showDeleteModal.value = false
  deleteClassError.value = ''
}

async function confirmDeleteClass(typedName: string) {
  isDeletingClass.value = true
  deleteClassError.value = ''
  const result = await deleteClassApi(classData.value.id, typedName || undefined)
  isDeletingClass.value = false
  if (!result.ok) {
    if (result.impact) deleteImpact.value = result.impact
    deleteClassError.value = result.error
    return
  }
  showDeleteModal.value = false
  handleBack()
}

// ── Co-teachers ───────────────────────────────────────────────────────────
// A class can be taught by several teachers (user_tags class/teacher rows,
// surfaced by the class_teachers view); classes.teacher_user_id is only a
// denormalised LEAD pointer. The data model has been plural since 2026-06-13
// and the write endpoint has shipped — this panel is the missing button.
const teacherCandidates = ref<TeacherOption[]>([])
const teacherPanelError = ref('')
const teacherBusy = ref(false)
const showAddTeacher = ref(false)
const pickedTeacherId = ref('')

const teacherNames = computed(() => {
  const map = new Map<string, string>()
  for (const t of teacherCandidates.value) map.set(t.user_id, t.display_name)
  return map
})

const classTeachers = computed(() => {
  const list = classDetail.value?.teachers ?? []
  return [...list]
    .map(t => ({
      user_id: t.user_id,
      is_lead: t.is_lead,
      // Never invent a name: an unresolved teacher shows as unnamed rather
      // than silently vanishing from the list.
      name: teacherNames.value.get(t.user_id) || 'Unnamed teacher',
      is_me: t.user_id === selectedUser.value?.user_id,
    }))
    .sort((a, b) => (Number(b.is_lead) - Number(a.is_lead)) || a.name.localeCompare(b.name))
})

// Candidates minus the people already on the class.
const addableTeachers = computed(() => {
  const already = new Set((classDetail.value?.teachers ?? []).map(t => t.user_id))
  return teacherCandidates.value.filter(t => !already.has(t.user_id))
})

async function loadTeacherCandidates(): Promise<void> {
  const classId = classIdParam.value
  if (!classId || isAdminView) return
  const { candidates, error } = await fetchClassTeacherCandidates(classId)
  teacherCandidates.value = candidates
  // A failed lookup is REPORTED, not shown as an empty picker — an empty list
  // and a broken list must never look the same to a teacher.
  teacherPanelError.value = error ? `Couldn't load the staff list. ${error}` : ''
}

async function addTeacher(): Promise<void> {
  const targetUserId = pickedTeacherId.value
  if (!targetUserId || teacherBusy.value) return
  teacherBusy.value = true
  teacherPanelError.value = ''
  const result = await addClassTeacher(classData.value.id, targetUserId)
  teacherBusy.value = false
  if (!result.ok) {
    teacherPanelError.value = `Couldn't add that teacher. ${result.error ?? ''}`.trim()
    return
  }
  pickedTeacherId.value = ''
  showAddTeacher.value = false
  await fetchClassDetail(classData.value.id)
}

async function removeTeacher(teacher: { user_id: string; name: string }): Promise<void> {
  if (teacherBusy.value) return
  if (!confirm(`Remove ${teacher.name} from this class? They keep their account — they just stop seeing this class.`)) return
  teacherBusy.value = true
  teacherPanelError.value = ''
  const result = await removeClassTeacher(classData.value.id, teacher.user_id)
  teacherBusy.value = false
  if (!result.ok) {
    teacherPanelError.value = `Couldn't remove that teacher. ${result.error ?? ''}`.trim()
    return
  }
  await fetchClassDetail(classData.value.id)
}

// Lead handover falls straight out of the existing endpoint: `add` with
// set_lead on someone already on the class is idempotent and just moves the
// lead pointer.
async function makeLead(teacher: { user_id: string; name: string }): Promise<void> {
  if (teacherBusy.value) return
  teacherBusy.value = true
  teacherPanelError.value = ''
  const result = await addClassTeacher(classData.value.id, teacher.user_id, { lead: true })
  teacherBusy.value = false
  if (!result.ok) {
    teacherPanelError.value = `Couldn't hand over the lead. ${result.error ?? ''}`.trim()
    return
  }
  await fetchClassDetail(classData.value.id)
}

onMounted(loadTeacherCandidates)
watch(classIdParam, (classId, previous) => {
  if (classId && classId !== previous) {
    teacherCandidates.value = []
    teacherPanelError.value = ''
    void loadTeacherCandidates()
  }
})

const deleteImpactLines = computed(() => {
  const impact = deleteImpact.value
  if (!impact) return []
  const lines: string[] = []
  if (impact.learnerCount) lines.push(`${impact.learnerCount} student${impact.learnerCount === 1 ? '' : 's'}`)
  if (impact.teacherCount) lines.push(`${impact.teacherCount} teacher${impact.teacherCount === 1 ? '' : 's'}`)
  if (impact.sessionCount) lines.push(`${impact.sessionCount} recorded session${impact.sessionCount === 1 ? '' : 's'}`)
  return lines
})
</script>

<template>
  <main class="detail">
    <nav class="breadcrumb">
      <a href="#" @click.prevent="handleBack">{{ backToSchool ? (viewingSchool?.school_name || 'School') : 'Classes' }}</a>
      <span class="crumb-sep">/</span>
      <span class="crumb-current">{{ classData.class_name }}</span>
    </nav>

    <div v-if="playError" class="fetch-error-banner">
      <span>{{ playError }}</span>
    </div>

    <header class="page-head">
      <div class="page-head-text">
        <div class="schools-kicker page-eyebrow">{{ courseLabel }}</div>
        <h1 class="arsenal page-title">
          {{ classData.class_name }}
          <button
            v-if="!isAdminView"
            type="button"
            title="Rename class"
            aria-label="Rename class"
            @click="renameClass"
            style="margin-left:10px;background:none;border:none;cursor:pointer;color:var(--schools-fg-3);vertical-align:middle;padding:4px;"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button
            v-if="!isAdminView"
            type="button"
            title="Delete class"
            aria-label="Delete class"
            @click="openDeleteModal"
            style="margin-left:2px;background:none;border:none;cursor:pointer;color:var(--schools-fg-3);vertical-align:middle;padding:4px;"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </h1>
        <div class="meta-row">
          <span class="meta-belt">
            <BeltDot :belt="classBelt" :size="12" ring />
            {{ classBelt.charAt(0).toUpperCase() + classBelt.slice(1) }} belt class
          </span>
          <span class="meta-dot">·</span>
          <span>{{ students.length }} students</span>
          <template v-if="classData.last_lego_id">
            <span class="meta-dot">·</span>
            <span>Position {{ classData.last_lego_id }}</span>
          </template>
          <span class="meta-dot">·</span>
          <UpdatedStamp />
        </div>
      </div>

      <div class="page-head-actions">
        <WalkOffer v-if="!isAdminView" persona="teacher" place="class-detail" />
        <button v-if="canPlayAsClass" type="button" class="btn-play btn-play-lg" data-walk="class-play" :disabled="!canLaunch" @click="handlePlay">
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
                <th>LEGOs</th>
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
                <td>{{ s.legos_mastered }}</td>
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
              <tr v-if="filteredStudents.length === 0 && searchQuery">
                <td colspan="6" class="empty-row">No students match "{{ searchQuery }}"</td>
              </tr>
              <tr v-else-if="filteredStudents.length === 0 && classDetailLoading">
                <td colspan="6" class="empty-row schools-subtle">Loading roster…</td>
              </tr>
              <tr v-else-if="filteredStudents.length === 0 && classDetailError">
                <td colspan="6" class="empty-row">Couldn't load roster. {{ classDetailError }}</td>
              </tr>
              <tr v-else-if="filteredStudents.length === 0">
                <td colspan="6" class="empty-row">No students have joined this class yet.</td>
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
            {{ classAvgLegos }} LEGOs mastered avg across the class.<br />
            <template v-if="nextBeltInfo">{{ nextBeltInfo.remaining }} more to {{ nextBeltInfo.name }} belt.</template>
            <template v-else>Reached Black belt — top of the ladder.</template>
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
          <p v-else-if="classDetailLoading" class="rail-note schools-subtle">Loading…</p>
          <p v-else class="rail-note schools-subtle">No students enrolled yet.</p>
        </div>

        <div class="schools-card schools-card-pad rail-card">
          <div class="schools-kicker rail-kicker">Practice min/student/week</div>
          <Bench v-if="classReport" :data="benchData" unit="m" />
          <p v-else class="rail-note schools-subtle">Benchmark loading...</p>
        </div>

        <div v-if="!isAdminView" class="schools-card schools-card-pad rail-card">
          <div class="schools-kicker rail-kicker">Teachers</div>

          <ul v-if="classTeachers.length" class="teacher-list">
            <li v-for="t in classTeachers" :key="t.user_id" class="teacher-row">
              <span class="teacher-name">
                {{ t.name }}<span v-if="t.is_me" class="teacher-you"> (you)</span>
                <span v-if="t.is_lead" class="teacher-lead">lead</span>
              </span>
              <span class="teacher-actions">
                <button
                  v-if="!t.is_lead"
                  type="button"
                  class="btn-text teacher-action"
                  :disabled="teacherBusy"
                  @click="makeLead(t)"
                >
                  Make lead
                </button>
                <button
                  type="button"
                  class="btn-text teacher-action teacher-action-remove"
                  :disabled="teacherBusy"
                  @click="removeTeacher(t)"
                >
                  Remove
                </button>
              </span>
            </li>
          </ul>
          <p v-else-if="classDetailLoading" class="rail-note schools-subtle">Loading…</p>
          <p v-else class="rail-note schools-subtle">No teachers are linked to this class yet.</p>

          <template v-if="!showAddTeacher">
            <button type="button" class="btn-ghost btn-small teacher-add-open" @click="showAddTeacher = true">
              Add a co-teacher
            </button>
          </template>
          <template v-else>
            <select v-model="pickedTeacherId" class="teacher-select" :disabled="teacherBusy">
              <option value="">Choose a teacher…</option>
              <option v-for="t in addableTeachers" :key="t.user_id" :value="t.user_id">
                {{ t.display_name }}
              </option>
            </select>
            <p v-if="!addableTeachers.length" class="rail-note schools-subtle">
              Nobody else on the staff list yet — a colleague has to join the school before you can share the class with them.
            </p>
            <div class="teacher-add-actions">
              <button type="button" class="btn-ghost btn-small" :disabled="!pickedTeacherId || teacherBusy" @click="addTeacher">
                {{ teacherBusy ? 'Adding…' : 'Add' }}
              </button>
              <button type="button" class="btn-text teacher-action" :disabled="teacherBusy" @click="showAddTeacher = false; pickedTeacherId = ''">
                Cancel
              </button>
            </div>
          </template>

          <p v-if="teacherPanelError" class="teacher-error">{{ teacherPanelError }}</p>
        </div>

        <div v-if="!isAdminView" class="schools-card schools-card-pad rail-card join-card">
          <div class="schools-kicker join-kicker">Invite students</div>
          <p class="join-help">
            Share this link — students click it, sign up, and land straight in the class.
          </p>
          <div data-walk="class-join-link"><InviteLinkField :url="classJoinLink" /></div>

          <button
            v-if="!showCode"
            type="button"
            class="btn-text join-show-code"
            data-walk="class-join-code"
            @click="showCode = true"
          >
            Show code instead
          </button>
          <template v-else>
            <div class="join-code" data-walk="class-join-code">{{ classData.join_code }}</div>
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

    <ConfirmDeleteModal
      :is-open="showDeleteModal"
      title="Delete class"
      :target-name="classData.class_name"
      :impact-lines="deleteImpactLines"
      :require-typed-confirm="!!deleteImpact?.hasRealActivity"
      :submitting="isDeletingClass"
      :error="deleteClassError"
      @close="closeDeleteModal"
      @confirm="confirmDeleteClass"
    />
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

.fetch-error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--schools-red);
  border: 1px solid rgba(var(--tone-red, 194, 58, 58), 0.28);
  background: rgba(var(--tone-red, 194, 58, 58), 0.06);
  border-radius: 8px;
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

.teacher-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.teacher-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.teacher-name { min-width: 0; }
.teacher-you { color: var(--schools-fg-2); }

.teacher-lead {
  margin-left: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--schools-red);
  border: 1px solid var(--schools-border);
  border-radius: 4px;
  padding: 1px 5px;
}

.teacher-actions {
  display: inline-flex;
  gap: 8px;
  flex: none;
}

.teacher-action {
  background: none;
  border: none;
  padding: 0;
  font-size: 11.5px;
  color: var(--schools-fg-2);
  text-decoration: underline;
  cursor: pointer;
}

.teacher-action:disabled { opacity: 0.5; cursor: default; }
.teacher-action-remove:hover { color: var(--schools-red-deep); }

.teacher-add-open {
  align-self: flex-start;
  margin-top: 12px;
}

.teacher-select {
  margin-top: 12px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-family: var(--font-body);
  border: 1px solid var(--schools-border);
  border-radius: 6px;
  background: #fafaf6;
  color: var(--schools-fg);
}

.teacher-add-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.teacher-error {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--schools-red);
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
