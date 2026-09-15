<script setup lang="ts">
import { ref, computed, onMounted, watch, reactive, inject } from 'vue'
import FrostSelect from '@/components/FrostSelect.vue'
import { useRouter, useRoute } from 'vue-router'
import CreateClassModal from '@/components/schools/CreateClassModal.vue'
import SchoolsPasswordPrompt from '@/components/schools/SchoolsPasswordPrompt.vue'
import ClassCreatedModal from '@/components/schools/ClassCreatedModal.vue'
import MailboxCheckPrompt from '@/components/schools/MailboxCheckPrompt.vue'
import { useMailboxPrompt } from '@/composables/useMailboxPrompt'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import Sparkline from '@/components/schools/shared/Sparkline.vue'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import { formatPracticeMinutes, secondsToMinutes } from '@/composables/schools/practiceMinutes'
import { fetchClassPractice7d, ClassPracticeFetchError, type ClassAccountProgress } from '@/composables/schools/classPractice7d'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData, type ClassReport } from '@/composables/schools/useClassesData'
import { useSchoolsNav } from '@/composables/schools/useSchoolsNav'
import { getLanguageName, useI18n } from '@/composables/useI18n'
import { deriveBelt } from '@/composables/schools/belts'
import { usePlayAsClass } from '@/composables/schools/usePlayAsClass'

import { yearGroupBreakdown, practisedWithin, parseYearGroup, type YearGroupTile } from './yearGroup'
import YearGroupTiles from '@/components/schools/shared/YearGroupTiles.vue'
import ShowAll from '@/components/shared/ShowAll.vue'
import { topThree } from '@/components/shared/topThree'
import WalkOffer from '@/components/admin/WalkOffer.vue'
import { viewerPersona } from '@/walkthrough/handbook'
// A class IS one learner account (Tom's ruling, 2026-09-11, job #265), so
// there is no per-pupil sort: name, time in app, how far the class has got,
// or the phrases it practised this week — the last one is the school
// overview's phrases card broken down per class (job #624).
type SortKey = 'name' | 'hours' | 'journey' | 'phrases'
const SORT_KEYS: readonly SortKey[] = ['name', 'hours', 'journey', 'phrases']

const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const isAdminView = inject<boolean>('isAdminView', false)
const { schoolsLink } = useSchoolsNav()
const { currentUser: selectedUser, isTeacher, isSchoolAdmin } = useSchoolContext()
const explainerPersona = computed(() => viewerPersona(selectedUser.value?.platform_role ?? null, selectedUser.value?.educational_role ?? null))
const { classes: classesData, isLoading: classesLoading, error: classesError, classesLoaded, fetchClasses, createClass, getClassReport } = useClassesData()
const { canPlayAsClass, playAsClassReadOnly, launchClassSession, playError } = usePlayAsClass()
// Under View As the button is shown disabled, never hidden (job #683).
const playAsClassTitle = computed(() => (playAsClassReadOnly.value ? t('schools.playAsClass.viewAsReadOnly', 'Read only while you are viewing as someone else. A teacher can press this.') : ''))

const isCreateModalOpen = ref(false)
const createdClass = ref<any>(null)
const isCreatedModalOpen = ref(false)
const createClassError = ref<string | null>(null)
const isCreatingClass = ref(false)

// School platform-trial state — on a free TRIAL a school can only run classes in
// the ONE language it signed up for (schools.trial_course_code). Subscribing
// (platform_status === 'active') unlocks the full catalogue. Fails open: if we
// can't read it, we don't lock anyone out.
const supabase = inject('supabase', ref(null)) as any
const schoolPlatformStatus = ref<string | null>(null)
const schoolTrialCourse = ref<string | null>(null)

async function loadSchoolTrial(): Promise<void> {
  if (!supabase.value) return
  try {
    const { data: { session } } = await supabase.value.auth.getSession()
    const token = session?.access_token
    if (!token) return
    const res = await fetch('/api/school/subscription', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const data = await res.json()
    schoolPlatformStatus.value = data?.school?.platform_status ?? null
    schoolTrialCourse.value = data?.school?.trial_course_code ?? null
  } catch {
    /* non-fatal — no lock applied */
  }
}

// null = use the modal's default catalogue (subscribed, or unknown). Otherwise
// the single trial language the school is entitled to.
const schoolAvailableCourses = computed(() => {
  if (schoolPlatformStatus.value === 'active') return null
  if (!schoolTrialCourse.value) return null
  return [{ code: schoolTrialCourse.value, name: courseShortName(schoolTrialCourse.value), flag: '' }]
})

const courseFilter = ref<string>('all')
// THE URL IS THE FILTER (job #624, Tom: "everything should be tappable"): the
// school overview's cards and year-group tiles land here with ?sort=hours,
// ?practising=1 or ?year=7, and the tiles on this page set the same query, so
// a tap is a link and the back button undoes it. Read on mount and on change.
// THE DEFAULT IS ACTIVITY (Tom, 2026-09-15, job #766: "always sort
// students/classes/groups of any entity as the default by activity — the
// most logical being the in-app minutes"): time in the app this week,
// busiest first. Name and the other orders stay one tap away in Sort by.
const DEFAULT_SORT: SortKey = 'hours'
function sortFromQuery(): SortKey {
  const q = route.query.sort
  return typeof q === 'string' && (SORT_KEYS as readonly string[]).includes(q) ? (q as SortKey) : DEFAULT_SORT
}
// 'all' | 'other' | a year number as a string.
function yearFromQuery(): string {
  const q = route.query.year
  if (q === 'other') return 'other'
  return typeof q === 'string' && /^\d{1,2}$/.test(q) ? q : 'all'
}
const sortKey = ref<SortKey>(sortFromQuery())
const yearFilter = ref<string>(yearFromQuery())
const practisingOnly = ref<boolean>(route.query.practising === '1')
watch(() => [route.query.sort, route.query.year, route.query.practising], () => {
  sortKey.value = sortFromQuery()
  yearFilter.value = yearFromQuery()
  practisingOnly.value = route.query.practising === '1'
})
// The pickers write the URL too, so a sort chosen by hand is shareable and
// the tiles' links and the pickers never disagree about the page's state.
watch(sortKey, (k) => {
  if (k !== sortFromQuery()) void router.replace({ query: { ...route.query, sort: k === DEFAULT_SORT ? undefined : k } })
})
function clearYearFilter(): void {
  void router.replace({ query: { ...route.query, year: undefined } })
}
function clearPractisingFilter(): void {
  void router.replace({ query: { ...route.query, practising: undefined } })
}
// A year-group tile links to this same page filtered to that year; a per-class
// tile (fewer than half the names parse) opens the class itself.
function yearTileLink(tile: YearGroupTile): string | null {
  if (tile.name) return schoolsLink('class-detail', { classId: tile.key.replace(/^class:/, '') })
  const year = tile.year === null ? 'other' : String(tile.year)
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(route.query ?? {})) if (typeof v === 'string' && k !== 'year') q.set(k, v)
  q.set('year', year)
  return `${schoolsLink('classes')}?${q.toString()}`
}
const yearFilterLabel = computed(() => (yearFilter.value === 'other'
  ? t('schools.yearGroupTiles.other', 'Other')
  : t('schools.yearGroupTiles.year', 'Year {n}').replace('{n}', yearFilter.value)))
// At phone width the table becomes one card per class, and the ONE number the
// admin sorted by sits beside the class name; the rest stack underneath. When
// the sort is by name, the pinned number is time in app, the school metric.
const pinnedKey = computed<Exclude<SortKey, 'name'>>(() => (sortKey.value === 'name' ? 'hours' : sortKey.value))

const classReports = reactive(new Map<string, ClassReport>())

// Real 7-day TIME IN THE APP per class, from /api/school/class-practice-7d:
// in-app session time off the diary, gaps included, whole-class play counted
// once (founder ruling 2026-09-10, api/_utils/inAppTime.ts). Empty until
// loaded → minutesWk = 0.
const practice7dSeconds = ref<Record<string, number>>({})
// THE CLASS ACCOUNT'S OWN PROGRESS per class, from the same payload (Tom's
// ruling, 2026-09-11, job #265): a class is one learner account, so its row
// shows that account's journey, belt, activity and minutes — never a
// per-pupil count, which on a shared-screen class is always 0 and lies.
const classAccounts = ref<Record<string, ClassAccountProgress>>({})
const practiceLoaded = ref(false)
// Set when the practice fetch FAILS: the banner says so, with the status and
// the server's own words, and offers Retry. Never dots that read like data
// (job #301, 2026-09-12 — Tom's staging shot under View-as: 34 rows of "…",
// "0 min in the app this week", and no word of why).
const practiceError = ref<string | null>(null)

async function loadPractice7d() {
  if (!supabase.value) return
  const classIds = classesData.value.map(c => c.id)
  if (classIds.length === 0) { practice7dSeconds.value = {}; return }
  try {
    // Shared with the class page (classPractice7d.ts) so both read the same
    // class-account figures; under View-as it names the school being read.
    const data = await fetchClassPractice7d(classIds, selectedUser.value, supabase.value)
    // The CLASS ACCOUNT's own play. practiceByClass is the pupils' own accounts
    // and is never added to this (Tom, 2026-09-14, job #662).
    practice7dSeconds.value = data.classPlayByClass
    classAccounts.value = data.classAccountByClass
    practiceLoaded.value = true
    practiceError.value = null
  } catch (err) {
    // Loud, not silent: the rows stay honestly unloaded AND the page says why.
    const status = err instanceof ClassPracticeFetchError ? err.status : 0
    const detail = err instanceof Error && err.message ? err.message : 'network error'
    practiceError.value = status ? `${detail} (HTTP ${status})` : detail
  }
}

async function fetchReportsForClasses() {
  for (const cls of classesData.value) {
    try {
      const report = await getClassReport(cls.id)
      if (report) classReports.set(cls.id, report)
    } catch {
      // benchmark optional
    }
  }
}


function courseShortName(code: string): string {
  const match = code?.match(/^([a-z_]+?)_for_/)
  return match ? getLanguageName(match[1]) : code
}

const enrichedClasses = computed(() => {
  return classesData.value.map(c => {
    const report = classReports.get(c.id)
    // Real 7-day MINUTES in the app for the class, from /api/school/class-practice-7d
    // (in-app session time, never audio-played seconds — that rides in the same
    // payload as audioPlayedByClass, the secondary figure). 0 until loaded.
    // Minutes, never hours (Tom, 2026-09-11, job #265).
    const minutesWk = secondsToMinutes(practice7dSeconds.value[c.id] ?? 0)
    const acct = classAccounts.value[c.id]
    // null until the payload lands; false = the account has never played,
    // and the row then says "Not started" in words, never a line of zeros.
    const started: boolean | null = practiceLoaded.value ? (acct?.started ?? false) : null
    return {
      id: c.id,
      class_name: c.class_name,
      course_code: c.course_code,
      course_label: courseShortName(c.course_code),
      teacher_user_id: c.teacher_user_id,
      join_code: c.student_join_code,
      // The class's OWN learner id rides the row because Play as class stores
      // it as the identity the session's telemetry belongs to. This row had
      // no such key on staging 2026-09-14 21:32Z, and a class session's
      // player_events went to the teacher (job #733).
      class_learner_id: c.class_learner_id ?? null,
      started,
      // The class's OWN belt, from its play-as-class position — the seed the
      // class has reached — exactly as the class page derives it.
      class_belt: deriveBelt(acct?.seedNumber ?? 0),
      current_seed: c.current_seed,
      journeyDone: acct?.journeyDone ?? 0,
      journeyTotal: acct?.journeyTotal ?? (c.journey_total ?? 0),
      lastPractisedAt: acct?.lastPractisedAt ?? null,
      phrases7d: acct?.phrases7d ?? 0,
      minutesWk,
      sessions: report?.class.total_sessions ?? 0,
      active_days: report?.class.active_days_last_7 ?? 0,
      // The class account's own minutes in the app per day, last seven days.
      activity: acct?.minutesByDay ?? [0, 0, 0, 0, 0, 0, 0],
      // No grade on a class. The school admin wants time in the app, and
      // that is basically it (Tom's ruling, 2026-09-13, job #494).
    }
  })
})

const sortOptions = computed<{ value: SortKey; label: string }[]>(() => [
  { value: 'name', label: t('schools.teacherDashboard.sortName', 'Name') },
  { value: 'hours', label: t('schools.teacherDashboard.sortTimeInApp', 'Time in app') },
  { value: 'journey', label: t('schools.teacherDashboard.sortJourney', 'Journey') },
  { value: 'phrases', label: t('schools.teacherDashboard.sortPhrases', 'Phrases practised this week') },
])
const courses = computed(() => {
  const set = new Set(enrichedClasses.value.map(c => c.course_label))
  return Array.from(set).sort()
})
const courseFilterOptions = computed(() => [
  { value: 'all', label: t('schools.teacherDashboard.allCourses', 'All courses') },
  ...courses.value.map((c) => ({ value: c, label: c })),
])

const filtered = computed(() => {
  let rows = enrichedClasses.value.slice()
  if (courseFilter.value !== 'all') {
    rows = rows.filter(r => r.course_label === courseFilter.value)
  }
  if (yearFilter.value !== 'all') {
    const want = yearFilter.value === 'other' ? null : Number(yearFilter.value)
    rows = rows.filter(r => parseYearGroup(r.class_name) === want)
  }
  if (practisingOnly.value) {
    rows = rows.filter(r => practisedWithin(r.lastPractisedAt))
  }
  rows.sort((a, b) => {
    if (sortKey.value === 'name') return a.class_name.localeCompare(b.class_name)
    if (sortKey.value === 'hours') return b.minutesWk - a.minutesWk || a.class_name.localeCompare(b.class_name)
    if (sortKey.value === 'journey') return b.journeyDone - a.journeyDone
    if (sortKey.value === 'phrases') return b.phrases7d - a.phrases7d
    return 0
  })
  return rows
})

const totalMinutes = computed(() => filtered.value.reduce((sum, c) => sum + c.minutesWk, 0))

// THREE ROWS THEN SHOW ALL (Tom, 2026-09-12; components/shared/topThree.ts):
// the table renders the first three of the filtered, sorted rows and one
// control that shows the rest. A filter or sort changes which three; the
// fold applies to whatever the pickers produced. Per visit, never sticky.
const showAllClasses = ref(false)
const rowsShown = computed(() => topThree(filtered.value, showAllClasses.value))
const showAllClassesLabel = computed(() => t('schools.teacherDashboard.showAllClasses', 'Show all {n} classes').replace('{n}', String(filtered.value.length)))

// YEAR-GROUP SUB-TILES under the page head (Option A, job #306): the same
// rule and the same tiles as the leader home (views/schools/yearGroup.ts,
// YearGroupTiles.vue), fed from the class-account figures this page already
// holds. Drawn only once the practice payload has landed — before that the
// numbers would be zeros that read like data.
// The tile's minutes are the row's minutesWk, so the tiles, the rows and the
// summary line above them are one figure (job #766). A year tile is fed the
// row's SECONDS too, so the group sums seconds and rounds up once like the
// headline, rather than summing minutes already rounded up per class (job #772).
const yearGroups = computed(() => yearGroupBreakdown(enrichedClasses.value.map(c => {
  const acct = classAccounts.value[c.id]
  return { id: c.id, name: c.class_name, minutes7d: c.minutesWk, seconds7d: practice7dSeconds.value[c.id] ?? 0, phrases7d: acct?.phrases7d ?? 0, practising: practisedWithin(acct?.lastPractisedAt) }
})))
const showYearGroups = computed(() => practiceLoaded.value && enrichedClasses.value.length > 0)

const headlineTitle = computed(() => {
  if (isSchoolAdmin.value) return t('schools.teacherDashboard.classesTitle', 'Classes')
  if (isTeacher.value) return t('schools.teacherDashboard.myClassesTitle', 'My Classes')
  return t('schools.teacherDashboard.classesTitle', 'Classes')
})

const headlineSubtitle = computed(() => {
  const classWord = enrichedClasses.value.length === 1
    ? t('schools.teacherDashboard.classSingular', 'class')
    : t('schools.teacherDashboard.classPlural', 'classes')
  const base = selectedUser.value?.school_name
    ? t('schools.teacherDashboard.summaryWithSchoolMinutes', '{n} {classWord} across {school} · {minutes} played as class this week')
        .replace('{school}', selectedUser.value.school_name)
    : t('schools.teacherDashboard.summaryNoSchoolMinutes', '{n} {classWord} · {minutes} played as class this week')
  return base
    .replace('{n}', String(enrichedClasses.value.length))
    .replace('{classWord}', classWord)
    .replace('{minutes}', formatPracticeMinutes(totalMinutes.value))
})

// The ONE refresh protocol: one loader for this classes dashboard, driving the
// navbar button + pull-to-refresh. Initial load routes through it (spinner +
// honest "Updated HH:MM"). No polling — the roster holds still until refreshed.
async function loadDashboard(): Promise<void> {
  if (selectedUser.value) {
    await fetchClasses()
    fetchReportsForClasses()
    loadPractice7d()
  }
  if (isSchoolAdmin.value && !isAdminView) loadSchoolTrial()
}
const { registerRefresh, refresh } = useDashboardRefresh()
registerRefresh(loadDashboard, { immediate: false })

onMounted(async () => {
  await refresh()
  // Deep-linked from the dashboard's "Create class" CTA → open the form straight away.
  if (!isAdminView && router.currentRoute.value.query.create) openCreateModal()
})

watch(selectedUser, async (newUser) => {
  if (newUser) {
    classReports.clear()
    practice7dSeconds.value = {}
    await fetchClasses()
    fetchReportsForClasses()
    loadPractice7d()
  }
})

watch(classesData, () => {
  fetchReportsForClasses()
  loadPractice7d()
})

function openCreateModal() {
  isCreateModalOpen.value = true
}

function closeCreateModal() {
  isCreateModalOpen.value = false
}

async function handleCreateClass(params: { class_name: string; course_code: string }) {
  if (isCreatingClass.value) return
  createClassError.value = null
  const schoolId = selectedUser.value?.school_id ?? null
  // A school admin's account is always tied to a school — a missing id there
  // is a genuine data problem. A teacher with no school_id is a groupless
  // tutor (THE-MODEL §1.3/I5), not an error — their classes affiliate to no
  // group node, exactly like the personal /teach lane always has.
  if (!schoolId && isSchoolAdmin.value) {
    createClassError.value = t('schools.teacherDashboard.noSchoolFoundError', 'No school found for your account. Please contact an administrator.')
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
      closeCreateModal()
      createdClass.value = newClass
      isCreatedModalOpen.value = true
    } else {
      createClassError.value = t('schools.teacherDashboard.createClassFailedError', 'Failed to create class. Please try again.')
    }
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

function openClass(cls: { id: string; class_name: string; course_code: string; current_seed: number; join_code: string; class_learner_id: string | null }) {
  const stored = {
    id: cls.id,
    class_name: cls.class_name,
    course_code: cls.course_code,
    current_seed: cls.current_seed,
    student_join_code: cls.join_code,
    class_learner_id: cls.class_learner_id ?? null,
  }
  sessionStorage.setItem('ssi-class-detail', JSON.stringify(stored))
  router.push({ path: schoolsLink('class-detail', { classId: cls.id }) })
}

// Play-as-class straight from the row's right-hand action (mirrors ClassDetail /
// DashboardView): one shared launch path in usePlayAsClass.launchClassSession.
async function handlePlayClass(cls: { id: string; class_name: string; course_code: string; current_seed: number; join_code: string; class_learner_id: string | null }) {
  await launchClassSession(cls)
}

// Per-class share link + one-click copy (mirrors the tutor dashboard so the
// school lane gets the same "create class → copy link → fill roster" flow).
const origin = typeof window !== 'undefined' ? window.location.origin : ''
const copiedClassId = ref<string | null>(null)
function shareUrlFor(cls: { join_code: string }): string {
  return `${origin}/with/${cls.join_code}`
}
async function copyShareLink(cls: { id: string; join_code: string }) {
  try {
    await navigator.clipboard.writeText(shareUrlFor(cls))
    copiedClassId.value = cls.id
    setTimeout(() => { if (copiedClassId.value === cls.id) copiedClassId.value = null }, 2000)
  } catch {
    /* clipboard blocked — the input is still selectable as a fallback */
  }
}

function exportCsv() {
  const header = ['Class', 'Course', 'Belt', 'Journey phrases', 'Journey total', 'Played as class this week', 'Sessions', 'Join code']
  const rows = filtered.value.map(c => [
    c.class_name,
    c.course_label,
    c.started === false ? 'Not started' : c.class_belt,
    c.journeyDone,
    c.journeyTotal,
    c.minutesWk,
    c.sessions,
    c.join_code,
  ].join(','))
  const csv = [header.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `classes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <main class="dashboard">
    <!-- A password is the one way back in that needs no inbox. -->
    <SchoolsPasswordPrompt />

    <div class="page-head">
      <div class="page-head-text">
        <h1 class="arsenal page-title">{{ headlineTitle }}</h1>
        <WalkOffer :persona="explainerPersona" place="classes" />
        <p class="page-subtitle schools-subtle">
          <router-link :to="{ query: { ...route.query, sort: 'hours' } }" class="subtitle-link">{{ headlineSubtitle }}</router-link>
          <UpdatedStamp />
        </p>
      </div>
      <div class="page-head-actions">
        <!-- HANDBOOK Export your class list
             section: running-classes
             roles: school_admin, teacher
             place: classes
             keywords: export, csv, download, report, classes
             What it's for. Taking the class list away as a spreadsheet, with the name,
             language, belt, journey in phrases, minutes in the app this week, sessions
             and join code for every class.
             Where it is. **My Classes**, the **Export CSV** button along the top.
             How you do it.
             1. Open **My Classes**.
             2. Filter the list down first if you only want part of it.
             3. Tap **Export CSV**.
             4. The file downloads with today's date in its name.
             Worth knowing. What you export is what you can see, so a filter applied to
             the table applies to the file as well.
             checked: 1bbce9a2.c8eed759
        -->
        <button data-walk="classes-export" v-if="enrichedClasses.length > 0" type="button" class="btn-ghost" @click="exportCsv">
          {{ t('schools.teacherDashboard.exportCsv', 'Export CSV') }}
        </button>
        <!-- HANDBOOK Make a class
             section: running-classes
             roles: school_admin, teacher
             place: classes
             keywords: class, create, new, make, start
             What it's for. Setting up a class of your own: a name, a language, and a
             link students use to join it. A class holds a roster, its own place on the
             course, and everything the class practises together.
             Where it is. **My Classes**, the **+ New class** button along the top of
             the page.
             How you do it.
             1. Open **My Classes**.
             2. Tap **+ New class**.
             3. Give the class a name you will recognise on a list, such as Year 7
                Welsh.
             4. Choose the language the class is learning.
             5. Tap **Create Class**.
             Worth knowing. The join link is made for you at the same moment. Nothing
             else is needed to start teaching.
             checked: f400ae55.f81ed3fe
        -->
        <button v-if="!isAdminView" type="button" class="btn-play" data-walk="verb-new-class" @click="openCreateModal">
          + {{ t('schools.teacherDashboard.newClass', 'New class') }}
        </button>
      </div>
    </div>

    <div v-if="classesError" class="fetch-error-banner">
      <span>{{ t('schools.teacherDashboard.refreshFailed', "Couldn't refresh this list — showing the last data loaded. {error}").replace('{error}', classesError) }}</span>
      <button type="button" class="btn-ghost" @click="refresh">{{ t('schools.teacherDashboard.retry', 'Retry') }}</button>
    </div>
    <div v-if="playError" class="fetch-error-banner">
      <span>{{ playError }}</span>
    </div>
    <div v-if="practiceError" class="fetch-error-banner" data-testid="practice-error">
      <span>{{ t('schools.teacherDashboard.practiceFailed', "Couldn't load this week's practice for these classes — belts, journeys and minutes are not shown. {error}").replace('{error}', practiceError) }}</span>
      <button type="button" class="btn-ghost" @click="refresh">{{ t('schools.teacherDashboard.retry', 'Retry') }}</button>
    </div>

    <!-- No summary tiles: the page head already carries the class count and
         the minutes in the app this week, and the school admin wants time in
         app and basically nothing else (Tom's ruling, 2026-09-13). -->

    <!-- HANDBOOK The classes by year group
         section: running-classes
         roles: school_admin, teacher
         place: classes
         keywords: year group, year 7, tiles, breakdown, classes practising, minutes, by class
         What it's for. A row of small tiles under the page head, one per year
         group, each headed by its year, **Y7**, **Y8** and so on: the minutes that
         year's classes spent in the app this week and how many of them practised
         out of how many there are. It says in one glance which years are the
         school's engine and which have barely started.
         Where it is. **My Classes**, the **By year group** card under the page
         head, once this week's practice has loaded.
         How you do it.
         1. Open **My Classes**.
         2. Find the year by its big label on each tile.
         3. Read the minutes under it for time in the app this week. It is the
            same minute as the page head and the class rows, added up across
            that year's classes.
         4. Read the line under that for classes practising out of classes in that
            year.
         5. Tap a tile and the table below narrows to that year's classes; a
            **Year 7 ×** chip in the pickers takes the filter off again.
         6. A tile reading **Other** holds the classes whose names carry no year.
         Worth knowing. The year is read off the class name — a leading number from
         6 to 13, so **7B**, **Year 9 French** and **10 Set 1** all count — and is
         never stored. A dash means no minutes this week. If fewer than half your
         class names carry a year the card reads **By class** instead, most
         minutes first, three then **Show all**, and each of those tiles opens its
         class.
         checked: b06eb982.097e5930
    -->
    <YearGroupTiles v-if="showYearGroups" data-walk="classes-year-groups" class="year-groups" :breakdown="yearGroups" :tile-link="yearTileLink" />

    <!-- Filters -->
    <!-- HANDBOOK Find a class in a long list
         section: running-classes
         roles: school_admin, teacher
         place: classes
         keywords: filter, sort, search, course, classes
         What it's for. Narrowing a long list down to the classes you care about right now,
         by language, and putting them in the order that answers your question.
         Where it is. **My Classes**, the strip of pickers above the table.
         How you do it.
         1. Open **My Classes**.
         2. Pick a language under **Course** to see only the classes learning it.
         3. The list opens ordered by time in app this week, most first. Change
            **Sort by** to order by name, by how far through the course each
            class has got, or by phrases practised. On a phone it is the first
            control, and the number you sorted by shows beside each class name.
         Worth knowing. The table shows
         the first three of whatever the pickers produce; **Show all** under it
         shows the rest.
         checked: 35143594.4526edb3
    -->
    <div data-walk="classes-filters" v-if="enrichedClasses.length > 0" class="filters-bar schools-card">
      <label class="filter">
        <span class="filter-label">{{ t('schools.teacherDashboard.courseLabel', 'Course') }}</span>
        <FrostSelect v-model="courseFilter" class="filter-select" :options="courseFilterOptions" :aria-label="t('schools.teacherDashboard.courseLabel', 'Course')" />
      </label>

      <div class="filter filter-sort">
        <span class="filter-label">{{ t('schools.teacherDashboard.sortLabel', 'Sort by') }}</span>
        <FrostSelect v-model="sortKey" class="filter-select" :options="sortOptions" :aria-label="t('schools.teacherDashboard.sortLabel', 'Sort by')" />
      </div>

      <!-- The filters a tap on the school overview or a year tile brought
           here, each with its own way off. -->
      <button v-if="yearFilter !== 'all'" type="button" class="filter-chip" @click="clearYearFilter">
        {{ yearFilterLabel }} <span aria-hidden="true">×</span>
      </button>
      <button v-if="practisingOnly" type="button" class="filter-chip" @click="clearPractisingFilter">
        {{ t('schools.teacherDashboard.practisingThisWeek', 'Practising this week') }} <span aria-hidden="true">×</span>
      </button>
    </div>

    <!-- Table -->
    <div v-if="filtered.length > 0" class="schools-card table-card">
      <!-- HANDBOOK Read your class list
           section: running-classes
           roles: school_admin, teacher
           place: classes
           keywords: classes, list, overview, belt, minutes, time in app
           What it's for. One row per class, showing at a glance what each one has done.
           A class is one learner account, played from the front of the room, so every
           figure on the row is that account's own: the belt the class has reached, how
           far through the course it has travelled in phrases, minutes played as class
           over the last seven days and the shape of those days. Nothing on the row
           grades the class. Played as class is time with the lesson running on the
           class account, from pressing play to stopping, pauses included — the same
           minute the class page, the school home and Insights count. Pupils' own
           practice is not in it. A class that has never played says **Not started**
           in words rather than showing a row of zeros.
           Where it is. **My Classes**, the table filling most of the page. On a
           phone each class is a card instead, with the number you sorted by beside
           its name and the rest underneath.
           How you do it.
           1. Open **My Classes**.
           2. The first three classes show; tap **Show all** under the table for
              the rest, and **Show fewer** to fold them back.
           3. Read down the time in app column first, because minutes in the lesson
              are the figure the school runs on.
           4. Use the small chart in each row to see whether practice is steady or has
              stopped.
           5. Compare time in the app this week between classes taking the same course.
           Worth knowing. A quiet week shows as low minutes and a flat chart, nothing
           more. The app makes no judgement about how a class is doing.
           checked: f93e3ed0.340055e2
      -->
      <table class="ssi-table" data-walk="classes-table" :data-sorted="pinnedKey">
        <thead>
          <tr>
            <th>{{ t('schools.teacherDashboard.tableHeaderClass', 'Class') }}</th>
            <th>{{ t('schools.teacherDashboard.tableHeaderCourse', 'Course') }}</th>
            <th>{{ t('schools.teacherDashboard.tableHeaderBelt', 'Belt') }}</th>
            <th>{{ t('schools.teacherDashboard.tableHeaderJourney', 'Journey, phrases') }}</th>
            <th>{{ t('schools.teacherDashboard.tableHeaderTimeInApp', 'Played as class, this week') }}</th>
            <th>{{ t('schools.teacherDashboard.tableHeaderPhrases', 'Phrases practised this week') }}</th>
            <th>{{ t('schools.teacherDashboard.tableHeaderActivity', 'Activity') }}</th>
            <th>{{ t('schools.teacherDashboard.tableHeaderShare', 'Share') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <!-- HANDBOOK Open a class
               section: running-classes
               roles: school_admin, teacher
               place: classes
               keywords: class, open, detail, roster, view
               What it's for. Going from the summary row into the class itself.
               A school leader lands on the class's own page: what it practised
               this week, its minutes in the app, how far it has travelled and
               who teaches it, with **Invite students** and **See insights** at
               the top. A teacher lands on the class tools: the roster, the
               teachers, the join link and the class's progress.
               Where it is. **My Classes**, anywhere on the class's row.
               How you do it.
               1. Open **My Classes**.
               2. Tap the row for the class you want.
               3. The class page opens.
               Worth knowing. The row is a button in its own right, so a keyboard
               works too. The buttons at the right of the row do their own jobs and
               do not open the class.
               checked: a021ba99.b9c5c0f1
          -->
          <tr
            v-for="cls in rowsShown.shown"
            :key="cls.id"
            class="row-clickable"
            data-walk="classes-row"
            tabindex="0"
            role="button"
            :aria-label="t('schools.teacherDashboard.openClassAriaLabel', 'Open {name}').replace('{name}', cls.class_name)"
            @click="openClass(cls)"
            @keyup.enter="openClass(cls)"
          >
            <td class="cell-class">
              <div class="cell-name">{{ cls.class_name }}</div>
              <div class="cell-code">{{ cls.join_code }}</div>
            </td>
            <td :data-label="t('schools.teacherDashboard.tableHeaderCourse', 'Course')"><span class="schools-subtle">{{ cls.course_label }}</span></td>
            <!-- A class account that has never played says so in words on
                 every cell (Tom's ruling, 2026-09-11): never a row of zeros. -->
            <td :data-label="t('schools.teacherDashboard.tableHeaderBelt', 'Belt')">
              <span v-if="cls.started === false" class="schools-subtle not-started">{{ t('schools.teacherDashboard.notStarted', 'Not started') }}</span>
              <div v-else class="cell-belt">
                <BeltDot :belt="cls.class_belt" :size="16" ring />
                <span class="belt-name">{{ cls.class_belt }}</span>
              </div>
            </td>
            <td :data-label="t('schools.teacherDashboard.tableHeaderJourney', 'Journey, phrases')" :class="{ 'is-sorted': pinnedKey === 'journey' }">
              <template v-if="cls.started === false">{{ t('schools.teacherDashboard.notStarted', 'Not started') }}</template>
              <template v-else-if="cls.started === null">…</template>
              <template v-else>{{ cls.journeyDone }}<span class="schools-subtle"> / {{ cls.journeyTotal }}</span></template>
            </td>
            <td :data-label="t('schools.teacherDashboard.tableHeaderTimeInApp', 'Played as class, this week')" :class="{ 'is-sorted': pinnedKey === 'hours' }">
              <template v-if="cls.started === false">{{ t('schools.teacherDashboard.notStarted', 'Not started') }}</template>
              <template v-else-if="cls.started === null">…</template>
              <template v-else>{{ formatPracticeMinutes(cls.minutesWk) }}</template>
            </td>
            <td :data-label="t('schools.teacherDashboard.tableHeaderPhrases', 'Phrases practised this week')" :class="{ 'is-sorted': pinnedKey === 'phrases' }">
              <template v-if="cls.started === false">{{ t('schools.teacherDashboard.notStarted', 'Not started') }}</template>
              <template v-else-if="cls.started === null">…</template>
              <template v-else>{{ cls.phrases7d }}</template>
            </td>
            <td :data-label="t('schools.teacherDashboard.tableHeaderActivity', 'Activity')"><Sparkline v-if="cls.started" :data="cls.activity" :width="80" :height="20" /><span v-else class="schools-subtle">—</span></td>
            <td class="cell-share">
              <!-- HANDBOOK Copy a class link without opening the class
                   section: getting-people-in
                   roles: school_admin, teacher
                   place: classes
                   keywords: copy, link, share, join, classes
                   What it's for. Grabbing a class's join link straight from the
                   class list, for when you are sending links to several classes
                   in one sitting.
                   Where it is. **My Classes**, the **Copy link** button in each
                   row.
                   How you do it.
                   1. Open **My Classes**.
                   2. Find the class's row.
                   3. Tap **Copy link**.
                   4. Paste it into your email or your lesson slide.
                   Worth knowing. It is the same link the class page offers, so a
                   student who follows it lands in that class either way.
                   checked: 0500adc5.08226b73
              -->
              <button type="button" class="share-btn" data-walk="classes-share-link" @click.stop="copyShareLink(cls)" :title="shareUrlFor(cls)">
                {{ copiedClassId === cls.id ? t('schools.teacherDashboard.copied', 'Copied ✓') : t('schools.teacherDashboard.copyLink', 'Copy link') }}
              </button>
            </td>
            <td class="cell-action">
              <!-- HANDBOOK Start a class session from the list
                   section: running-classes
                   roles: school_admin, teacher
                   place: classes
                   keywords: play, session, class, start, lesson
                   What it's for. Starting a shared practice session for a class
                   without opening the class first. Your device leads and the
                   whole class moves together from where the class last got to.
                   Where it is. **My Classes**, the **Play as class** button at
                   the end of the class's row.
                   How you do it.
                   1. Open **My Classes**.
                   2. Find the class you are about to teach.
                   3. Tap **Play as class** at the end of its row.
                   4. The player opens on that class's course, at the class's own
                      place in it.
                   Worth knowing. It is the same session the class page starts,
                   so it moves the class on for everyone on the roster. Only
                   school staff see this button. While a platform admin is
                   viewing the dashboard as you it is greyed out and does
                   nothing, so they can see what you have without starting a
                   lesson in your name.
                   checked: 56db392c.1333b484
              -->
              <button v-if="canPlayAsClass" type="button" class="row-play-btn" data-walk="classes-row-play" :disabled="playAsClassReadOnly" :title="playAsClassTitle" @click.stop="handlePlayClass(cls)">▶ {{ t('schools.teacherDashboard.playAsClass', 'Play as class') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="rowsShown.collapsible" class="table-show-all">
        <ShowAll :expanded="showAllClasses" :label="showAllClassesLabel" @toggle="showAllClasses = !showAllClasses" />
      </div>
    </div>

    <!-- Filtered-empty state (classes exist but filters hide them) -->
    <div v-else-if="enrichedClasses.length > 0" class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.teacherDashboard.noClassesMatchFilters', 'No classes match those filters') }}</h3>
      <p class="empty-text schools-subtle">{{ t('schools.teacherDashboard.tryWideningCourseFilter', 'Try widening the course filter.') }}</p>
      <button
        type="button"
        class="btn-ghost"
        @click="() => { courseFilter = 'all'; void router.replace({ query: { ...route.query, year: undefined, practising: undefined } }) }"
      >
        {{ t('schools.teacherDashboard.resetFilters', 'Reset filters') }}
      </button>
    </div>

    <!-- Still loading, nothing cached yet -->
    <div v-else-if="classesLoading" class="empty-state schools-card schools-card-pad">
      <p class="schools-subtle">{{ t('schools.teacherDashboard.loadingClasses', 'Loading your classes…') }}</p>
    </div>

    <!-- Fetch failed -->
    <div v-else-if="classesError" class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.teacherDashboard.couldntLoadClasses', "Couldn't load classes") }}</h3>
      <p class="empty-text schools-subtle">{{ classesError }}</p>
    </div>

    <!-- Read never resolved cleanly — say so instead of asserting emptiness.
         "No classes yet" is a claim about the world; it may only be made once
         a read has actually come back clean and empty (classesLoaded). -->
    <div v-else-if="!classesLoaded" class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.teacherDashboard.couldntLoadClasses', "Couldn't load classes") }}</h3>
      <p class="empty-text schools-subtle">{{ t('schools.teacherDashboard.noAnswerTryRefreshing', "We didn't get an answer for this list. Try refreshing.") }}</p>
    </div>

    <!-- No classes at all -->
    <div v-else class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.teacherDashboard.noClassesYet', 'No classes yet') }}</h3>
      <p class="empty-text schools-subtle">
        {{ t('schools.teacherDashboard.createFirstClassBody', 'Create your first class to start teaching with SSi. Students join with a unique code.') }}
      </p>
      <!-- A teacher who has just joined an existing school through her head's
           invite link sees this same screen, and her school's classes are
           invisible to her until someone puts her on one. "Create your first
           class" then reads as "make a duplicate of the class you were
           invited to teach" (production walk, 2026-08-31). -->
      <p v-if="isTeacher && !isSchoolAdmin" class="empty-text schools-subtle">
        {{ t('schools.teacherDashboard.joinedSchoolNote', 'Joined a school that already has classes? A school leader has to put you on one — ask them to add you, and it will appear here.') }}
      </p>
      <button v-if="!isAdminView" type="button" class="btn-play" @click="openCreateModal">
        + {{ t('schools.teacherDashboard.createFirstClass', 'Create your first class') }}
      </button>
    </div>

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
      :availableCourses="schoolAvailableCourses"
      lockedNote="Subscribe to teach more languages"
      @close="closeCreateModal"
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
  </main>
</template>

<style scoped>
.dashboard {
  padding: 22px 28px 32px;
  max-width: 1320px;
  margin: 0 auto;
}

.fetch-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--schools-red);
  border: 1px solid rgba(var(--tone-red, 194, 58, 58), 0.28);
  background: rgba(var(--tone-red, 194, 58, 58), 0.06);
  border-radius: 8px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.page-head-text { min-width: 280px; flex: 1; }

.page-title {
  font-size: 32px;
  line-height: 1.05;
}

.page-subtitle {
  font-size: 13.5px;
  margin-top: 4px;
}

.page-head-actions {
  display: flex;
  gap: 8px;
}

.subtitle-link { color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor; }
.subtitle-link:hover { color: var(--schools-fg); }
.filter-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; min-height: 32px;
  border: 1px solid rgba(44, 38, 34, 0.18); border-radius: 999px; background: #fff;
  font: inherit; font-size: 13px; color: var(--schools-fg); cursor: pointer;
}
.filter-chip:hover { border-color: var(--schools-red); }

.filters-bar {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 18px;
  margin-bottom: 12px;
}

.filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.filter-sort {
  margin-left: auto;
}

.filter-label {
  font-size: 12px;
  color: var(--schools-fg-2);
}

.filter-select {
  /* FrostSelect reads these; the shared dropdown wears this page's look. */
  min-width: 190px;
  --fs-font: var(--font-body); --fs-bg: #fff; --rc-entity: 219 30 23; --rc-entity-ink: var(--schools-red); --fs-font-size: 12.5px; --fs-radius: 6px; --fs-border: var(--schools-border-strong);
}


.table-card {
  overflow: hidden;
}
.table-show-all { padding: 6px 14px 10px; border-top: 1px solid var(--schools-border, #d8d4cd); }
.year-groups { margin-bottom: 14px; }

.cell-name {
  font-weight: 600;
  color: var(--schools-fg);
}

.cell-code {
  font-size: 11px;
  color: var(--schools-fg-3);
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  margin-top: 2px;
}

.cell-belt {
  display: flex;
  align-items: center;
  gap: 8px;
}

.belt-name {
  text-transform: capitalize;
}

/* The whole class row opens the class page; the Share/Play buttons stop
   propagation so they act on their own. */
.row-clickable { cursor: pointer; }
.row-clickable:hover { background: #f6f5f1; }
.row-clickable:focus-visible { outline: 2px solid var(--schools-red); outline-offset: -2px; }

.cell-action {
  text-align: right;
}

.row-play-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: var(--schools-red);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}
.row-play-btn:hover { background: var(--schools-red-deep); }

.cell-link {
  font-size: 12px;
  color: var(--schools-red);
  text-decoration: none;
  font-weight: 600;
  white-space: nowrap;
}

.cell-link:hover {
  color: var(--schools-red-deep);
}

.cell-share {
  white-space: nowrap;
}

.share-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--schools-border, #d8d4cd);
  background: var(--schools-card, #fff);
  color: var(--schools-fg, #2a2a2a);
  cursor: pointer;
  white-space: nowrap;
}

.share-btn:hover {
  border-color: var(--schools-red);
  color: var(--schools-red);
}

.empty-state {
  text-align: center;
  padding: 56px 32px;
  max-width: 520px;
  margin: 24px auto;
}

.empty-title {
  font-size: 22px;
  margin-bottom: 8px;
}

.empty-text {
  font-size: 14px;
  margin-bottom: 18px;
  line-height: 1.5;
}

.error-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--schools-red);
  color: #fff;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 0.875rem;
  cursor: pointer;
  z-index: 10000;
  box-shadow: var(--schools-shadow-md);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }


@media (max-width: 960px) {
  .dashboard { padding: 18px 16px 28px; }
  .filter-sort { margin-left: 0; }
  .table-card { overflow-x: auto; }
  .table-card .ssi-table { min-width: 760px; }
}

/* PHONE: one card per class. A 760px table at 390px hid Time in app, Activity
   and Share off the right edge with no cue (job #259, 2026-09-11). The
   sort picker comes first and the number sorted by sits beside the class name;
   every other cell stacks underneath with its column name in front of it. */
@media (max-width: 640px) {
  .filters-bar { gap: 10px; padding: 12px 14px; }
  .filter, .filter-sort { display: flex; width: 100%; justify-content: space-between; }
  .filter-sort { order: -1; }
  .filter-sort .filter-label { font-weight: 600; color: var(--schools-fg); }
  .filter-select { flex: 0 1 60%; }

  .table-card { overflow: visible; }
  .table-card .ssi-table { min-width: 0; display: block; }
  .table-card .ssi-table thead { display: none; }
  .table-card .ssi-table tbody { display: block; }
  .table-card .ssi-table tbody tr {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 12px;
    row-gap: 6px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--schools-border);
  }
  .table-card .ssi-table tbody tr:last-child { border-bottom: none; }
  .table-card .ssi-table tbody td { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 0; border: none; background: none; grid-column: 1 / -1; font-size: 12.5px; }
  .table-card .ssi-table tbody td[data-label]::before { content: attr(data-label); color: var(--schools-fg-2); }
  .table-card .ssi-table tbody td.cell-class { grid-column: 1; grid-row: 1; display: block; }
  .table-card .ssi-table tbody td.is-sorted { grid-column: 2; grid-row: 1; flex-direction: column; align-items: flex-end; gap: 0; font-size: 1.25rem; font-weight: 600; color: var(--schools-fg); }
  .table-card .ssi-table tbody td.is-sorted::before { font-size: 11px; font-weight: 400; }
  .table-card .ssi-table tbody td.cell-share,
  .table-card .ssi-table tbody td.cell-action { grid-column: auto; justify-content: flex-start; padding-top: 4px; }
}
</style>
