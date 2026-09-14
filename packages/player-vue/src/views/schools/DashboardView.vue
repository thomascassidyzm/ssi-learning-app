<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Greeting from '@/components/schools/shared/Greeting.vue'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { useClassesData, type ClassInfo } from '@/composables/schools/useClassesData'
import { fetchClassPractice7d, ClassPracticeFetchError, type ClassPractice7d } from '@/composables/schools/classPractice7d'
import { deriveBelt } from '@/composables/schools/belts'
import { useSchoolsDensity } from '@/composables/schools/useSchoolsDensity'
import { useGovtAdminActions } from '@/composables/schools/useGovtAdminActions'
import { useSchoolsNav } from '@/composables/schools/useSchoolsNav'
import { getLanguageName, useI18n } from '@/composables/useI18n'
import CreateClassModal from '@/components/schools/CreateClassModal.vue'
import SchoolsPasswordPrompt from '@/components/schools/SchoolsPasswordPrompt.vue'
import ClassCreatedModal from '@/components/schools/ClassCreatedModal.vue'
import MailboxCheckPrompt from '@/components/schools/MailboxCheckPrompt.vue'
import CopyPlaySweepCard from '@/components/schools/CopyPlaySweepCard.vue'
import { useMailboxPrompt } from '@/composables/useMailboxPrompt'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import { usePlayAsClass } from '@/composables/schools/usePlayAsClass'
import { missionsEnabled, startMission, useMission } from '@/missions/useMission'
import { redeemLink } from '@/composables/schools/inviteLink'
import { formatPracticeMinutes, secondsToMinutes } from '@/composables/schools/practiceMinutes'
import { useSchoolPractice7d } from '@/composables/schools/useSchoolPractice7d'

const { t } = useI18n()
const router = useRouter()
const { schoolsLink, isAdminView } = useSchoolsNav()
const { currentUser, isTeacher, isSchoolAdmin, isGovtAdmin } = useSchoolContext()

// Guided missions (dev/staging-gated prototype): quiet ghost affordance next
// to the teacher greeting while no mission is running.
const { status: missionStatus } = useMission()
const showMissionAffordance = computed(
  () => missionsEnabled() && !isAdminView && missionStatus.value === 'idle',
)
function handleTryMission() {
  startMission('find-struggling-student', router)
}

// THE VIEW (archive/docs-retired-2026-08-24/THE-VIEW.md): a group/region leader's landing IS their top
// node's home — the same recursive node surface the admin sees, server-scoped
// to their subtree, mounted at /org/:id. The group dashboard below
// remains only for legacy leaders with no group (region_code-only rows) and
// for the admin read-view mounts. Watch, not a one-shot: the container's
// loadFromAuth resolves the context async, so group_id can land after mount.
watch(
  currentUser,
  (u) => {
    if (isAdminView) return
    if (isGovtAdmin.value && u?.group_id) {
      void router.replace(`/org/${u.group_id}`)
    }
  },
  { immediate: true },
)

const { density } = useSchoolsDensity()
const { canPlayAsClass, launchClassSession, playError } = usePlayAsClass()

const {
  schools,
  currentSchool,
  groupSummary,
  viewingSchool,
  isViewingSchool,
  totalStudents,
  totalTeachers,
  totalClasses,
  totalPracticeMinutes,
  totalStaffPracticeMinutes,
  fetchSchools,
  confirmSchoolName,
  selectSchoolToView,
  clearViewingSchool,
  error: schoolsFetchError,
} = useSchoolData()

const {
  classes: teacherClasses,
  isLoading: classesLoading,
  fetchClasses,
  createClass,
  error: classesFetchError,
} = useClassesData()

const {
  links: schoolLinks,
  fetchSchoolLinks,
  createSchoolInMyGroup,
  renameGroup,
} = useGovtAdminActions()

// A failed refresh must never look like "up to date" — see SchoolsView.vue
// for the same fix on the govt-admin list screen.
const dashboardFetchError = computed(() => schoolsFetchError.value || classesFetchError.value)

// ---------- Govt admin: "name your group" first-run card ----------
const groupNameDraft = ref('')
const isSavingGroupName = ref(false)
const groupNameError = ref<string | null>(null)
const showNameGroupCard = computed(() =>
  isGovtAdmin.value && !isAdminView && !isViewingSchool.value && groupSummary.value?.name_confirmed === false
)

async function saveGroupName() {
  const name = groupNameDraft.value.trim()
  const groupId = groupSummary.value?.group_id
  if (!name || !groupId) return
  isSavingGroupName.value = true
  groupNameError.value = null
  const ok = await renameGroup(groupId, name)
  isSavingGroupName.value = false
  if (ok) {
    await fetchSchools()
  } else {
    groupNameError.value = t('schools.dashboard.couldNotSaveTryAgain', 'Could not save — try again.')
  }
}

// ---------- School admin: "confirm your school's name" first-run card ----------
// Invite-born admins land here with a name pre-filled from the inviting
// leader's guess (schools.name_confirmed=false) — editable before it sticks.
// Self-serve schools default name_confirmed=true and never see this card.
const schoolNameDraft = ref('')
const isSavingSchoolName = ref(false)
const schoolNameError = ref<string | null>(null)
const showNameSchoolCard = computed(() =>
  isSchoolAdmin.value && !isAdminView && currentSchool.value?.name_confirmed === false
)

watch(currentSchool, (school) => {
  if (school && !schoolNameDraft.value) schoolNameDraft.value = school.school_name || ''
}, { immediate: true })

async function saveSchoolName() {
  const name = schoolNameDraft.value.trim()
  const schoolId = currentSchool.value?.id
  if (!name || !schoolId) return
  isSavingSchoolName.value = true
  schoolNameError.value = null
  const ok = await confirmSchoolName(schoolId, name)
  isSavingSchoolName.value = false
  if (!ok) schoolNameError.value = t('schools.dashboard.couldNotSaveTryAgain', 'Could not save — try again.')
}

// ---------- Govt admin: create school directly (the only creation
// primitive — region-tier-design.md §5c-revised 2026-07-13). The school row
// is created immediately, group-attached, with both join codes registered
// at birth — no separate "invite/onboard" concept any more. ----------
const isCreatingSchool = ref(false)
const newSchoolLabel = ref('')
const createdSchoolLinks = ref<{ admin_join_code: string; teacher_join_code: string } | null>(null)
const copiedLinkId = ref<string | null>(null)

// Never render a /redeem/ link without its code (see inviteLink.ts).
function schoolInviteUrl(code: string | null | undefined): string | null {
  return redeemLink(code)
}

async function copyLink(id: string, code: string) {
  try {
    const url = schoolInviteUrl(code)
    if (!url) return
    await navigator.clipboard.writeText(url)
    copiedLinkId.value = id
    setTimeout(() => { if (copiedLinkId.value === id) copiedLinkId.value = null }, 2000)
  } catch {
    /* ignore */
  }
}

async function handleCreateSchool() {
  const name = newSchoolLabel.value.trim()
  if (!name) return
  isCreatingSchool.value = true
  createdSchoolLinks.value = null
  const result = await createSchoolInMyGroup(name)
  isCreatingSchool.value = false
  if (result) {
    createdSchoolLinks.value = result.school
    newSchoolLabel.value = ''
    await Promise.all([fetchSchools(), fetchSchoolLinks()])
  }
}

// ─── THE TEACHER'S NUMBERS ARE PLAY-AS-CLASS (job #651, Tom 2026-09-14).
// Until this change the teacher home totalled the pupils' individual accounts
// (class_activity_stats / class_student_progress — the roster spine) and
// benchmarked "cycles" off the same. At Ysgol Cas-gwent Chepstow, where the
// teacher plays from the front and no pupil has an account, that read
// "0 students · 0 min practised · 0 sessions" under a class whose teacher had
// run her lesson that week, and the school wrote in. The home now reads the
// SAME payload the classes list and the leader pages read
// (/api/school/class-practice-7d): each class's own account — minutes in the
// app this week, phrases practised, LEGOs travelled, last played — plus the
// caller's OWN account, so a lesson that landed on the teacher's own sign-in
// is named as such rather than vanishing. ───
const teacherPractice = ref<ClassPractice7d | null>(null)
const teacherPracticeError = ref<string | null>(null)
const teacherPracticeLoaded = computed(() => teacherPractice.value !== null)

async function loadTeacherPractice(): Promise<void> {
  const ids = teacherClasses.value.map((c) => c.id)
  if (ids.length === 0) { teacherPractice.value = null; return }
  try {
    teacherPractice.value = await fetchClassPractice7d(ids, currentUser.value)
    teacherPracticeError.value = null
  } catch (err) {
    // Loud, not silent (job #301): the rows say "not loaded", and the page says why.
    const status = err instanceof ClassPracticeFetchError ? err.status : 0
    const detail = err instanceof Error && err.message ? err.message : 'network error'
    teacherPracticeError.value = status ? `${detail} (HTTP ${status})` : detail
    teacherPractice.value = null
  }
}

function lastPlayedLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// One row per class, carrying TWO figures kept apart and never summed (Tom's
// ruling, 2026-09-14, job #662): minutesWk is the class account's own play,
// pupilsOwnMinutes the aggregate of the pupils' own accounts. `started` is null
// until the payload lands (the row says "loading"), false when the account
// has never played (the row says "Not started" in words, never zeros).
const teacherClassRows = computed(() => teacherClasses.value.map((c) => {
  const p = teacherPractice.value
  const acct = p?.classAccountByClass[c.id]
  const started: boolean | null = p ? (acct?.started ?? false) : null
  const minutesWk = p ? secondsToMinutes(p.classPlayByClass[c.id] ?? 0) : 0
  const pupilsOwnMinutes = p ? secondsToMinutes(p.practiceByClass[c.id] ?? 0) : 0
  return {
    ...c,
    started,
    minutesWk,
    pupilsOwnMinutes,
    phrases7d: acct?.phrases7d ?? 0,
    journeyDone: acct?.journeyDone ?? 0,
    journeyTotal: acct?.journeyTotal ?? 0,
    lastPractisedAt: acct?.lastPractisedAt ?? null,
    lastPlayed: lastPlayedLabel(acct?.lastPractisedAt),
    class_belt: deriveBelt(acct?.seedNumber ?? 0),
  }
}))

// The caller's own account this week — the number the Library shows them.
const ownPractice = computed(() => teacherPractice.value?.callerOwn ?? null)
const ownPracticeLine = computed(() => {
  const own = ownPractice.value
  if (!own || own.inAppMinutes7d <= 0) return ''
  const when = own.lastPlayedDay ? lastPlayedLabel(`${own.lastPlayedDay}T12:00:00Z`) : ''
  const base = when
    ? t('schools.dashboard.ownPracticeWhen', 'You practised {minutes} on your own account this week, last on {day}.')
        .replace('{minutes}', formatPracticeMinutes(own.inAppMinutes7d)).replace('{day}', when)
    : t('schools.dashboard.ownPractice', 'You practised {minutes} on your own account this week.')
        .replace('{minutes}', formatPracticeMinutes(own.inAppMinutes7d))
  return `${base} ${t('schools.dashboard.ownPracticeNote', 'That counts for you, not for a class. Use Play as class so a lesson counts for the class.')}`
})

// FOUNDER RULING (demo pass 2026-07-31): the dashboard's "+ Create class"
// buttons open the Create New Class modal RIGHT HERE. They used to navigate
// to My Classes, whose own button then opened the modal — a two-hop dead
// end. My Classes keeps its button and the ?create=1 deep link for users
// who navigate there; this is the same create flow, mounted in place.
const isCreateModalOpen = ref(false)
const isCreatingClass = ref(false)
const createClassError = ref<string | null>(null)
const createdClass = ref<ClassInfo | null>(null)
const isCreatedModalOpen = ref(false)

async function handleCreateClass(params: { class_name: string; course_code: string }) {
  if (isCreatingClass.value) return
  createClassError.value = null
  const schoolId = currentUser.value?.school_id ?? null
  // A school admin's account is always tied to a school — a missing id there
  // is a genuine data problem. A teacher with no school_id is a groupless
  // tutor (THE-MODEL §1.3/I5), not an error.
  if (!schoolId && isSchoolAdmin.value) {
    createClassError.value = t('schools.dashboard.noSchoolFoundForAccount', 'No school found for your account. Please contact an administrator.')
    return
  }
  isCreatingClass.value = true
  try {
    const newClass = await createClass({
      class_name: params.class_name,
      course_code: params.course_code,
      school_id: schoolId,
    })
    if (newClass) {
      isCreateModalOpen.value = false
      createdClass.value = newClass
      isCreatedModalOpen.value = true
    } else {
      createClassError.value = t('schools.dashboard.failedToCreateClass', 'Failed to create class. Please try again.')
    }
  } catch {
    createClassError.value = t('schools.dashboard.failedToCreateClass', 'Failed to create class. Please try again.')
  } finally {
    isCreatingClass.value = false
  }
}

function handleGoToCreatedClass() {
  if (createdClass.value) {
    isCreatedModalOpen.value = false
    sessionStorage.setItem('ssi-class-detail', JSON.stringify(createdClass.value))
    router.push({ path: schoolsLink('class-detail', { classId: createdClass.value.id }) })
  }
}

// The mailbox moment. A class has just been created and the teacher is about
// to send its link to real learners — the one beat where "make sure you can
// always get back to this" is true rather than administrative. See
// composables/useMailboxPrompt.ts for the rule about when this stays shut.
const mailboxPrompt = useMailboxPrompt()

function closeCreatedModal() {
  isCreatedModalOpen.value = false
  createdClass.value = null
  mailboxPrompt.noteKeepWorthyMoment()
}

// The ONE refresh protocol: one role-aware loader for the whole dashboard,
// driving the navbar button + pull-to-refresh. Initial load routes through it
// (spinner + honest "Updated HH:MM"). No polling — the dashboard holds still,
// even during a live class, until a deliberate refresh (founder ruling).
// The school leader's headline: minutes in the app this week and classes
// practising this week — the SAME figures, from the same server rule, as
// the internal admin's node home for this school (job #265).
const practice7d = useSchoolPractice7d()

async function loadDashboard(): Promise<void> {
  const user = currentUser.value
  if (!user) return
  await fetchSchools()
  if (isTeacher.value || isSchoolAdmin.value) {
    await Promise.all([
      fetchClasses().then(() => (isTeacher.value ? loadTeacherPractice() : Promise.resolve())),
      isSchoolAdmin.value ? practice7d.fetchRollup() : Promise.resolve(),
    ])
  }
  if (isGovtAdmin.value) {
    await fetchSchoolLinks()
    if (viewingSchool.value) await fetchClasses()
  }
}
const { registerRefresh, refresh } = useDashboardRefresh()
registerRefresh(loadDashboard, { immediate: false })

watch(currentUser, (user) => {
  if (user) void refresh()
}, { immediate: true })

// Govt admin drills into a school → load that school's classes (the classes
// composable scopes to the viewed school via activeSchoolId). Without this the
// detail view has no class data, since govt admins don't fetch classes at the
// group level. `immediate: true` matters here: selectSchoolToView() sets
// viewingSchool BEFORE the router.push that mounts this component, so a
// plain (non-immediate) watch never fires on this navigation — it only
// catches a LATER change while already mounted (e.g. clicking a different
// school from within the drill-down). Without immediate, the classes table
// stays empty until an unrelated re-render happens to touch viewingSchool.
watch(viewingSchool, (school) => {
  if (school && isGovtAdmin.value) {
    fetchClasses()
  }
}, { immediate: true })

// Was also duplicated here as an onMounted() with the identical currentUser
// check — the watch above already covers both cases (immediate: true fires
// it synchronously when currentUser is already populated at setup; the
// reactive callback fires it once currentUser resolves later), so the
// onMounted block only ever either double-fetched or did nothing. One
// mechanism, not two racing to fetch the same data.

// ---------- Display helpers ----------
const firstName = computed(() => {
  const name = currentUser.value?.display_name || ''
  // Link-auth accounts carry a machine placeholder ("link-<uuid>") until the
  // person sets a real name — never greet anyone with it.
  if (/^link-[0-9a-f]{8}/i.test(name)) return ''
  return name.split(/\s+/).filter(Boolean)[0] || ''
})

const greetingName = computed(() =>
  firstName.value
    ? t('schools.dashboard.welcomeBackName', 'Welcome back, {name}.').replace('{name}', firstName.value)
    : t('schools.dashboard.welcomeBack', 'Welcome back.'))

const todayLabel = computed(() => {
  const parts = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).split(' ')
  if (parts.length >= 3) return `${parts[0]} · ${parts[1]} ${parts[2]}`
  return parts.join(' ')
})

const schoolName = computed(() => {
  if (isViewingSchool.value && viewingSchool.value) return viewingSchool.value.school_name
  if (isGovtAdmin.value && groupSummary.value) return groupSummary.value.group_name
  return currentSchool.value?.school_name || currentUser.value?.school_name || t('schools.dashboard.yourSchool', 'Your School')
})

function courseDisplayName(code: string): string {
  const m = code?.match(/^([a-z_]+?)_for_/)
  return m ? getLanguageName(m[1]) : code
}

// Totals across the teacher's classes, this week: the class accounts' own
// play, and, kept apart and never added to it, what the pupils did on their
// OWN accounts. Both are always shown; a zero is said in words (Tom's ruling,
// 2026-09-14, job #662: "there wont be a lot of this at the moment").
const teacherStats = computed(() => {
  const rows = teacherClassRows.value
  return {
    classes: rows.length,
    minutes: rows.reduce((sum, c) => sum + c.minutesWk, 0),
    phrases: rows.reduce((sum, c) => sum + c.phrases7d, 0),
    students: teacherClasses.value.reduce((sum, c) => sum + (c.student_count || 0), 0),
    studentsOwnMinutes: rows.reduce((sum, c) => sum + c.pupilsOwnMinutes, 0),
  }
})

// The pupils' own-accounts line, always present once the payload has landed.
const pupilsOwnLine = computed(() => {
  if (!teacherPracticeLoaded.value) return ''
  const s = teacherStats.value
  if (s.studentsOwnMinutes <= 0) {
    return t('schools.dashboard.pupilsOwnAccountsNone', 'Nothing on pupils’ own accounts this week. That is usual for a class taught from the front.')
  }
  return t('schools.dashboard.studentsOwnAccountsLine', '{n} pupils on their own accounts · {minutes} on those accounts this week')
    .replace('{n}', String(s.students)).replace('{minutes}', formatPracticeMinutes(s.studentsOwnMinutes))
})

function pupilsOwnRowLabel(minutes: number): string {
  return minutes > 0
    ? t('schools.dashboard.pupilsOwnAccountsRow', 'pupils’ own accounts {minutes}').replace('{minutes}', formatPracticeMinutes(minutes))
    : t('schools.dashboard.pupilsOwnAccountsRowNone', 'nothing on pupils’ own accounts')
}

const greetingLines = computed(() => {
  const n = teacherClasses.value.length
  if (!n) return t('schools.dashboard.noClassesYetCreateOne', 'No classes yet — create one to get your students playing.')
  const base = n === 1
    ? t('schools.dashboard.oneClassOnTheGoPlain', 'One class on the go.')
    : t('schools.dashboard.classesOnTheGoPlain', '{n} classes on the go.').replace('{n}', String(n))
  if (!teacherPracticeLoaded.value) return base
  return t('schools.dashboard.onTheGoMinutesWeek', '{base} {minutes} in the app this week.')
    .replace('{base}', base)
    .replace('{minutes}', formatPracticeMinutes(teacherStats.value.minutes))
})

// MINUTES, never hours, on every school surface (Tom, 2026-09-11, job #265) —
// one formatter, composables/schools/practiceMinutes.ts.

// The honest "incl. X min staff practice" composition line under the group
// leader's all-time figure — shown only when staff minutes are nonzero, so
// that headline is never silently inflated (founder ruling 2026-07-18).
const staffPracticeNote = computed(() => {
  const minutes = totalStaffPracticeMinutes.value || 0
  if (minutes <= 0) return ''
  return t('schools.dashboard.inclStaffPractice', 'incl. {hours} staff practice')
    .replace('{hours}', formatPracticeMinutes(minutes))
})

// "X of Y classes practising this week" — the honest companion to the
// minutes headline; a dash while this week's figures have not loaded.
const classesPractisingLine = computed(() => {
  if (!practice7d.loaded.value) return ''
  return t('schools.dashboard.classesPractisingThisWeek', '{active} of {total} classes practising this week')
    .replace('{active}', String(practice7d.activeClassesThisWeek.value))
    .replace('{total}', String(practice7d.classCount.value))
})

const adminGreetingLines = computed(() => {
  const base = t('schools.dashboard.adminGreetingStudentsClasses', '{students} students across {classes} classes')
    .replace('{students}', String(totalStudents.value))
    .replace('{classes}', String(totalClasses.value))
  if (!practice7d.loaded.value) return base
  return t('schools.dashboard.adminGreetingMinutesWeek', '{base} — {minutes} in the app this week.')
    .replace('{base}', base)
    .replace('{minutes}', formatPracticeMinutes(practice7d.minutesThisWeek.value))
})

const breadcrumb = computed(() => {
  if (!isViewingSchool.value) return null
  return {
    group: groupSummary.value?.group_name || t('schools.dashboard.group', 'Group'),
    school: viewingSchool.value?.school_name || t('schools.dashboard.school', 'School'),
  }
})

// ---------- Actions ----------
async function handlePlayClass(cls: ClassInfo) {
  // One shared launch path (usePlayAsClass.launchClassSession): permission
  // check, consistent ssi-active-class payload, course switch, and the
  // /schools/play navigation all live there.
  await launchClassSession(cls)
}
</script>

<template>
  <div class="dashboard-view">
    <!-- A password is the one way back in that needs no inbox. -->
    <SchoolsPasswordPrompt />

    <!-- Govt drill-down breadcrumb -->
    <nav v-if="breadcrumb" class="dashboard-breadcrumb">
      <button class="breadcrumb-back" @click="clearViewingSchool">
        <span aria-hidden="true">←</span>
        <span>{{ breadcrumb.group }}</span>
      </button>
      <span class="breadcrumb-sep">·</span>
      <span class="breadcrumb-current">{{ breadcrumb.school }}</span>
    </nav>

    <div v-if="dashboardFetchError" class="fetch-error-banner">
      <span>{{ t('schools.dashboard.couldntRefreshDashboard', "Couldn't refresh this dashboard — showing the last data loaded. {error}").replace('{error}', String(dashboardFetchError)) }}</span>
      <button type="button" class="btn-ghost" @click="refresh">{{ t('schools.dashboard.retry', 'Retry') }}</button>
    </div>
    <div v-if="playError" class="fetch-error-banner">
      <span>{{ playError }}</span>
    </div>

    <div class="dashboard-updated-row"><UpdatedStamp /></div>

    <!-- ============================================================
         TEACHER
         ============================================================ -->
    <template v-if="isTeacher">
      <Greeting
        :name="greetingName"
        :lines="greetingLines"
        :date="todayLabel"
        :dense="density === 'compact'"
      >
        <template #action>
          <!-- "Guided look", never "mission" — mission framing is deprecated
               in user-facing copy (founder ruling, 2026-07-30). -->
          <button v-if="showMissionAffordance" type="button" class="btn-ghost" @click="handleTryMission">
            {{ t('schools.dashboard.takeAGuidedLook', 'Take a guided look') }}
          </button>
          <button v-if="!isAdminView" type="button" class="btn-ghost" @click="isCreateModalOpen = true">{{ t('schools.dashboard.createClass', '+ Create class') }}</button>
        </template>
      </Greeting>

      <!-- Classes-first (founder ruling 2026-07-30): the teacher's classes ARE
           the page — Play-as-Class is the primary affordance, everything else
           (stats, invites, guided look) is subordinate. Two taps from login
           to teaching. Every figure on a class is the CLASS ACCOUNT'S OWN
           (job #651): minutes in the app this week, phrases practised, LEGOs
           travelled, last played. -->

      <div v-if="teacherPracticeError" class="fetch-error-banner">
        <span>{{ t('schools.dashboard.practiceNotLoaded', "Couldn't load this week's practice — the rows below show no minutes until it loads. {error}").replace('{error}', teacherPracticeError) }}</span>
        <button type="button" class="btn-ghost" @click="refresh">{{ t('schools.dashboard.retry', 'Retry') }}</button>
      </div>

      <!-- Compact: dense table -->
      <div v-if="density === 'compact'" class="schools-card teacher-compact">
        <div class="teacher-compact-head">
          <div>{{ t('schools.dashboard.class', 'Class') }}</div>
          <div>{{ t('schools.dashboard.course', 'Course') }}</div>
          <div>{{ t('schools.dashboard.thisWeekHead', 'This week') }}</div>
          <div>{{ t('schools.dashboard.code', 'Code') }}</div>
          <div></div>
        </div>
        <div
          v-for="(cls, i) in teacherClassRows"
          :key="cls.id"
          :class="['teacher-compact-row', { last: i === teacherClassRows.length - 1 }]"
        >
          <!-- HANDBOOK Your classes at a glance
               section: seeing-progress
               roles: teacher
               place: dashboard
               keywords: classes, dashboard, overview, minutes, phrases, journey, join code, course
               parts: dash-class-week, dash-class-week-pupils
               What it's for. Your teaching dashboard, with your classes first. Every
               class you teach is a row or a card carrying its course, the minutes
               it spent in the app this week, the phrases it practised, how far it
               has travelled through the course, when it last played, and the join
               code you read out to get a new pupil in. The minutes are the class's
               own, from the lessons you ran with Play as class. Beside them, kept
               apart and never added in, is what the pupils did on their own
               accounts this week, said in words when there is nothing.
               Where it is. The schools dashboard you land on, above everything else
               on the page.
               How you do it.
               1. Open the schools dashboard.
               2. Read down the list — one entry per class you teach.
               3. Tap a class name to open its class page, with what it practised
                  this week and how far it has got.
               4. **Play as class** on any entry starts a session the whole class
                  does together, on the class's own account.
               Worth knowing. A class that has never played says **Not started** in
               words. A brand new account shows a single button to create your
               first class instead of the list.
               checked: 89f2f1e6.c3b41033
          -->
          <router-link :to="schoolsLink('class-detail', { classId: cls.id })" class="class-link" data-walk="dash-class-card">
            <BeltDot :belt="cls.started ? cls.class_belt : 'white'" :size="28" ring />
            <div class="class-link-text">
              <div class="class-name">{{ cls.class_name }}</div>
              <div class="class-meta">
                <template v-if="cls.started === null">{{ t('schools.dashboard.loadingThisWeek', 'loading this week…') }}</template>
                <template v-else-if="cls.started === false">{{ t('schools.dashboard.notStartedClass', 'Not started — Play as class starts the first lesson') }}</template>
                <template v-else-if="cls.lastPlayed">{{ t('schools.dashboard.lastPlayed', 'Last played {day}').replace('{day}', cls.lastPlayed) }}</template>
              </div>
            </div>
          </router-link>
          <div class="schools-subtle">{{ courseDisplayName(cls.course_code) }}</div>
          <div class="class-week" data-walk="dash-class-week">
            <template v-if="cls.started === null"><span class="schools-subtle">…</span></template>
            <template v-else-if="cls.started === false"><span class="schools-subtle">{{ t('schools.dashboard.notStarted', 'Not started') }}</span></template>
            <template v-else>
              <strong class="arsenal">{{ formatPracticeMinutes(cls.minutesWk) }}</strong> {{ t('schools.dashboard.inTheApp', 'in the app') }}
              <span class="dot-sep">·</span>
              {{ t('schools.dashboard.nPhrases', '{n} phrases').replace('{n}', String(cls.phrases7d)) }}
              <span class="dot-sep">·</span>
              {{ t('schools.dashboard.legosTravelled', '{done}/{total} LEGOs').replace('{done}', String(cls.journeyDone)).replace('{total}', String(cls.journeyTotal)) }}
            </template>
            <span v-if="cls.started !== null" class="class-week-pupils schools-subtle" data-walk="dash-class-week-pupils">{{ pupilsOwnRowLabel(cls.pupilsOwnMinutes) }}</span>
          </div>
          <div class="join-code">{{ cls.student_join_code }}</div>
          <div class="row-cta">
            <button v-if="canPlayAsClass" class="btn-play" @click="handlePlayClass(cls)">{{ t('schools.dashboard.playAsClass', '▶ Play as class') }}</button>
          </div>
        </div>

        <div v-if="classesLoading && !teacherClasses.length" class="empty-state">
          <p class="schools-subtle">{{ t('schools.dashboard.loadingYourClasses', 'Loading your classes…') }}</p>
        </div>
        <div v-else-if="!teacherClasses.length" class="empty-state">
          <p>{{ t('schools.dashboard.noClassesYet', 'No classes yet.') }}</p>
          <button v-if="!isAdminView" type="button" class="btn-play empty-hero-cta" @click="isCreateModalOpen = true">{{ t('schools.dashboard.createYourFirstClass', 'Create your first class') }}</button>
        </div>
      </div>

      <!-- Detailed: card grid -->
      <div v-else class="class-grid">
        <article
          v-for="cls in teacherClassRows"
          :key="cls.id"
          class="schools-card class-panel"
        >
          <div class="panel-head">
            <div class="course-eyebrow">{{ courseDisplayName(cls.course_code) }}</div>
            <router-link :to="schoolsLink('class-detail', { classId: cls.id })" class="panel-title-link" data-walk="dash-class-card">
              <h2 class="arsenal panel-title">{{ cls.class_name }}</h2>
            </router-link>
            <div class="panel-meta">
              <BeltDot :belt="cls.started ? cls.class_belt : 'white'" :size="14" ring />
              <template v-if="cls.started === null"><span>{{ t('schools.dashboard.loadingThisWeek', 'loading this week…') }}</span></template>
              <template v-else-if="cls.started === false"><span>{{ t('schools.dashboard.notStartedClass', 'Not started — Play as class starts the first lesson') }}</span></template>
              <template v-else>
                <span>{{ t('schools.dashboard.minutesInAppThisWeekN', '{minutes} in the app this week').replace('{minutes}', formatPracticeMinutes(cls.minutesWk)) }}</span>
                <span class="dot-sep">·</span>
                <span>{{ t('schools.dashboard.nPhrases', '{n} phrases').replace('{n}', String(cls.phrases7d)) }}</span>
              </template>
              <span v-if="cls.started !== null" class="class-week-pupils schools-subtle" data-walk="dash-class-week-pupils">{{ pupilsOwnRowLabel(cls.pupilsOwnMinutes) }}</span>
            </div>
          </div>

          <button
            v-if="canPlayAsClass"
            class="btn-play pac-hero"
            @click="handlePlayClass(cls)"
          >{{ t('schools.dashboard.playAsClass', '▶ Play as class') }}</button>

          <div v-if="cls.started" class="panel-week" data-walk="dash-class-week">
            <div class="schools-kicker">{{ t('schools.dashboard.togetherKicker', 'Together, this week') }}</div>
            <p class="panel-week-line">
              {{ t('schools.dashboard.legosTravelledTogether', 'The class has travelled {done} of {total} LEGOs.').replace('{done}', String(cls.journeyDone)).replace('{total}', String(cls.journeyTotal)) }}
              <template v-if="cls.lastPlayed"> {{ t('schools.dashboard.lastPlayed', 'Last played {day}').replace('{day}', cls.lastPlayed) }}.</template>
            </p>
          </div>

          <div class="panel-footer">
            <span class="schools-subtle">{{ t('schools.dashboard.joinCode', 'Join code') }}</span>
            <span class="join-code">{{ cls.student_join_code }}</span>
          </div>
        </article>

        <div v-if="classesLoading && !teacherClasses.length" class="empty-state full">
          <p class="schools-subtle">{{ t('schools.dashboard.loadingYourClasses', 'Loading your classes…') }}</p>
        </div>
        <div v-else-if="!teacherClasses.length" class="empty-state full">
          <p>{{ t('schools.dashboard.noClassesYetCreateOne', 'No classes yet — create one to get your students playing.') }}</p>
          <button v-if="!isAdminView" type="button" class="btn-play empty-hero-cta" @click="isCreateModalOpen = true">{{ t('schools.dashboard.createYourFirstClass', 'Create your first class') }}</button>
        </div>
      </div>

      <!-- HANDBOOK Practice on your own account
           section: seeing-progress
           roles: teacher
           place: dashboard
           keywords: own account, library, play as class, minutes, mistake, my practice
           What it's for. Telling you when practice this week landed on your own
           sign-in rather than on a class. Pressing play on a course from your
           Library counts for you; only Play as class counts for the class. The
           line names your own minutes and when you last played, so a lesson that
           went to the wrong place is found rather than lost.
           Where it is. Under your classes on the schools dashboard, only in a
           week when your own account has practised.
           How you do it.
           1. Read the line.
           2. Next lesson, tap **Play as class** on the class instead of playing
              from the Library.
           3. To move this week's lesson onto the class, open the class and use
              **Ran a lesson signed in as yourself?** on its tools page.
           Worth knowing. The line never appears when your own account is quiet,
           so its absence means nothing went astray.
           checked: 8353ee38.a7f54312
      -->
      <p v-if="ownPracticeLine" class="own-practice-line" data-walk="dash-own-practice">{{ ownPracticeLine }}</p>

      <!-- Stats, demoted: one quiet line under the classes (founder ruling
           2026-07-30 — classes lead, numbers follow). -->
      <!-- HANDBOOK Your own teaching numbers
           section: seeing-progress
           roles: teacher
           place: dashboard
           keywords: numbers, totals, classes, minutes, phrases, students, own accounts
           parts: dash-teacher-own-accounts
           What it's for. One quiet line totalling your classes this week: how many
           classes, the minutes they spent in the app with a lesson running, and the
           phrases they practised. All of it is the classes' own play from the front.
           A second line, always there, is the minutes your pupils spent on their
           own accounts this week, kept apart from the first and never added to it.
           When no pupil has practised on their own account it says so in words,
           because that is usual for a class taught from the front and not a fault.
           Where it is. Underneath your classes on the schools dashboard.
           How you do it.
           1. Open the schools dashboard and scroll past your classes.
           2. **Classes** is how many you teach.
           3. **In the app this week** is time with a lesson running, pauses included.
           4. **Phrases practised** is how many phrases your classes were prompted with
              this week.
           Worth knowing. The line only appears once you have at least one class.
           checked: 4ec80f25.f3a99573
      -->
      <div v-if="teacherClasses.length" class="teacher-stat-line schools-subtle" data-walk="dash-teacher-stats">
        <span><strong class="arsenal stat-line-value">{{ teacherStats.classes }}</strong> {{ teacherStats.classes === 1 ? t('schools.dashboard.classSingular', 'class') : t('schools.dashboard.classesWord', 'classes') }}</span>
        <span class="dot-sep">·</span>
        <span><strong class="arsenal stat-line-value">{{ teacherPracticeLoaded ? formatPracticeMinutes(teacherStats.minutes) : '—' }}</strong> {{ t('schools.dashboard.inTheAppThisWeek', 'in the app this week') }}</span>
        <span class="dot-sep">·</span>
        <span><strong class="arsenal stat-line-value">{{ teacherPracticeLoaded ? teacherStats.phrases : '—' }}</strong> {{ t('schools.dashboard.phrasesPractised', 'phrases practised') }}</span>
      </div>
      <div v-if="teacherClasses.length && pupilsOwnLine" class="teacher-stat-line teacher-stat-line-own schools-subtle" data-walk="dash-teacher-own-accounts">
        <span>{{ pupilsOwnLine }}</span>
      </div>
    </template>

    <!-- ============================================================
         SCHOOL ADMIN
         ============================================================ -->
    <template v-else-if="isSchoolAdmin">
      <Greeting
        :name="greetingName"
        :lines="adminGreetingLines"
        :date="todayLabel"
        :dense="density === 'compact'"
      >
        <template #action>
          <div v-if="!isAdminView" class="action-row">
            <router-link to="/schools/teachers" class="btn-ghost">{{ t('schools.dashboard.inviteTeacher', '+ Invite teacher') }}</router-link>
            <router-link to="/schools/settings" class="btn-play">{{ t('schools.dashboard.schoolSettings', 'School settings') }}</router-link>
          </div>
        </template>
      </Greeting>

      <!-- First-run: confirm your school's name (invite-born admins only —
           the name came from the inviting leader's guess, not yours).
           This card USED to sit inside the govt-admin branch below, where its
           own predicate (isSchoolAdmin) could never be true — roles are
           mutually exclusive, so it was dead for every school admin on prod
           (Chepstow, 2026-08-06). It belongs here, in the school-admin lane. -->
      <div v-if="showNameSchoolCard" class="schools-card schools-card-pad name-group-card">
        <h3 class="arsenal card-header-title">{{ t('schools.dashboard.confirmYourSchoolsName', "Confirm your school's name") }}</h3>
        <p class="schools-subtle">{{ t('schools.dashboard.whatTeachersAndStudentsWillSee', 'This is what your teachers and students will see.') }}</p>
        <div class="name-group-row">
          <input
            v-model="schoolNameDraft"
            type="text"
            class="field-input"
            :placeholder="t('schools.dashboard.egYsgolYGarnedd', 'e.g. Ysgol y Garnedd')"
            :disabled="isSavingSchoolName"
            @keyup.enter="saveSchoolName"
          />
          <button
            class="btn-play"
            :disabled="isSavingSchoolName || !schoolNameDraft.trim()"
            @click="saveSchoolName"
          >
            {{ isSavingSchoolName ? t('schools.dashboard.saving', 'Saving…') : t('schools.dashboard.save', 'Save') }}
          </button>
        </div>
        <p v-if="schoolNameError" class="name-group-error">{{ schoolNameError }}</p>
      </div>

      <!-- Not onboarded yet → offer the guided setup wizard.
           /schools/setup has no nav tab, so this banner is its entry point.
           The signal is ZERO PUPILS, not zero classes: a head who made one
           throwaway class on day one used to lose the wizard forever while
           her dashboard stayed a wall of zeros (Chepstow, 3 classes / 0 pupils
           ever, 2026-08-06). One enrolled student retires the banner, so a
           school that IS running is never nagged; the quiet Quick-links entry
           below keeps the wizard reachable after that.
           Gated on currentSchool so it can't flash while stats are loading.
           Setup is a write flow with no admin-view equivalent — hide it there. -->
      <router-link
        v-if="!isAdminView && currentSchool && !totalStudents"
        to="/schools/setup"
        class="schools-card schools-card-pad setup-banner"
      >
        <div>
          <div class="schools-kicker">{{ t('schools.dashboard.getStarted', 'Get started') }}</div>
          <p class="setup-banner-text">
            {{ t('schools.dashboard.setupFourStepsBody', 'Set up your school in four quick steps — name it, invite your teachers, choose your courses and get your pupils into a class.') }}
          </p>
        </div>
        <span class="btn-play setup-banner-cta">{{ t('schools.dashboard.startSetup', 'Start setup →') }}</span>
      </router-link>

      <div class="stat-strip stat-strip--5">
        <div class="stat-card">
          <span class="arsenal stat-value">{{ totalStudents }}</span>
          <span class="stat-label">{{ t('schools.dashboard.studentsLabel', 'Students') }}</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ totalTeachers }}</span>
          <span class="stat-label">{{ t('schools.dashboard.teachersLabel', 'Teachers') }}</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ totalClasses }}</span>
          <span class="stat-label">{{ t('schools.dashboard.classesLabel', 'Classes') }}</span>
        </div>
        <!-- HANDBOOK Minutes in the app this week
             section: seeing-progress
             roles: school_admin
             place: dashboard
             keywords: minutes, time in app, this week, classes practising, practice
             What it's for. How much your school practised this week, in minutes: the
             time your classes spent in the app with a lesson running, pauses included,
             plus any teacher or pupil practising on their own account, each counted
             once. Under it, how many of your classes practised at all this week.
             Where it is. The stat strip at the top of the schools dashboard.
             How you do it.
             1. Read the number. It is minutes, never hours, and it is this week only.
             2. Read the line beneath it for how many classes practised.
             Worth knowing. A dash means this week's figures have not loaded — pull to
             refresh. It is never shown as a zero that is not real.
             checked: 10c13269.32e408c6
        -->
        <div class="stat-card" data-walk="dash-minutes-this-week">
          <span class="arsenal stat-value">{{ practice7d.loaded.value ? formatPracticeMinutes(practice7d.minutesThisWeek.value) : '—' }}</span>
          <span class="stat-label">{{ t('schools.dashboard.minutesInAppThisWeek', 'Minutes in the app this week') }}</span>
          <span v-if="classesPractisingLine" class="stat-subnote">{{ classesPractisingLine }}</span>
          <span v-else class="stat-subnote">{{ t('schools.dashboard.thisWeekNotLoaded', 'This week’s figures have not loaded — pull to refresh.') }}</span>
        </div>
        <div class="stat-card">
          <span class="arsenal stat-value">{{ teacherClasses.length }}</span>
          <span class="stat-label">{{ t('schools.dashboard.yourClasses', 'Your classes') }}</span>
        </div>
      </div>

      <!-- The school-admin sweep for lessons played on teachers' own accounts
           (job #662). Under View-as it lists; the copy is refused server-side
           and the row shows why. -->
      <CopyPlaySweepCard v-if="currentSchool" @copied="refresh" />

      <div class="admin-grid">
        <div class="schools-card">
          <header class="card-header-row">
            <h3 class="arsenal card-header-title">{{ t('schools.dashboard.classesLabel', 'Classes') }}</h3>
            <button
              v-if="!isAdminView && teacherClasses.length"
              type="button"
              class="card-header-link card-header-btn"
              @click="isCreateModalOpen = true"
            >{{ t('schools.dashboard.createClass', '+ Create class') }}</button>
            <router-link :to="schoolsLink('classes')" class="card-header-link">{{ t('schools.dashboard.viewAll', 'View all →') }}</router-link>
          </header>
          <table class="ssi-table">
            <thead>
              <tr>
                <th>{{ t('schools.dashboard.class', 'Class') }}</th>
                <th>{{ t('schools.dashboard.course', 'Course') }}</th>
                <th>{{ t('schools.dashboard.studentsLabel', 'Students') }}</th>
                <th>{{ t('schools.dashboard.avgPractice', 'Avg practice') }}</th>
                <!-- Play-as-class is a school-STAFF capability (owner ruling
                     2026-07-16) — the admin lane gets the same action the
                     teacher lane's cards carry. Header stays empty; the cell
                     renders the button when permitted. -->
                <th v-if="canPlayAsClass"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cls in teacherClasses" :key="cls.id">
                <td>
                  <div class="class-cell">
                    <BeltDot belt="white" :size="20" ring />
                    <div>
                      <div class="class-name">{{ cls.class_name }}</div>
                      <div class="schools-subtle class-meta">{{ courseDisplayName(cls.course_code) }}</div>
                    </div>
                  </div>
                </td>
                <td class="schools-subtle">{{ courseDisplayName(cls.course_code) }}</td>
                <td>{{ cls.student_count }}</td>
                <td>{{ Math.round(cls.avg_practice_minutes || 0) }}m</td>
                <td v-if="canPlayAsClass" class="row-cta">
                  <button class="btn-play" @click="handlePlayClass(cls)">{{ t('schools.dashboard.playAsClass', '▶ Play as class') }}</button>
                </td>
              </tr>
              <tr v-if="classesLoading && !teacherClasses.length">
                <td :colspan="canPlayAsClass ? 5 : 4" class="empty-row">
                  <p class="empty-row-text schools-subtle">{{ t('schools.dashboard.loadingYourClasses', 'Loading your classes…') }}</p>
                </td>
              </tr>
              <tr v-else-if="!teacherClasses.length">
                <td :colspan="canPlayAsClass ? 5 : 4" class="empty-row">
                  <p class="empty-row-text">{{ t('schools.dashboard.noClassesYetCreateOne', 'No classes yet — create one to get your students playing.') }}</p>
                  <button v-if="!isAdminView" type="button" class="btn-play empty-row-cta" @click="isCreateModalOpen = true">
                    {{ t('schools.dashboard.createYourFirstClassPlus', '+ Create your first class') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside class="schools-card schools-card-pad attention-panel">
          <h3 class="arsenal attention-title">{{ t('schools.dashboard.quickLinks', 'Quick links') }}</h3>
          <div class="attention-list">
            <router-link :to="schoolsLink('students')" class="attention-row">
              <div class="attention-tag">{{ t('schools.dashboard.studentsLabel', 'Students') }}</div>
              <div class="attention-body">{{ t('schools.dashboard.viewManageStudentProgress', 'View and manage all student progress') }}</div>
              <span class="attention-cta">{{ t('schools.dashboard.open', 'Open →') }}</span>
            </router-link>
            <router-link :to="schoolsLink('teachers')" class="attention-row">
              <div class="attention-tag">{{ t('schools.dashboard.teachersLabel', 'Teachers') }}</div>
              <div class="attention-body">{{ t('schools.dashboard.inviteOrManageTeachingStaff', 'Invite or manage teaching staff') }}</div>
              <span class="attention-cta">{{ t('schools.dashboard.open', 'Open →') }}</span>
            </router-link>
            <router-link :to="schoolsLink('analytics')" class="attention-row">
              <div class="attention-tag">{{ t('schools.dashboard.analytics', 'Analytics') }}</div>
              <div class="attention-body">{{ t('schools.dashboard.weeklyActivityBreakdown', 'Weekly activity and per-class breakdown') }}</div>
              <span class="attention-cta">{{ t('schools.dashboard.open', 'Open →') }}</span>
            </router-link>
            <!-- The wizard's only permanent home. /schools/setup has no nav
                 tab, so once the first-run banner above retires it would
                 otherwise be unreachable. Quiet, never a nag. Write flow —
                 hidden in the ssi_admin read-only view. -->
            <router-link v-if="!isAdminView" to="/schools/setup" class="attention-row">
              <div class="attention-tag">{{ t('schools.dashboard.setup', 'Setup') }}</div>
              <div class="attention-body">{{ t('schools.dashboard.walkThroughSetupAgain', 'Walk through school setup again, step by step') }}</div>
              <span class="attention-cta">{{ t('schools.dashboard.open', 'Open →') }}</span>
            </router-link>
          </div>
        </aside>
      </div>
    </template>

    <!-- ============================================================
         GOVT ADMIN — schools tile grid (drill-down)
         ============================================================ -->
    <template v-else-if="isGovtAdmin">
      <Greeting
        :name="`${schoolName}`"
        :lines="isViewingSchool
          ? t('schools.dashboard.classesStudentsPractisedGovt', '{classes} classes · {students} students · {hours} practised{staffNote}')
              .replace('{classes}', String(totalClasses)).replace('{students}', String(totalStudents))
              .replace('{hours}', formatPracticeMinutes(totalPracticeMinutes))
              .replace('{staffNote}', staffPracticeNote ? `, ${staffPracticeNote}` : '')
          : t('schools.dashboard.schoolsStudentsPractisedGovt', '{schoolCount} schools · {students} students · {hours} practised{staffNote}')
              .replace('{schoolCount}', String(schools.length)).replace('{students}', String(totalStudents))
              .replace('{hours}', formatPracticeMinutes(totalPracticeMinutes))
              .replace('{staffNote}', staffPracticeNote ? ` (${staffPracticeNote})` : '')"
        :date="todayLabel"
        :dense="density === 'compact'"
      >
        <template #action>
          <router-link :to="schoolsLink('schools-list')" class="btn-ghost">{{ t('schools.dashboard.fullSchoolsList', 'Full schools list →') }}</router-link>
        </template>
      </Greeting>

      <!-- First-run: name your group (design §1d) -->
      <div v-if="showNameGroupCard" class="schools-card schools-card-pad name-group-card">
        <h3 class="arsenal card-header-title">{{ t('schools.dashboard.nameYourGroup', 'Name your group') }}</h3>
        <p class="schools-subtle">{{ t('schools.dashboard.whatSchoolsWillSeeWhenJoin', 'This is what schools will see when they join.') }}</p>
        <div class="name-group-row">
          <input
            v-model="groupNameDraft"
            type="text"
            class="field-input"
            :placeholder="t('schools.dashboard.egGwyneddEducationAuthority', 'e.g. Gwynedd Education Authority')"
            :disabled="isSavingGroupName"
            @keyup.enter="saveGroupName"
          />
          <button
            class="btn-play"
            :disabled="isSavingGroupName || !groupNameDraft.trim()"
            @click="saveGroupName"
          >
            {{ isSavingGroupName ? t('schools.dashboard.saving', 'Saving…') : t('schools.dashboard.save', 'Save') }}
          </button>
        </div>
        <p v-if="groupNameError" class="name-group-error">{{ groupNameError }}</p>
      </div>

      <!-- NOTE: the "confirm your school's name" card used to sit here, where
           its isSchoolAdmin predicate could never fire inside this
           isGovtAdmin branch. It now lives in the SCHOOL ADMIN branch above.
           The "Name your group" card directly above is the govt-admin's own,
           separate, working card — keep them apart. -->

      <!-- Add schools / Create school (design §1e, §5c revised). In the
           read-only View-as, this card only earns its place if there are
           outstanding links to show — otherwise it would be an empty header. -->
      <div v-if="!isViewingSchool && (!isAdminView || schoolLinks.length)" class="schools-card schools-card-pad add-schools-card">
        <header class="card-header-row">
          <h3 class="arsenal card-header-title">{{ t('schools.dashboard.schoolsInYourGroup', 'Schools in your group') }}</h3>
        </header>
        <!-- Creating a school is a write — hidden in the ssi_admin read-only
             View-as (isAdminView). The read-only outstanding-links table below
             stays visible so the persona's dashboard is still complete. -->
        <div v-if="!isAdminView" class="add-schools-row">
          <input
            v-model="newSchoolLabel"
            type="text"
            class="field-input field-input-flex"
            :placeholder="t('schools.dashboard.schoolName', 'School name')"
            @keyup.enter="handleCreateSchool"
          />
          <button class="btn-play" :disabled="isCreatingSchool || !newSchoolLabel.trim()" @click="handleCreateSchool">
            {{ isCreatingSchool ? t('schools.dashboard.creating', 'Creating…') : t('schools.dashboard.createSchool', 'Create school') }}
          </button>
        </div>
        <div v-if="!isAdminView && createdSchoolLinks" class="created-links">
          <InviteLinkField v-if="schoolInviteUrl(createdSchoolLinks.admin_join_code)" :label="t('schools.dashboard.inviteLabelAdmin', 'Admin')" :url="schoolInviteUrl(createdSchoolLinks.admin_join_code)!" />
          <InviteLinkField v-if="schoolInviteUrl(createdSchoolLinks.teacher_join_code)" :label="t('schools.dashboard.inviteLabelTeacher', 'Teacher')" :url="schoolInviteUrl(createdSchoolLinks.teacher_join_code)!" />
        </div>

        <!-- Outstanding links minted before the one-primitive change
             (2026-07-14) — kept redeemable and visible here, but no new
             ones can be minted from this surface any more. -->
        <table v-if="schoolLinks.length" class="ssi-table">
          <thead>
            <tr>
              <th>{{ t('schools.dashboard.link', 'Link') }}</th>
              <th>{{ t('schools.dashboard.state', 'State') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="link in schoolLinks" :key="link.id">
              <td>{{ link.label || link.code }}</td>
              <td class="schools-subtle">
                <span v-if="link.redeemed">{{ t('schools.dashboard.redeemedBy', 'Redeemed — {school}').replace('{school}', String(link.school?.school_name)) }}</span>
                <span v-else-if="!link.is_active">{{ t('schools.dashboard.deactivated', 'Deactivated') }}</span>
                <span v-else>{{ t('schools.dashboard.pending', 'Pending') }}</span>
              </td>
              <td>
                <button v-if="!link.redeemed" class="btn-ghost" @click="copyLink(link.id, link.code)">
                  {{ copiedLinkId === link.id ? t('schools.dashboard.copied', 'Copied!') : t('schools.dashboard.copyLink', 'Copy link') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!isViewingSchool" class="govt-schools-grid">
        <button
          v-for="school in schools"
          :key="school.id"
          class="schools-card govt-tile"
          @click="selectSchoolToView(school)"
        >
          <div class="govt-tile-head">
            <div class="govt-tile-avatar">{{ school.school_name.slice(0, 2).toUpperCase() }}</div>
            <div class="govt-tile-info">
              <h4>{{ school.school_name }}</h4>
              <span class="schools-subtle">
                {{ t('schools.dashboard.teacherCountClassCount', '{teachers} teachers · {classes} classes').replace('{teachers}', String(school.teacher_count)).replace('{classes}', String(school.class_count)) }}
              </span>
            </div>
          </div>
          <div class="govt-tile-stats">
            <div>
              <div class="arsenal govt-tile-stat">{{ school.student_count }}</div>
              <div class="schools-subtle">{{ t('schools.dashboard.studentsLabel', 'Students') }}</div>
            </div>
            <div>
              <div class="arsenal govt-tile-stat">{{ formatPracticeMinutes(school.total_practice_minutes) }}</div>
              <div class="schools-subtle">{{ t('schools.dashboard.minutesPractised', 'Minutes practised') }}</div>
            </div>
          </div>
        </button>
      </div>

      <!-- Drill-down: one school's detail (classes + stats) -->
      <template v-else>
        <div class="stat-strip">
          <div class="stat-card">
            <span class="arsenal stat-value">{{ totalStudents }}</span>
            <span class="stat-label">{{ t('schools.dashboard.studentsLabel', 'Students') }}</span>
          </div>
          <div class="stat-card">
            <span class="arsenal stat-value">{{ totalTeachers }}</span>
            <span class="stat-label">{{ t('schools.dashboard.teachersLabel', 'Teachers') }}</span>
          </div>
          <div class="stat-card">
            <span class="arsenal stat-value">{{ totalClasses }}</span>
            <span class="stat-label">{{ t('schools.dashboard.classesLabel', 'Classes') }}</span>
          </div>
          <div class="stat-card">
            <span class="arsenal stat-value">{{ formatPracticeMinutes(totalPracticeMinutes) }}</span>
            <span class="stat-label">{{ t('schools.dashboard.minutesPractised', 'Minutes practised') }}</span>
          </div>
        </div>

        <div class="schools-card">
          <header class="card-header-row">
            <h3 class="arsenal card-header-title">{{ t('schools.dashboard.classesLabel', 'Classes') }}</h3>
          </header>
          <table class="ssi-table">
            <thead>
              <tr>
                <th>{{ t('schools.dashboard.class', 'Class') }}</th>
                <th>{{ t('schools.dashboard.course', 'Course') }}</th>
                <th>{{ t('schools.dashboard.studentsLabel', 'Students') }}</th>
                <th>{{ t('schools.dashboard.avgPractice', 'Avg practice') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cls in teacherClasses" :key="cls.id">
                <td>
                  <router-link
                    :to="schoolsLink('class-detail', { classId: cls.id, schoolId: viewingSchool?.id })"
                    class="class-cell class-cell-link"
                  >
                    <BeltDot belt="white" :size="20" ring />
                    <div>
                      <div class="class-name">{{ cls.class_name }}</div>
                      <div class="schools-subtle class-meta">{{ courseDisplayName(cls.course_code) }}</div>
                    </div>
                  </router-link>
                </td>
                <td class="schools-subtle">{{ courseDisplayName(cls.course_code) }}</td>
                <td>{{ cls.student_count }}</td>
                <td>{{ Math.round(cls.avg_practice_minutes || 0) }}m</td>
              </tr>
              <tr v-if="classesLoading && !teacherClasses.length">
                <td colspan="4" class="empty-row schools-subtle">{{ t('schools.dashboard.loadingClasses', 'Loading classes…') }}</td>
              </tr>
              <tr v-else-if="!teacherClasses.length">
                <td colspan="4" class="empty-row">{{ t('schools.dashboard.noClassesInThisSchoolYet', 'No classes in this school yet.') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="createClassError" class="error-toast" @click="createClassError = null">
          {{ createClassError }}
        </div>
      </Transition>
    </Teleport>

    <CreateClassModal
      :isOpen="isCreateModalOpen"
      :submitting="isCreatingClass"
      @close="isCreateModalOpen = false"
      @create="handleCreateClass"
    />

    <ClassCreatedModal
      :isOpen="isCreatedModalOpen"
      :classData="createdClass"
      @close="closeCreatedModal"
      @goToClass="handleGoToCreatedClass"
    />

    <MailboxCheckPrompt
      :isOpen="mailboxPrompt.isOpen.value"
      :primaryEmail="mailboxPrompt.primaryEmail.value"
      @close="mailboxPrompt.dismiss()"
      @proved="mailboxPrompt.markProved()"
    />
  </div>
</template>

<style scoped>
.class-week { font-size: var(--text-sm); color: var(--schools-fg-2, #555); }
.class-week-pupils { display: block; font-size: var(--text-xs, 12px); margin-top: 2px; }
.class-week strong { color: var(--schools-fg, #222); }
.panel-week { display: flex; flex-direction: column; gap: 4px; }
.panel-week-line { margin: 0; font-size: var(--text-sm); color: var(--schools-fg-2, #555); }
.own-practice-line { margin: 12px 0 0; font-size: var(--text-sm); color: var(--schools-fg-2, #555); }
.teacher-stat-line-own { margin-top: 4px; }

.dashboard-view {
  padding-bottom: 32px;
}

.fetch-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--schools-red);
  border: 1px solid rgba(var(--tone-red, 194, 58, 58), 0.28);
  background: rgba(var(--tone-red, 194, 58, 58), 0.06);
  border-radius: 8px;
}

/* ---------- Breadcrumb ---------- */
.dashboard-updated-row {
  display: flex;
  justify-content: flex-end;
  min-height: 14px;
  margin-bottom: 10px;
}

.dashboard-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--schools-fg-2);
}
.breadcrumb-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--schools-red);
  cursor: pointer;
  font: inherit;
  padding: 4px 8px;
  border-radius: 6px;
}
.breadcrumb-back:hover { background: rgba(219, 30, 23, 0.06); }
.breadcrumb-sep { color: var(--schools-fg-3); }
.breadcrumb-current { color: var(--schools-fg); font-weight: 500; }

/* Govt drill-down: clickable class row */
.class-cell-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}
.class-cell-link:hover .class-name {
  color: var(--schools-red);
}

/* ---------- First-run setup banner ---------- */
.setup-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  text-decoration: none;
  color: inherit;
}
.setup-banner-text {
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--schools-fg-2, #5a534c);
}
.setup-banner-cta { white-space: nowrap; }

/* ---------- Stat strip ---------- */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.stat-strip--5 { grid-template-columns: repeat(5, 1fr); }

.stat-card {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.stat-value {
  font-size: 24px;
  line-height: 1;
  color: var(--schools-fg);
}
.stat-label {
  font-size: 12px;
  color: var(--schools-fg-2);
}
/* Composition line under the headline hours — full-width wrap below the
   value/label row (founder ruling 2026-07-18, "incl. Xm staff practice"). */
.stat-subnote {
  flex-basis: 100%;
  font-size: 11px;
  color: var(--schools-fg-2);
  opacity: 0.85;
}

/* ---------- Teacher: compact table ---------- */
.teacher-compact {
  overflow: hidden;
}
.teacher-compact-head,
.teacher-compact-row {
  display: grid;
  grid-template-columns: 1.6fr 1.2fr 1.6fr 0.9fr 110px;
  gap: 14px;
  align-items: center;
  padding: 14px 18px;
}
.teacher-compact-head {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
  border-bottom: 1px solid var(--schools-border);
  background: #fafafa;
  padding: 10px 18px;
}
.teacher-compact-row {
  border-bottom: 1px solid var(--schools-border);
}
.teacher-compact-row.last { border-bottom: none; }

.class-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}
.class-link-text { min-width: 0; }
.class-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--schools-fg);
}
.class-meta {
  font-size: 11.5px;
  color: var(--schools-fg-2);
  margin-top: 1px;
}
.join-code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--schools-fg-2);
  letter-spacing: 0.04em;
}
.row-cta { text-align: right; }

/* ---------- Teacher: detailed cards ---------- */
/* auto-fit so one class stretches to a full-width hero card and three share
   the row — the fewer classes a teacher has, the bigger each card (and its
   Play button) renders. Reads well projected. */
.class-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 18px;
}
.class-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 22px 22px;
}
.panel-head { display: flex; flex-direction: column; gap: 6px; }
.course-eyebrow {
  font-size: 11.5px;
  color: var(--schools-red);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 600;
}
.panel-title-link { text-decoration: none; color: inherit; }
.panel-title-link:hover .panel-title { color: var(--schools-red); }
/* Projector-legible: the class name is what the room reads at 8:59am. */
.panel-title {
  font-size: 32px;
  line-height: 1.08;
  margin: 2px 0 6px;
}
.panel-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--schools-fg-2);
}
.dot-sep { color: var(--schools-fg-3); opacity: 0.6; }
.panel-bench {
  padding-top: 8px;
  border-top: 1px dashed var(--schools-border);
}
.bench-kicker { margin-bottom: 6px; }
.panel-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
  font-size: 12px;
}

/* The primary affordance on the page: full-width, generous hit target,
   sized to be read (and tapped) with the class watching. */
.pac-hero {
  justify-content: center;
  width: 100%;
  padding: 14px 20px 15px;
  font-size: 17px;
  border-radius: 10px;
}

/* ---------- Teacher: demoted stat line ---------- */
.teacher-stat-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
  padding: 0 4px;
  font-size: 13px;
}
.stat-line-value {
  font-size: 17px;
  color: var(--schools-fg);
  font-weight: 400;
}

/* Empty state: the Create-class CTA inherits the prominence the Play button
   would have had — same clarity, same two-tap promise. */
.empty-hero-cta {
  font-size: 16px;
  padding: 13px 26px 14px;
}

/* ---------- Empty state ---------- */
.empty-state {
  padding: 32px 24px;
  text-align: center;
  color: var(--schools-fg-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.empty-state.full { grid-column: 1 / -1; }

/* ---------- Admin ---------- */
.action-row { display: flex; gap: 8px; }

.admin-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 14px;
}
.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--schools-border);
}
.card-header-title { font-size: 18px; margin: 0; }
.card-header-link {
  font-size: 12px;
  color: var(--schools-fg-2);
  text-decoration: none;
}
.card-header-link:hover { color: var(--schools-fg); }
/* Same look as the link it replaced — the create verb is a button now. */
.card-header-btn { background: none; border: none; padding: 0; font: inherit; font-size: 12px; cursor: pointer; }

.error-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--schools-red);
  color: #fff;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 300;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.name-group-card, .add-schools-card { margin-bottom: 20px; }
.name-group-row, .add-schools-row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  flex-wrap: wrap;
}
.name-group-error { color: var(--schools-danger, #c0392b); font-size: 13px; margin-top: 8px; }

.created-links {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.class-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.empty-row {
  text-align: center;
  padding: 32px 24px;
  color: var(--schools-fg-2);
}
.empty-row-text {
  margin: 0 0 16px;
}
.empty-row-cta {
  display: inline-block;
  font-size: 1.05rem;
  padding: 14px 28px;
}

.attention-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.attention-title { font-size: 18px; margin: 0; }
.attention-list { display: flex; flex-direction: column; gap: 10px; }
.attention-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff5e5;
  border: 1px solid #f4d28a;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
}
.attention-row:hover { background: #fef0d8; }
.attention-tag {
  font-size: 11px;
  font-weight: 600;
  color: #7a5418;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 8px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
}
.attention-body { font-size: 13px; color: #5a3e10; }
.attention-cta {
  font-size: 12px;
  font-weight: 600;
  color: #7a5418;
}

/* ---------- Govt ---------- */
.govt-schools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.govt-tile {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 18px 18px;
  text-align: left;
  cursor: pointer;
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: 12px;
  font: inherit;
  color: inherit;
  transition: border-color 160ms ease-out, transform 160ms ease-out;
}
.govt-tile:hover {
  border-color: var(--schools-red);
  transform: translateY(-1px);
}
.govt-tile-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.govt-tile-avatar {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--schools-red), var(--schools-red-deep));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0.02em;
  flex: none;
}
.govt-tile-info { flex: 1; min-width: 0; }
.govt-tile-info h4 {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 400;
  margin: 0 0 2px;
  color: var(--schools-fg);
}
.govt-tile-stats {
  display: flex;
  gap: 24px;
  padding-top: 14px;
  border-top: 1px solid var(--schools-border);
}
.govt-tile-stat {
  font-size: 22px;
  line-height: 1;
  color: var(--schools-fg);
}

/* ---------- Responsive ---------- */
@media (max-width: 1024px) {
  .admin-grid { grid-template-columns: 1fr; }
  .stat-strip { grid-template-columns: repeat(2, 1fr); }
  .stat-strip--5 { grid-template-columns: repeat(3, 1fr); }
  .teacher-compact-head,
  .teacher-compact-row {
    grid-template-columns: 1.4fr 1fr 1.4fr 0.8fr 90px;
  }
}

@media (max-width: 640px) {
  .class-grid { grid-template-columns: 1fr; }
  .stat-strip,
  .stat-strip--5 { grid-template-columns: 1fr 1fr; }
  .teacher-compact-head { display: none; }
  .teacher-compact-row {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 12px;
  }
}
</style>
