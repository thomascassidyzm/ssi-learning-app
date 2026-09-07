<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData, type ClassReport, type ClassDeleteImpact, type StudentCandidate } from '@/composables/schools/useClassesData'
import { useTeachersData, type TeacherOption } from '@/composables/schools/useTeachersData'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import AssignClassesModal from '@/components/schools/AssignClassesModal.vue'
import {
  computeAssignmentDiff,
  applyAssignmentDiff,
  summariseOutcomes,
  type AssignableClass,
  type AssignmentOutcome,
} from '@/composables/schools/assignTeacherClasses'
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
import { redeemLink } from '@/composables/schools/inviteLink'
import { teacherPanelState, joinPanelState } from './classDetailPanels'

type Health = 'excellent' | 'good' | 'needs-attention' | 'inactive'

const router = useRouter()
const route = useRoute()

const isAdminView = inject<boolean>('isAdminView', false)
const { schoolsLink } = useSchoolsNav()
const { currentUser: selectedUser, isGovtAdmin, isSchoolAdmin } = useSchoolContext()
const {
  classDetail,
  isLoading: classDetailLoading,
  error: classDetailError,
  rosterError,
  teachersError,
  teachersLoaded,
  fetchClassDetail,
  getClassReport,
  renameClass: renameClassApi,
  fetchClassDeleteImpact,
  deleteClass: deleteClassApi,
  addClassTeacher,
  removeClassTeacher,
  fetchAddableStudents,
  addClassStudent,
  createCoTeacherLink,
  classes,
  fetchClasses,
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

// An empty class has exactly one thing worth doing, and the invite link was
// the LAST card of the rail — below the teachers panel, the roster, the course
// journey, the belt distribution and the benchmark. On a phone that is the
// bottom of the page (production walk, 2026-08-31). Observed-empty only: a
// roster still loading, or one that failed, must not reorder the page.
const rosterObservedEmpty = computed(
  () => !classDetailLoading.value && !rosterError.value && !classDetailError.value && students.value.length === 0,
)

const filteredStudents = computed(() => {
  if (!searchQuery.value.trim()) return students.value
  const q = searchQuery.value.toLowerCase()
  return students.value.filter(s => s.name.toLowerCase().includes(q))
})

// class_activity_stats is one of the views that times out for a non-lead
// co-teacher, and getClassReport returns null for both "failed" and "no data".
// Track that it RESOLVED, so the panel stops saying "loading" forever.
const reportResolved = ref(false)

async function loadReport(classId: string) {
  reportResolved.value = false
  classReport.value = await getClassReport(classId)
  reportResolved.value = true
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
//
// It is built ONLY when the code is genuinely present. On production
// (2026-08-07) a cover teacher saw `…/redeem/` with the code missing, because
// an unrelated view timed out and the template interpolated an empty string —
// a dead link she would have handed to a class of pupils. The panel now holds
// itself back rather than offering something that goes nowhere.
const joinPanel = computed(() => joinPanelState({
  joinCode: classData.value.join_code,
  loading: classDetailLoading.value || (!classDetail.value && !classDetailError.value),
  error: classDetailError.value,
}))

async function copyJoinCode() {
  const code = joinPanel.value.code
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
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

// What the TEACHERS panel is allowed to say. "No teachers are linked to this
// class yet" is an assertion about the world, so it may only be made when the
// class_teachers read actually came back clean and empty — never because it
// failed or has not resolved (production, 2026-08-07: two teachers, and the
// panel said nobody).
const teacherListState = computed(() => teacherPanelState({
  count: classTeachers.value.length,
  loaded: teachersLoaded.value,
  error: teachersError.value,
}))

// Who may change WHO TEACHES this class — founder ruling 2026-08-06: "any
// group leader or the current teacher of the class can add the co-teacher".
// A co-teacher teaches the class but does not recruit into it, so they are not
// shown a verb the server would refuse. The server is the real gate
// (api/_utils/classTeacherAuth.ts); this only keeps the panel honest.
const canManageTeachers = computed(() => {
  if (isGovtAdmin.value || isSchoolAdmin.value) return true
  return classTeachers.value.some(t => t.is_me && t.is_lead)
})

// ── "…and their other classes" ─────────────────────────────────────────────
// The class page answers "who teaches THIS class?". A leader standing on it
// also needs the other direction — "put this teacher on 7A as well", or "move
// them off 6B" — and Tom went looking for exactly that here and found nothing
// (staging, 2026-08-08). Rather than send them to another page to finish a
// thought they started here, the same AssignClassesModal the Teachers page
// uses is mounted on the teacher's row. Same composable, same endpoint, same
// authorisation: only the entry point is new.
const assignTarget = ref<{ user_id: string; name: string } | null>(null)
const assignBusy = ref(false)
const assignOutcomes = ref<AssignmentOutcome[]>([])
const assignSummary = ref('')

// Which classes the teacher is already on comes from the class list we
// already fetch — ClassInfo.teachers IS the class_teachers relationship.
const assignClasses = computed<AssignableClass[]>(() => {
  const target = assignTarget.value?.user_id
  return classes.value
    .filter(c => c.is_active !== false)
    .map(c => {
      const on = c.teachers ?? []
      return {
        id: c.id,
        class_name: c.class_name,
        isMember: !!target && on.some(t => t.user_id === target),
        hasActiveTeacher: on.length > 0,
      }
    })
})

// An empty class list and an unreadable one must never look alike.
const assignLoadError = computed(() =>
  classDetailError.value
    ? `Couldn't load this school's classes, so this list may be incomplete. ${classDetailError.value}`
    : '',
)

function openAssign(teacher: { user_id: string; name: string }): void {
  assignTarget.value = { user_id: teacher.user_id, name: teacher.name }
  assignOutcomes.value = []
  assignSummary.value = ''
  fetchClasses()
}

function closeAssign(): void {
  assignTarget.value = null
  assignOutcomes.value = []
  assignSummary.value = ''
}

async function handleAssignConfirm(tickedClassIds: string[]): Promise<void> {
  const target = assignTarget.value
  if (!target || assignBusy.value) return
  const current = assignClasses.value.filter(c => c.isMember).map(c => c.id)
  const diff = computeAssignmentDiff(current, tickedClassIds)
  if (!diff.add.length && !diff.remove.length) return

  assignBusy.value = true
  assignOutcomes.value = []
  assignSummary.value = ''
  const outcomes = await applyAssignmentDiff({
    teacherUserId: target.user_id,
    diff,
    classes: assignClasses.value,
    addClassTeacher,
    removeClassTeacher,
  })
  assignBusy.value = false
  assignOutcomes.value = outcomes
  assignSummary.value = summariseOutcomes(outcomes, target.name)

  // Refetch both, because this modal can remove the teacher from the class
  // being displayed behind it — the panel underneath must not keep showing
  // someone who has just been taken off. A partial save stays visibly partial.
  await Promise.all([
    fetchClasses(),
    classData.value.id ? fetchClassDetail(classData.value.id) : Promise.resolve(),
  ])
  for (const o of outcomes) {
    if (!o.ok) console.error(`[ClassDetail] class-teacher ${o.action} failed for ${target.name} on ${o.className}:`, o.error)
  }
}

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

// The class-scoped co-teacher link — the supply-teacher lane. Unlike the
// student join code, this is minted on demand rather than standing: it puts
// one colleague into THIS class and its school, and never moves the lead.
const coTeacherLink = ref('')
const coTeacherLinkBusy = ref(false)

async function mintCoTeacherLink(): Promise<void> {
  if (coTeacherLinkBusy.value || !classData.value.id) return
  coTeacherLinkBusy.value = true
  teacherPanelError.value = ''
  const result = await createCoTeacherLink(classData.value.id)
  coTeacherLinkBusy.value = false
  if (!result.ok || !result.code) {
    teacherPanelError.value = `Couldn't create a co-teacher link. ${result.error ?? ''}`.trim()
    return
  }
  // Same rule as the student link: a code-less URL is never shown.
  const link = redeemLink(result.code)
  if (!link) {
    teacherPanelError.value = "Couldn't create a co-teacher link. The server returned no code."
    return
  }
  coTeacherLink.value = link
}

onMounted(loadTeacherCandidates)
watch(classIdParam, (classId, previous) => {
  if (classId && classId !== previous) {
    teacherCandidates.value = []
    teacherPanelError.value = ''
    coTeacherLink.value = ''
    void loadTeacherCandidates()
  }
})

// ── Adding students ───────────────────────────────────────────────────────
// The reported gap, in the owner's words: "adding students to a class is not
// obvious — no clear flow for it on the class page". There WAS a way in — the
// join link — but it is addressed to the pupil, not to the teacher, and it
// cannot help with the pupil who is already in the school and simply in the
// wrong set. So the class page now carries the teacher's own door, on the
// roster, which is the thing the teacher is looking at when the need arises.
//
// One control, one degree of freedom: tap to open, type to narrow, tap a name
// to put them in. No drag, no multi-select, no second screen.
const showAddStudent = ref(false)
const studentCandidates = ref<StudentCandidate[]>([])
const candidatesLoaded = ref(false)
const addStudentError = ref('')
const addStudentSearch = ref('')
const addingStudentId = ref('')
const justAddedName = ref('')

const filteredCandidates = computed(() => {
  const q = addStudentSearch.value.trim().toLowerCase()
  if (!q) return studentCandidates.value
  return studentCandidates.value.filter(c => c.display_name.toLowerCase().includes(q))
})

// What the picker is allowed to SAY. "Nobody left to add" is an assertion about
// the school, so it may only be made once the lookup has actually come back
// clean — never because it failed or has not resolved (the same rule the
// teachers panel and the join card already keep).
const candidateListState = computed<'loading' | 'error' | 'empty' | 'ready'>(() => {
  if (addStudentError.value) return 'error'
  if (!candidatesLoaded.value) return 'loading'
  return studentCandidates.value.length ? 'ready' : 'empty'
})

async function openAddStudent(): Promise<void> {
  showAddStudent.value = true
  addStudentSearch.value = ''
  justAddedName.value = ''
  await loadCandidates()
}

// On a COLD load of the class URL the class id arrives after the page paints —
// the same late arrival that once left the co-teacher-link button sitting dead.
// A picker opened in that window has no class to ask about, so it waits here
// and asks the moment the class lands, rather than reading "looking up…"
// forever (walked on a real class page, 2026-09-07).
watch(() => classData.value.id, (id) => {
  if (id && showAddStudent.value && !candidatesLoaded.value) void loadCandidates()
})

function closeAddStudent(): void {
  showAddStudent.value = false
  addStudentSearch.value = ''
  justAddedName.value = ''
}

async function loadCandidates(): Promise<void> {
  const classId = classData.value.id
  if (!classId) return  // the watcher above calls back when the class arrives
  candidatesLoaded.value = false
  addStudentError.value = ''
  const { candidates, error } = await fetchAddableStudents(classId)
  studentCandidates.value = candidates
  candidatesLoaded.value = !error
  addStudentError.value = error ? `Couldn't load the school's students. ${error}` : ''
}

async function addStudent(candidate: StudentCandidate): Promise<void> {
  if (addingStudentId.value) return
  addingStudentId.value = candidate.user_id
  addStudentError.value = ''
  const result = await addClassStudent(classData.value.id, candidate.user_id)
  addingStudentId.value = ''
  if (!result.ok) {
    addStudentError.value = `Couldn't add ${candidate.display_name}. ${result.error ?? ''}`.trim()
    return
  }
  // The panel stays open — a teacher moving a set adds several in a row — but
  // the person who has just moved leaves the list and is named above it, so the
  // page never leaves you guessing whether the tap landed.
  justAddedName.value = candidate.display_name
  studentCandidates.value = studentCandidates.value.filter(c => c.user_id !== candidate.user_id)
  // The search has done its job. Left standing it says "nobody matches aadhya"
  // directly under "Aadhya Verma is in this class now", which reads as a
  // contradiction of itself.
  addStudentSearch.value = ''
  await fetchClassDetail(classData.value.id)
}

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
          <!-- HANDBOOK Rename a class
               section: running-classes
               roles: leader, school_admin, teacher
               place: class-detail
               keywords: class, rename, name, edit, title
               What it's for. Changing what a class is called, for a name typed in a
               hurry or a group that has moved up a year.
               Where it is. The class page, the small pencil beside the class name.
               How you do it.
               1. Open the class from **My Classes**.
               2. Tap the pencil next to the name at the top.
               3. Type the new name.
               4. Confirm it.
               Worth knowing. Only the name changes. The roster, the join link, the
               join code and the class's place on the course all carry on exactly as
               they were.
               checked: 4d2f2218.79ed7bb4
          -->
          <button
            v-if="!isAdminView"
            type="button"
            title="Rename class"
            aria-label="Rename class"
            data-walk="class-rename"
            @click="renameClass"
            style="margin-left:10px;background:none;border:none;cursor:pointer;color:var(--schools-fg-3);vertical-align:middle;padding:4px;"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <!-- HANDBOOK Delete a class
               section: running-classes
               roles: leader, school_admin, teacher
               place: class-detail
               keywords: class, delete, remove, close, archive
               What it's for. Removing a class you no longer want, usually one set up
               by mistake or a group that has finished. Before anything is deleted
               the app tells you what goes with it.
               Where it is. The class page, the small bin beside the class name.
               How you do it.
               1. Open the class from **My Classes**.
               2. Tap the bin next to the name at the top.
               3. Read the list of what will go with the class.
               4. If the class has real practice behind it, type the class name to
                  confirm you mean it.
               5. Confirm the deletion.
               Worth knowing. Students keep their own accounts and everything they
               have learned. What goes is the class itself, its roster and its join
               link.
               checked: d4143519.a0456621
          -->
          <button
            v-if="!isAdminView"
            type="button"
            title="Delete class"
            aria-label="Delete class"
            data-walk="class-delete"
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
          <!-- Same rule as the panels: with the roster unread, "0 students" is
               an assertion we have no basis for. -->
          <span v-if="rosterError || classDetailError">student count unavailable</span>
          <span v-else>{{ students.length }} students</span>
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
        <!-- HANDBOOK Run your first class session
             section: running-classes
             roles: school_admin, teacher
             place: class-detail
             keywords: session, play, class, run, join, code
             walk: run-class-session
             What it's for. Running a live practice session with a class in the room,
             everyone hearing the same thing at the same time.
             Where it is. The class page, the join link and the play button.
             How you do it.
             1. Open the class from My Classes.
             2. Put the join link or the join code on the screen for the room.
             3. Wait for the students to arrive on their own devices.
             4. Tap play to start the session.
             Worth knowing. The join code is the same code all lesson, so a student
             arriving late still gets in.
             checked: 5290f872.e182c56c
        -->
        <button v-if="canPlayAsClass" type="button" class="btn-play btn-play-lg" data-walk="class-play" :disabled="!canLaunch" @click="handlePlay">
          <span class="play-glyph">&#9654;</span>
          Play as class
        </button>
      </div>
    </header>

      <!-- Who teaches this class sits ABOVE the roster, at full width, on every
           viewport. It used to be the FOURTH card in the right-hand rail, and
           at =<960px the grid collapses to one column and drops the rail below
           the whole student table — so on a phone the only way to reach it was
           to scroll past every pupil in the class and three other cards. Tom
           went looking for it on staging on 2026-08-08 and concluded the
           feature did not exist. It did; it was just last in the reading order.
           A class's staff outranks its belt histogram, so this is also the
           right order on a desktop. -->
      <div v-if="!isAdminView" class="schools-card schools-card-pad rail-card teachers-card" data-walk="class-teachers">
        <div class="schools-kicker rail-kicker">Teachers</div>

        <ul v-if="teacherListState === 'ready'" class="teacher-list">
          <li v-for="t in classTeachers" :key="t.user_id" class="teacher-row">
            <span class="teacher-name">
              {{ t.name }}<span v-if="t.is_me" class="teacher-you"> (you)</span>
              <span v-if="t.is_lead" class="teacher-lead">lead</span>
            </span>
            <span class="teacher-actions">
              <!-- The other direction, from the same row: which OTHER classes
                   does this person take? Moving them off this class and onto
                   another is one untick and one tick in here. -->
              <!-- HANDBOOK Move a teacher to another class
                   section: running-classes
                   roles: leader, school_admin, teacher
                   place: class-detail
                   keywords: move, teacher, classes, assign, timetable
                   walk: move-a-teacher-between-classes
                   What it's for. Changing which classes a teacher is on, in one
                   pass, without visiting each class in turn.
                   Where it is. The class page, the **Teachers** section, a
                   teacher's other classes.
                   How you do it.
                   1. Open a class the teacher is on.
                   2. Scroll to **Teachers** and open their other classes.
                   3. Tick the classes they should be on and untick the ones they
                      should not.
                   4. Save.
                   Worth knowing. Untick and save is how you take a teacher off a
                   class — there is no separate remove.
                   checked: 0cd7063d.6e7979d0
              -->
              <button
                v-if="canManageTeachers"
                type="button"
                class="btn-text teacher-action"
                data-walk="class-teacher-other-classes"
                :disabled="teacherBusy"
                @click="openAssign(t)"
              >
                Other classes
              </button>
              <!-- HANDBOOK Hand a class over to another teacher
                   section: running-classes
                   roles: leader, school_admin, teacher
                   place: class-detail
                   keywords: lead, hand over, class, teacher, transfer
                   walk: hand-over-the-lead
                   What it's for. Passing the lead of a class to another teacher
                   who already teaches it — for a maternity cover, a term swap,
                   or a permanent handover.
                   Where it is. The class page, the **Teachers** section.
                   How you do it.
                   1. Open the class from My Classes.
                   2. Scroll to **Teachers**.
                   3. Find the colleague who should lead it.
                   4. Tap **Make lead** on their row.
                   Worth knowing. You stay on the class as a teacher. Only the
                   lead changes.
                   checked: 2ede673e.3fde2189
              -->
              <button
                v-if="!t.is_lead && canManageTeachers"
                type="button"
                class="btn-text teacher-action"
                data-walk="class-teacher-make-lead"
                :disabled="teacherBusy"
                @click="makeLead(t)"
              >
                Make lead
              </button>
              <button
                v-if="canManageTeachers || t.is_me"
                type="button"
                class="btn-text teacher-action teacher-action-remove"
                :disabled="teacherBusy"
                @click="removeTeacher(t)"
              >
                {{ canManageTeachers ? 'Remove' : 'Leave' }}
              </button>
            </span>
          </li>
        </ul>
        <p v-else-if="teacherListState === 'loading'" class="rail-note schools-subtle">Loading the teacher list…</p>
        <p v-else-if="teacherListState === 'error'" class="rail-note schools-subtle">
          Couldn't load the teacher list, so we can't show who teaches this class. Try refreshing.
        </p>
        <p v-else class="rail-note schools-subtle">No teachers are linked to this class yet.</p>

        <template v-if="!canManageTeachers">
          <p class="rail-note schools-subtle">
            You teach this class alongside its lead teacher. Only the lead teacher or a
            school leader can bring another colleague in.
          </p>
        </template>
        <template v-else-if="!showAddTeacher">
          <!-- Tom's own words for this are "add a second teacher" and "belong
               to multiple classes", so the button says teacher, not
               co-teacher, and the line under it states the rule in plain
               English rather than leaving a head to infer it. -->
          <!-- HANDBOOK Share a class with a colleague
               section: running-classes
               roles: leader, school_admin, teacher
               place: class-detail
               keywords: class, share, co-teacher, colleague, teachers
               walk: share-a-class
               What it's for. Adding another teacher to a class you already run, so
               you both see the same roster and the same progress.
               Where it is. The class page, the **Teachers** section.
               How you do it.
               1. Open the class from My Classes.
               2. Scroll to **Teachers**.
               3. Tap **Add a teacher**.
               4. Pick your colleague from the list.
               Worth knowing. Both of you are teachers of the class. One of you is
               the lead, and the lead is the one the school's lists show first.
               checked: ab5f2d72.35a5bb74
          -->
          <button type="button" class="btn-ghost btn-small teacher-add-open" data-walk="class-teacher-add" @click="showAddTeacher = true">
            Add another teacher
          </button>
          <p class="rail-note schools-subtle">
            A class can have as many teachers as you like, and a teacher can take
            as many classes as you like. Use <strong>Other classes</strong> on
            anyone above to put them on another class, or to move them off this one.
          </p>
        </template>
        <template v-else>
          <select v-model="pickedTeacherId" class="teacher-select" data-walk="class-teacher-picker" :disabled="teacherBusy">
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

        <!-- HANDBOOK Invite a teacher who isn't here yet
             section: running-classes
             roles: leader, school_admin, teacher
             place: class-detail
             keywords: supply, cover, teacher, invite, class, link
             walk: invite-a-supply-teacher
             What it's for. Getting a teacher who has no account yet into one class of
             yours, without going through the school admin.
             Where it is. The class page, the **Teachers** section.
             How you do it.
             1. Open the class from My Classes.
             2. Scroll to **Teachers**.
             3. Take the co-teacher link.
             4. Send it to them — opening it puts them on this class as a teacher.
             Worth knowing. The link is scoped to this one class, so a cover teacher
             never lands in the rest of the school.
             checked: d27e7961.73889552
        -->
        <div v-if="canManageTeachers" class="teacher-link-block" data-walk="class-coteacher-link">
          <p class="rail-note schools-subtle">
            Colleague not on the staff list yet? Send them a link into this class.
          </p>
          <InviteLinkField v-if="coTeacherLink" :url="coTeacherLink" />
          <button
            v-else
            type="button"
            class="btn-ghost btn-small"
            :disabled="coTeacherLinkBusy || !classData.id"
            :title="!classData.id ? 'Waiting for the class to load' : undefined"
            @click="mintCoTeacherLink"
          >
            <!-- On a cold direct load of the class URL this button is gated on
                 classData.id, which arrives late. Say so rather than sitting
                 dead and unexplained (production run, 2026-08-07). -->
            {{ coTeacherLinkBusy ? 'Creating…' : (!classData.id ? 'Loading the class…' : 'Create a co-teacher link') }}
          </button>
        </div>

        <p v-if="teacherPanelError" class="teacher-error">{{ teacherPanelError }}</p>
      </div>

    <div class="body-grid">
      <!-- HANDBOOK The class roster
           section: seeing-progress
           roles: leader, school_admin, teacher
           place: class-detail
           keywords: roster, students, progress, belt, last active
           parts: class-roster-empty
           What it's for. Everyone in the class, one row each, with their belt, how much
           they have learned, how much they have practised and when they were last at it.
           This is the answer to who is quietly drifting.
           Where it is. The class page, the **Roster** table.
           How you do it.
           1. Open the class from **My Classes**.
           2. Read down the mark under each name, which flags anyone behind the class or
              long gone quiet.
           3. Type a name into the search box to jump to one student.
           4. Compare a student's practice against the class average shown in the rail
              beside the table.
           Worth knowing. A student who has never started shows as inactive rather than
           as behind, because nothing has happened yet to judge. A class nobody has
           joined yet shows its empty places instead of a table, with **Add students**
           in it.
           checked: 9e190afc.6717ecd4
      -->
      <section class="roster schools-card" data-walk="class-roster">
        <header class="roster-head">
          <h3 class="arsenal roster-title">Roster</h3>
          <div class="roster-tools">
            <!-- One search at a time: nothing to search in an empty class, and
                 while the picker is open ITS box is the one you mean. -->
            <input
              v-if="!rosterObservedEmpty && !showAddStudent"
              v-model="searchQuery"
              type="search"
              placeholder="Search students..."
              class="roster-search"
            />
            <!-- HANDBOOK Add students to a class
                 section: getting-people-in
                 roles: leader, school_admin, teacher
                 place: class-detail
                 keywords: add, student, class, roster, move, join
                 parts: class-student-picker
                 What it's for. Putting a pupil who is already in your school
                 into this class, for a pupil who has changed set or landed in
                 the wrong class.
                 Where it is. The class page, the **Add students** button at the
                 top of the roster.
                 How you do it.
                 1. Open the class from **My Classes**.
                 2. Tap **Add students** above the roster.
                 3. Type a few letters of the name to narrow the list.
                 4. Tap the pupil. They appear on the roster straight away.
                 5. Add as many as you need, then tap **Done**.
                 Worth knowing. The list holds the pupils in your school who are
                 not in this class yet, and shows the class each of them is in
                 now. A pupil brings everything they have already learned with
                 them. For a pupil with no account at all, use the class link in
                 **Invite students** instead.
                 checked: e36b80b5.8096ea88
            -->
            <button
              v-if="!isAdminView"
              type="button"
              class="btn-ghost btn-small roster-add"
              data-walk="class-student-add"
              @click="showAddStudent ? closeAddStudent() : openAddStudent()"
            >
              {{ showAddStudent ? 'Done' : 'Add students' }}
            </button>
          </div>
        </header>

        <!-- The picker: search, then tap a name. It sits INSIDE the roster
             card, directly under the button that opened it, so the thing you
             are changing is the thing you are looking at. -->
        <div v-if="showAddStudent && !isAdminView" class="add-student-panel" data-walk="class-student-picker">
          <input
            v-model="addStudentSearch"
            type="search"
            class="roster-search add-student-search"
            placeholder="Search your school's students..."
          />

          <p v-if="justAddedName" class="add-student-note add-student-done">
            {{ justAddedName }} is in this class now.
          </p>

          <ul v-if="candidateListState === 'ready'" class="add-student-list">
            <li v-for="c in filteredCandidates" :key="c.user_id">
              <button
                type="button"
                class="add-student-row"
                :disabled="!!addingStudentId"
                @click="addStudent(c)"
              >
                <span class="avatar avatar-small">{{ getInitials(c.display_name) }}</span>
                <span class="add-student-name">
                  {{ c.display_name }}
                  <span v-if="c.current_class_name" class="add-student-where">{{ c.current_class_name }}</span>
                </span>
                <span class="add-student-verb">{{ addingStudentId === c.user_id ? 'Adding…' : 'Add' }}</span>
              </button>
            </li>
            <li v-if="filteredCandidates.length === 0" class="add-student-note schools-subtle">
              Nobody in your school matches "{{ addStudentSearch }}".
            </li>
          </ul>
          <p v-else-if="candidateListState === 'loading'" class="add-student-note schools-subtle">
            Looking up your school's students…
          </p>
          <p v-else-if="candidateListState === 'error'" class="add-student-note">{{ addStudentError }}</p>
          <p v-else class="add-student-note schools-subtle">
            Everyone in your school is already in this class. For a student who has no account
            yet, share the class link from <strong>Invite students</strong>.
          </p>

          <p v-if="candidateListState === 'ready' && addStudentError" class="add-student-note">{{ addStudentError }}</p>
        </div>

        <!-- An empty class is DRAWN empty — six empty places, the shape the
             roster will take — rather than a table of headings with a sentence
             under it. The two doors sit right in it: the pupils already in the
             school, and the link for the ones who have no account yet. -->
        <div v-if="rosterObservedEmpty" class="roster-empty" data-walk="class-roster-empty">
          <div class="empty-seats" aria-hidden="true">
            <span v-for="n in 6" :key="n" class="empty-seat"></span>
          </div>
          <p class="empty-line">Nobody is in this class yet.</p>
          <button
            v-if="!isAdminView && !showAddStudent"
            type="button"
            class="btn-ghost btn-small"
            @click="openAddStudent"
          >
            Add students
          </button>
          <p v-if="!isAdminView" class="empty-sub schools-subtle">
            Or share the class link in <strong>Invite students</strong> — students who follow it
            sign up and land straight in this class.
          </p>
        </div>

        <div v-else class="roster-scroll">
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
                  <!-- HANDBOOK Remove a student from a class
                       section: running-classes
                       roles: leader, school_admin, teacher
                       place: class-detail
                       keywords: remove, student, roster, leave, class
                       What it's for. Taking a student off a class roster,
                       for a pupil who has changed set or joined the wrong
                       class from a shared link.
                       Where it is. The class page, the **Remove** button at
                       the end of the student's row in the roster.
                       How you do it.
                       1. Open the class from **My Classes**.
                       2. Find the student in the roster.
                       3. Tap **Remove** at the end of their row.
                       4. Confirm when asked.
                       Worth knowing. The student keeps their account and
                       everything they have learned, and they can join
                       another class straight away. Only their place on this
                       roster goes.
                       checked: 8f3eea39.0523415f
                  -->
                  <button
                    v-if="!isAdminView"
                    type="button"
                    class="btn-ghost btn-small remove-btn"
                    data-walk="class-student-remove"
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
              <tr v-else-if="filteredStudents.length === 0 && (rosterError || classDetailError)">
                <td colspan="6" class="empty-row">Couldn't load roster. {{ rosterError || classDetailError }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- The rail used to jump ABOVE the roster on an empty class, because the
           invite link was the only thing worth doing and it was the bottom of
           the page. The roster now carries the doing itself — the empty places,
           "Add students", and a pointer at the invite card — so it stays first
           and the rail stays a rail. The join card still rises to the top of it. -->
      <aside class="rail">
        <!-- HANDBOOK Where the class has got to
             section: seeing-progress
             roles: leader, school_admin, teacher
             place: class-detail
             keywords: progress, journey, belt, position, course
             What it's for. How far the class has travelled through its course, as a
             bar with the class average behind it and the next belt named. A class
             carries its own place on the course, moved by the sessions you run
             together.
             Where it is. The class page, the **Course Journey** card in the column
             beside the roster.
             How you do it.
             1. Open the class from **My Classes**.
             2. Read the bar for how much of the course the class has covered.
             3. Read the line under it for the class average and how far it is to the
                next belt.
             4. Compare that with the belt spread underneath, which shows how tightly
                the class is travelling together.
             Worth knowing. The class average is the honest number for planning a
             lesson. The belt spread is the one that tells you whether the class is
             holding together or pulling apart.
             checked: a95511dd.c7baf113
        -->
        <div class="schools-card schools-card-pad rail-card" data-walk="class-journey">
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
          <p v-else-if="rosterError || classDetailError" class="rail-note schools-subtle">Couldn't load the roster, so this is unknown.</p>
          <p v-else class="rail-note schools-subtle">No students enrolled yet.</p>
        </div>

        <div class="schools-card schools-card-pad rail-card">
          <div class="schools-kicker rail-kicker">Practice min/student/week</div>
          <Bench v-if="classReport" :data="benchData" unit="m" />
          <p v-else-if="reportResolved" class="rail-note schools-subtle">Benchmark unavailable for this class.</p>
          <p v-else class="rail-note schools-subtle">Benchmark loading...</p>
        </div>


        <div v-if="!isAdminView" class="schools-card schools-card-pad rail-card join-card" :class="{ 'join-card-first': rosterObservedEmpty }">
          <div class="schools-kicker join-kicker">Invite students</div>

          <!-- Nothing copyable exists until the code does: a link with the code
               missing gets handed to a class of pupils before anyone finds out
               it goes nowhere (production, 2026-08-07). -->
          <template v-if="joinPanel.state === 'ready'">
            <p class="join-help">
              Share this link — students click it, sign up, and land straight in the class.
            </p>
            <!-- HANDBOOK How students join a class
                 section: getting-people-in
                 roles: leader, school_admin, teacher
                 place: class-detail
                 keywords: join, link, code, students, invite, class
                 What it's for. The one door into a class. A student who follows
                 the class link signs up and lands straight in the class, on the
                 right course, with no code to type. The same class also has a
                 short code for a room where a link is awkward.
                 Where it is. The class page, the **Invite students** card.
                 How you do it.
                 1. Open the class from **My Classes**.
                 2. Copy the link from the **Invite students** card and send it to
                    your students.
                 3. For a room with a whiteboard, tap **Show code instead** and
                    write the code up.
                 4. Students enter that code at saysomethingin.com/redeem.
                 Worth knowing. The link and the code both stay valid, so the same
                 one works for a student who joins in week one and a student who
                 arrives in week six. If the card says it could not load, do not
                 hand anything out until it comes back.
                 checked: bc4a8a6b.deda81a9
            -->
            <div v-if="joinPanel.url" data-walk="class-join-link"><InviteLinkField :url="joinPanel.url" /></div>

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
              <div class="join-code" data-walk="class-join-code">{{ joinPanel.code }}</div>
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
          </template>
          <p v-else-if="joinPanel.state === 'loading'" class="join-help schools-subtle">
            Loading this class's invite link…
          </p>
          <p v-else-if="joinPanel.state === 'error'" class="join-help schools-subtle">
            Couldn't load this class's invite link. Refresh before sharing anything — don't hand
            out a link from this page until it appears.
          </p>
          <p v-else class="join-help schools-subtle">
            This class has no join code yet.
          </p>
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

    <AssignClassesModal
      :is-open="!!assignTarget"
      :teacher-name="assignTarget?.name ?? ''"
      :classes="assignClasses"
      :loading="classDetailLoading"
      :load-error="assignLoadError"
      :submitting="assignBusy"
      :outcomes="assignOutcomes"
      :summary="assignSummary"
      @close="closeAssign"
      @confirm="handleAssignConfirm"
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

/* Lifted out of the rail and given the page's own width — it no longer
   inherits the rail's flex gap, so it carries its own bottom margin. */
.teachers-card {
  margin-bottom: 14px;
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
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--schools-border);
}

/* Search and "Add students" sit on ONE line beside the title, and drop to a
   line of their own on a narrow phone rather than stacking on top of each
   other in the corner. */
.roster-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 220px;
  justify-content: flex-end;
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

.roster-add { white-space: nowrap; }

/* The picker. A list of names you tap — no dropdown, no multi-select. */
.add-student-panel {
  border-top: 1px solid var(--schools-border, rgba(0, 0, 0, 0.08));
  padding: 12px 0 4px;
  margin-bottom: 4px;
}
.add-student-search { width: 100%; margin-bottom: 8px; }
.add-student-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
}
.add-student-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 8px;
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}
.add-student-row:hover:not(:disabled) { background: var(--schools-hover, rgba(0, 0, 0, 0.04)); }
.add-student-row:disabled { opacity: 0.55; cursor: default; }
.add-student-name { flex: 1; min-width: 0; }
.add-student-where {
  display: block;
  font-size: 12px;
  color: var(--schools-fg-3);
}
.add-student-verb {
  font-size: 13px;
  color: var(--schools-fg-3);
}
.add-student-note { font-size: 13px; margin: 8px 2px 0; }
.add-student-done { color: var(--schools-fg-2, inherit); }
.avatar-small { width: 28px; height: 28px; font-size: 11px; }

/* An empty class, drawn. */
.roster-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 16px 32px;
  text-align: center;
}
.empty-seats { display: flex; gap: 10px; }
.empty-seat {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px dashed var(--schools-border, rgba(0, 0, 0, 0.16));
}
.empty-line { margin: 0; font-size: 15px; }
.empty-sub { margin: 0; font-size: 13px; max-width: 34ch; }

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

/* Empty class: the invite link leads the rail (and, on a phone, the page). */
.join-card-first { order: -1; }

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

.teacher-link-block {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--schools-line, rgba(44, 38, 34, 0.12));
}

.teacher-link-block .rail-note {
  margin: 0 0 8px;
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
