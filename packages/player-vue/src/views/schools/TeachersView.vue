<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useTeachersData } from '@/composables/schools/useTeachersData'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { useClassesData } from '@/composables/schools/useClassesData'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'
import AssignClassesModal from '@/components/schools/AssignClassesModal.vue'
import { orderPending, settledStaff } from '@/composables/schools/teacherRosterSections'
import {
  applyAssignmentDiff,
  computeAssignmentDiff,
  summariseOutcomes,
  type AssignableClass,
  type AssignmentOutcome,
} from '@/composables/schools/assignTeacherClasses'

type TeacherStatus = 'active' | 'invited'

const { t } = useI18n()

const isAdminView = inject<boolean>('isAdminView', false)
const { currentUser: selectedUser, isSchoolAdmin, isGovtAdmin } = useSchoolContext()
const { teachers: teachersData, isLoading: teachersLoading, error: teachersError, fetchTeachers, removeTeacher, createStaffSigninLink } = useTeachersData()
const { currentSchool, fetchSchools } = useSchoolData()
const {
  classes,
  isLoading: classesLoading,
  error: classesError,
  fetchClasses,
  addClassTeacher,
  removeClassTeacher,
} = useClassesData()

// Staff-management controls (invite, bulk import, remove) are admin-only —
// a plain teacher could see and use them even though the endpoints they hit
// are admin-gated (finding, 2026-07-16 teacher-loop audit). Hidden, not
// disabled, matching how isAdminView already hides them for ssi_admin's
// read-only browse view.
const canManageStaff = computed(() => isSchoolAdmin.value && !isAdminView)
// Who may put a teacher ONTO a class from here. Same leaders ClassDetail's
// canManageTeachers already trusts (govt admin over the group, or the
// school's admin) — its third arm, "the class's own lead teacher", can't
// apply on a school-wide staff list, and the server
// (api/_utils/classTeacherAuth.ts) is the real gate either way.
const canAssignClasses = computed(() => (isSchoolAdmin.value || isGovtAdmin.value) && !isAdminView)
const removeError = ref('')

const searchQuery = ref('')

const teacherJoinCode = computed(() => currentSchool.value?.teacher_join_code || 'N/A')
// Same /redeem/:code door as every other invite in the app (group leader,
// school admin, class join — see ClassDetail.vue's classJoinLink).
const teacherJoinLink = computed(() => {
  if (teacherJoinCode.value === 'N/A') return ''
  return `${window.location.origin}/redeem/${teacherJoinCode.value}`
})

function getInitials(name: string): string {
  return name.split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

// Teachers trialling the platform practice for minutes, not hours — "0h"
// for someone who genuinely practised reads as "tracking is broken".
function formatOwnPractice(minutes: number): string {
  if (minutes >= 60) return `${Math.round((minutes / 60) * 10) / 10}h`
  return `${minutes}m`
}

function formatJoined(joinedAt: string | null | undefined): string {
  const dateStr = joinedAt
    ? new Date(joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : t('schools.teachers.recently', 'recently')
  return t('schools.teachers.joinedLabel', 'Joined {date}').replace('{date}', dateStr)
}

const teachers = computed(() => {
  return teachersData.value.map(row => ({
    id: row.learner_id,
    user_id: row.user_id,
    name: row.display_name,
    initials: getInitials(row.display_name),
    classes: row.class_count,
    students: row.student_count,
    hours7d: row.total_practice_hours,
    ownMinutes: row.own_practice_minutes ?? 0,
    // The school's admin belongs in this list (she is staff, and her practice
    // is in the school's headline) but must be shown as the ADMIN she is —
    // never mislabelled a teacher. See api/_utils/schoolStaff.ts.
    // `role` stays the raw untranslated marker used for logic (e.g. hiding
    // Remove on admin rows); `roleLabel` is what's shown on screen.
    role: (row.role_in_context === 'admin' ? 'Admin' : 'Teacher') as 'Teacher' | 'Admin',
    roleLabel: row.role_in_context === 'admin' ? t('schools.teachers.roleAdmin', 'Admin') : t('schools.teachers.roleTeacher', 'Teacher'),
    status: 'active' as TeacherStatus,
    joined_at: row.joined_at,
    // THE VOUCH (school-belonging design, 2026-09-09). Belonging to this
    // school is not a property of an address; it is the act of somebody who
    // already holds the school putting this person on a class. The "Unverified
    // address" pill that used to sit here compared the address they typed
    // against a domain the school had claimed — a match that only one school
    // in eight could ever produce and that proved nothing about the mailbox.
    // It is gone. What replaces it is a section on this page.
    vouchedBy: row.vouched_by,
    vouchedAt: row.vouched_at,
    selfAssigned: row.self_assigned === true,
    onDomain: row.on_domain,
  }))
})

// PENDING = given no classes yet. That is the whole test, and it is the thing
// the admin can act on: tick a class and they are in, or Remove them. A
// teacher who made their own classes is NOT pending — 45 of 97 school-tagged
// teachers in the live estate are in exactly that state, and flagging them
// would be noise the admin learns to ignore. The rule itself lives in
// composables/schools/teacherRosterSections.ts, pure and proved there.
const searchMatches = computed(() => {
  if (!searchQuery.value.trim()) return teachers.value
  const q = searchQuery.value.toLowerCase()
  return teachers.value.filter(t => t.name.toLowerCase().includes(q))
})

const filtered = computed(() => settledStaff(searchMatches.value))

// The domain match survives here and ONLY here: as the ORDER of this list, so
// the admin's eye lands first on the arrivals who look least like their staff.
// It grants nothing and blocks nothing.
const pendingArrivals = computed(() => orderPending(searchMatches.value))

// Who vouched for this person, as a NAME rather than a uid — nearly always
// somebody else on this very list. Unresolvable ones say nothing rather than
// showing an id.
const nameByUserId = computed(() => new Map(teachers.value.map(t => [t.user_id, t.name])))
function vouchLine(row: { vouchedBy: string | null; vouchedAt: string | null }): string {
  if (!row.vouchedBy || !row.vouchedAt) return ''
  const who = nameByUserId.value.get(row.vouchedBy)
  if (!who) return ''
  const when = new Date(row.vouchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return t('schools.teachers.vouchedBy', 'Given classes by {who}, {date}')
    .replace('{who}', who)
    .replace('{date}', when)
}

// ONE table, two sections. The pending arrivals come first because they are
// the rows that want doing something about; everyone else follows. Rendering
// them from a single list keeps the row markup — and the three capabilities
// living on it — in exactly one place.
const orderedRows = computed(() => [...pendingArrivals.value, ...filtered.value])
const pendingHeaderIndex = computed(() => (pendingArrivals.value.length ? 0 : -1))
const settledHeaderIndex = computed(() => (pendingArrivals.value.length && filtered.value.length ? pendingArrivals.value.length : -1))

const activeCount = computed(() => teachers.value.filter(t => t.status === 'active').length)
const pendingCount = computed(() => teachers.value.filter(t => t.status === 'invited').length)

const subtitle = computed(() => {
  const count = teachers.value.length
  const countWord = count === 1
    ? t('schools.teachers.countWordSingular', 'teacher')
    : t('schools.teachers.countWordPlural', 'staff')
  const parts = [
    t('schools.teachers.countLabel', '{n} {word}').replace('{n}', String(count)).replace('{word}', countWord),
    t('schools.teachers.activeLabel', '{n} active').replace('{n}', String(activeCount.value)),
  ]
  if (pendingCount.value > 0) {
    const pendingText = pendingCount.value === 1
      ? t('schools.teachers.pendingInviteSingular', '{n} pending invite')
      : t('schools.teachers.pendingInvitePlural', '{n} pending invites')
    parts.push(pendingText.replace('{n}', String(pendingCount.value)))
  }
  return parts.join(' · ')
})

const codeCopyState = ref(false)
const showCode = ref(false)
async function copyJoinCode() {
  if (teacherJoinCode.value === 'N/A') return
  try {
    await navigator.clipboard.writeText(teacherJoinCode.value)
    codeCopyState.value = true
    setTimeout(() => { codeCopyState.value = false }, 2000)
  } catch {
    /* ignore */
  }
}

const showImportHint = ref(false)
function handleBulkImport() {
  showImportHint.value = true
  setTimeout(() => { showImportHint.value = false }, 5000)
}

const showInviteHint = ref(false)
function handleInvite() {
  showInviteHint.value = true
  setTimeout(() => { showInviteHint.value = false }, 5000)
}

async function handleRemoveTeacher(userId: string, name: string) {
  if (!confirm(t('schools.teachers.confirmRemove', 'Remove {name} from this school?').replace('{name}', name))) return
  removeError.value = ''
  const result = await removeTeacher(userId)
  if (result.ok) {
    fetchTeachers()
  } else {
    removeError.value = t('schools.teachers.couldNotRemove', 'Could not remove {name}: {error}').replace('{name}', name).replace('{error}', result.error)
    console.error(`[TeachersView] remove-staff failed for ${name}:`, result.error)
  }
}

// ── Sign-in link (the rescue for a teacher our email can't reach) ─────────
// Welsh school gateways (Hwb / Microsoft EOP) silently quarantine our code
// email, so a teacher can sit outside their own account indefinitely. Their
// own admin can hand them a working link instead — face to face, on Teams, on
// paper. Anything but our email.
const signinLinkFor = ref<{ user_id: string; name: string; code: string; joinUrl: string; email: string } | null>(null)
const signinLinkBusy = ref('')
const signinLinkError = ref('')
const signinLinkCopied = ref(false)

async function handleSigninLink(userId: string, name: string) {
  signinLinkBusy.value = userId
  signinLinkError.value = ''
  signinLinkCopied.value = false
  const result = await createStaffSigninLink(userId)
  signinLinkBusy.value = ''
  if (result.code && result.joinUrl) {
    signinLinkFor.value = { user_id: userId, name, code: result.code, joinUrl: result.joinUrl, email: result.email || '' }
  } else {
    signinLinkError.value = t('schools.teachers.couldntCreateAccessCode', "Couldn't create an access code for {name}: {error}").replace('{name}', name).replace('{error}', result.error)
  }
}

async function copySigninLink() {
  if (!signinLinkFor.value) return
  try {
    await navigator.clipboard.writeText(signinLinkFor.value.joinUrl)
    signinLinkCopied.value = true
    setTimeout(() => { signinLinkCopied.value = false }, 2000)
  } catch {
    /* the link is on screen and selectable — copying is a convenience */
  }
}

// ── Assign to a class (people-first teacher↔class management) ──────────────
// The leader is looking at their staff, not at a class: pick a teacher, tick
// the classes they should take. Ticks start from the truth and confirm
// applies the diff, so "move Ana from 6B to 7A" is one interaction.
const assignTarget = ref<{ user_id: string; name: string } | null>(null)
const assignBusy = ref(false)
const assignOutcomes = ref<AssignmentOutcome[]>([])
const assignSummary = ref('')

// Which classes each teacher is on comes from the class list we already
// load — ClassInfo.teachers is the class_teachers relationship. No new query.
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

const assignLoadError = computed(() =>
  classesError.value
    ? t('schools.teachers.couldntLoadClassesIncomplete', "Couldn't load this school's classes, so this list may be incomplete. {error}").replace('{error}', classesError.value)
    : ''
)

function openAssign(teacher: { user_id: string; name: string }) {
  assignTarget.value = teacher
  assignOutcomes.value = []
  assignSummary.value = ''
  fetchClasses()
}

function closeAssign() {
  assignTarget.value = null
  assignOutcomes.value = []
  assignSummary.value = ''
}

async function handleAssignConfirm(tickedClassIds: string[]) {
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

  // Refetch either way: after a PARTIAL save the ticks must show what is
  // actually true, not what the leader asked for (RLS doctrine rule 8 — no
  // false "Saved"). The modal stays open so the failures are read.
  await Promise.all([fetchClasses(), fetchTeachers()])
  for (const o of outcomes) {
    if (!o.ok) console.error(`[TeachersView] class-teacher ${o.action} failed for ${target.name} on ${o.className}:`, o.error)
  }
}

function exportCsv() {
  const header = ['Name', 'Classes', 'Students', 'Student hours', 'Own practice minutes', 'Role', 'Status', 'Joined']
  const rows = filtered.value.map(t => [
    t.name, t.classes, t.students, t.hours7d, t.ownMinutes, t.role, t.status, t.joined_at,
  ].join(','))
  const csv = [header.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `teachers-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  if (selectedUser.value) {
    fetchTeachers()
    fetchSchools()
  }
})

watch(selectedUser, (newUser) => {
  if (newUser) {
    fetchTeachers()
    fetchSchools()
  }
})
</script>

<template>
  <main class="teachers">
    <div class="page-head">
      <div class="page-head-text">
        <h1 class="arsenal page-title">{{ t('schools.teachers.pageTitle', 'Teachers') }}</h1>
        <p class="page-subtitle schools-subtle">{{ subtitle }}</p>
      </div>
      <div class="page-head-actions">
        <button v-if="teachers.length > 0" type="button" class="btn-ghost" @click="exportCsv">
          {{ t('schools.teachers.exportCsv', 'Export CSV') }}
        </button>
        <button v-if="canManageStaff" type="button" class="btn-ghost" @click="handleBulkImport">
          {{ t('schools.teachers.bulkImportCsv', 'Bulk import CSV') }}
        </button>
        <button v-if="canManageStaff" type="button" class="btn-play" @click="handleInvite">
          + {{ t('schools.teachers.inviteTeacher', 'Invite teacher') }}
        </button>
      </div>
    </div>

    <div v-if="teachersError" class="fetch-error-banner">
      <span>{{ t('schools.teachers.refreshFailed', "Couldn't refresh this list — showing the last data loaded. {error}").replace('{error}', teachersError) }}</span>
      <button type="button" class="btn-ghost" @click="fetchTeachers()">{{ t('schools.teachers.retry', 'Retry') }}</button>
    </div>

    <Transition name="fade">
      <div v-if="showImportHint" class="invite-hint schools-card schools-card-pad">
        {{ t('schools.teachers.bulkImportHint', 'Bulk CSV import is coming soon. For now, share the teacher invite link below — teachers click it, sign in once, and land in your school.') }}
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="showInviteHint" class="invite-hint schools-card schools-card-pad">
        {{ t('schools.teachers.inviteHint', 'Copy the teacher invite link below and share it however you reach your staff — Teams, WhatsApp, in person. Clicking it signs them straight in.') }}
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="removeError" class="invite-hint remove-error schools-card schools-card-pad" role="alert">
        {{ removeError }}
      </div>

      <div v-if="signinLinkError" class="invite-hint remove-error schools-card schools-card-pad" role="alert">
        {{ signinLinkError }}
      </div>

      <div v-if="signinLinkFor" class="schools-card schools-card-pad signin-link-panel">
        <div class="schools-kicker">{{ t('schools.teachers.accessCodeForKicker', 'Access code for {name}').replace('{name}', signinLinkFor.name) }}</div>
        <p class="signin-link-body">
          {{
            t(
              'schools.teachers.signinLinkBody',
              'Read this out to {name}, write it down, or paste it into Teams — however you normally reach them. They go to {url} and type it in. No email needed.',
            )
              .replace('{name}', signinLinkFor.name)
              .replace('{url}', 'saysomethingin.app/join')
          }}
        </p>
        <div class="signin-link-code">{{ signinLinkFor.code }}</div>
        <div class="signin-link-row">
          <code class="signin-link-url">{{ signinLinkFor.joinUrl }}</code>
          <button type="button" class="btn-play btn-small" @click="copySigninLink">
            {{ signinLinkCopied ? t('schools.teachers.copied', 'Copied') : t('schools.teachers.copyLink', 'Copy link') }}
          </button>
        </div>
        <p class="signin-link-caveat schools-subtle">
          {{ t('schools.teachers.signinLinkCaveat', "It works once, and lasts two days. Whoever uses it becomes {name}, so give it to them directly and don't post it anywhere shared. Need another? Just tap Access code again.").replace('{name}', signinLinkFor.name) }}
        </p>
        <button type="button" class="btn-ghost btn-small" @click="signinLinkFor = null">{{ t('schools.teachers.done', 'Done') }}</button>
      </div>
    </Transition>

    <div v-if="teachers.length > 0" class="schools-card table-card">
      <table class="ssi-table">
        <thead>
          <tr>
            <th>{{ t('schools.teachers.tableHeaderTeacher', 'Teacher') }}</th>
            <th>{{ t('schools.teachers.tableHeaderRole', 'Role') }}</th>
            <th>{{ t('schools.teachers.tableHeaderClasses', 'Classes') }}</th>
            <th>{{ t('schools.teachers.tableHeaderStudents', 'Students') }}</th>
            <th>{{ t('schools.teachers.tableHeaderStudentHours', 'Student hours') }}</th>
            <th>{{ t('schools.teachers.tableHeaderOwnPractice', 'Own practice') }}</th>
            <th>{{ t('schools.teachers.tableHeaderStatus', 'Status') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(row, i) in orderedRows" :key="row.user_id">
          <!-- NOT YET GIVEN CLASSES. An arrival on the school's invite link is
               nobody's colleague until somebody who already holds the school
               gives them a class. Until then they sit here, seeing no pupil,
               visible and removable. Nobody was stopped at the door to make
               this true. -->
          <tr v-if="i === pendingHeaderIndex" class="section-row">
            <td colspan="8">
              <span class="section-title">{{ t('schools.teachers.notYetGivenClasses', 'Not yet given classes') }}</span>
              <span class="section-note schools-subtle">{{ t('schools.teachers.notYetGivenClassesNote', 'They can sign in and learn. They can see no learner until you tick a class for them.') }}</span>
            </td>
          </tr>
          <tr v-if="i === settledHeaderIndex" class="section-row">
            <td colspan="8">
              <span class="section-title">{{ t('schools.teachers.teachingHere', 'Teaching here') }}</span>
            </td>
          </tr>
          <tr>
            <td>
              <div class="teacher-cell">
                <div class="avatar">{{ row.initials }}</div>
                <div class="teacher-info">
                  <div class="teacher-name">{{ row.name }}</div>
                  <div class="teacher-sub schools-subtle">{{ formatJoined(row.joined_at) }}</div>
                  <div v-if="vouchLine(row)" class="teacher-sub schools-subtle">{{ vouchLine(row) }}</div>
                </div>
              </div>
            </td>
            <td>
              <span class="role-pill" :class="{ admin: row.role === 'Admin' }">{{ row.roleLabel }}</span>
            </td>
            <td>{{ row.classes }}</td>
            <td>{{ row.students }}</td>
            <td>{{ row.hours7d }}h</td>
            <td>{{ formatOwnPractice(row.ownMinutes) }}</td>
            <td>
              <span class="status-cell" :class="row.status">
                <span class="status-dot" />
                {{ row.status === 'active' ? t('schools.teachers.statusActive', 'Active') : t('schools.teachers.statusPendingInvite', 'Pending invite') }}
              </span>
            </td>
            <td class="cell-action">
              <!-- People-first assignment: the leader is on their staff list,
                   so the verb lives on the PERSON. Admins teach too (they
                   appear here as staff), so this is offered on every row. -->
              <!-- HANDBOOK Give a teacher their classes
                   section: getting-people-in
                   roles: school_admin, leader
                   place: teachers
                   keywords: assign, class, teacher, staff, classes
                   What it's for. Putting a teacher onto the classes they will
                   teach, working from your staff list rather than opening each
                   class in turn. This is how a new arrival gets their timetable
                   in one sitting.
                   Where it is. The **Teachers** page, the **Assign to a class**
                   button on that teacher's row.
                   How you do it.
                   1. Find the teacher in the list.
                   2. Tap **Assign to a class**.
                   3. Tick every class they should teach.
                   4. Tap **Save** to apply the ticks.
                   Worth knowing. This is also how somebody becomes part of
                   your school. Anyone who used your invite link arrives under
                   **Not yet given classes** and can see no learner at all until
                   you tick a class for them, so a stranger who found the link
                   sits there in plain sight and you can remove them. A class
                   with nobody on it says so in the list, and the teacher you
                   tick will lead it. Tick a class that already has a teacher
                   and yours joins as a co-teacher instead.
                   checked: f87575a8.d5378b72
              -->
              <button
                v-if="canAssignClasses"
                type="button"
                class="btn-ghost btn-small assign-btn"
                data-walk="teacher-assign-classes"
                @click="openAssign({ user_id: row.user_id, name: row.name })"
              >
                {{ t('schools.teachers.assignToClass', 'Assign to a class') }}
              </button>
              <!-- Email verification is not a door. If our code email never
                   reaches this teacher (Hwb and other school gateways eat it),
                   their own admin hands them a link instead. Offered on every
                   row, admins included — an admin locked out is stuck the same
                   way a teacher is. -->
              <!-- HANDBOOK Hand a teacher their access code
                   section: getting-people-in
                   roles: school_admin
                   place: teachers
                   keywords: access code, sign-in, locked out, email, teacher, link
                   What it's for. A way to get a teacher into their own account
                   when email is not reaching them. School mail gateways
                   quarantine our sign-in codes often enough that this is the
                   rescue, not the exception.
                   Where it is. The **Teachers** page, the **Access code** button
                   on that teacher's row.
                   How you do it.
                   1. Find the teacher in the list.
                   2. Tap **Access code** on their row.
                   3. Read the code out to them, write it down, or paste the link
                      into whatever you already use.
                   4. They go to saysomethingin.app/join and type the code in.
                   5. Tap **Done** when they are through.
                   Worth knowing. The code works once and lasts two days, and
                   whoever uses it becomes that teacher — so give it to them
                   directly and never post it anywhere shared. Need another? Tap
                   **Access code** again.
                   checked: 310cb8f2.10716eae
              -->
              <button
                v-if="canManageStaff"
                type="button"
                class="btn-ghost btn-small signin-link-btn"
                :disabled="signinLinkBusy === row.user_id"
                data-walk="teacher-signin-link"
                @click="handleSigninLink(row.user_id, row.name)"
              >
                {{ signinLinkBusy === row.user_id ? t('schools.teachers.creatingEllipsis', 'Creating…') : t('schools.teachers.accessCode', 'Access code') }}
              </button>
              <!-- Removal acts only on TEACHER tags (api/school/remove-staff.ts
                   deliberately refuses an admin, so a school can't lose its own
                   admin through the staff list) — so don't offer the control. -->
              <!-- HANDBOOK Remove a teacher from your school
                   section: getting-people-in
                   roles: school_admin
                   place: teachers
                   keywords: remove, teacher, leaver, staff, delete
                   What it's for. Taking a teacher off your school when they
                   leave. Their own account survives — what goes is their place
                   in this school and their view of its classes and learners.
                   Where it is. The **Teachers** page, the **Remove** button on
                   that teacher's row.
                   How you do it.
                   1. Find the teacher in the list.
                   2. Tap **Remove** on their row.
                   3. Confirm when asked for their name back.
                   4. The list refreshes without them.
                   Worth knowing. An admin's row carries no **Remove** button, so
                   a school can never lose its own admin through this list.
                   Change their role first if that is really what you want.
                   checked: 4cb305ee.324451a9
              -->
              <button
                v-if="canManageStaff && row.role !== 'Admin'"
                type="button"
                class="btn-ghost btn-small remove-btn"
                data-walk="teacher-remove"
                @click="handleRemoveTeacher(row.user_id, row.name)"
              >
                {{ t('schools.teachers.remove', 'Remove') }}
              </button>
            </td>
          </tr>
          </template>
          <tr v-if="orderedRows.length === 0">
            <td colspan="8" class="empty-row">
              {{ t('schools.teachers.noTeachersMatch', 'No teachers match "{query}".').replace('{query}', searchQuery) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="teachersLoading" class="empty-state schools-card schools-card-pad">
      <p class="schools-subtle">{{ t('schools.teachers.loadingTeachers', 'Loading teachers…') }}</p>
    </div>

    <div v-else-if="teachersError" class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.teachers.couldntLoadTeachers', "Couldn't load teachers") }}</h3>
      <p class="empty-text schools-subtle">{{ teachersError }}</p>
    </div>

    <div v-else class="empty-state schools-card schools-card-pad">
      <h3 class="arsenal empty-title">{{ t('schools.teachers.noTeachersYet', 'No teachers yet') }}</h3>
      <p class="empty-text schools-subtle">
        {{ t('schools.teachers.shareInviteLinkBelow', 'Share the invite link below to add teachers to your school.') }}
      </p>
    </div>

    <!-- Tip cards + join link panel -->
    <div class="tip-grid">
      <div class="schools-card schools-card-pad tip-card">
        <div class="schools-kicker">{{ t('schools.teachers.tipInviteLinksKicker', 'Tip — invite links') }}</div>
        <p class="tip-body">
          {{ t('schools.teachers.tipInviteLinksBody', 'Anyone who clicks your teacher invite link appears here as a teacher once they sign in — so share it only with your staff. You can remove a teacher from their row at any time.') }}
        </p>
      </div>
      <div class="schools-card schools-card-pad tip-card">
        <div class="schools-kicker">{{ t('schools.teachers.tipRolesKicker', 'Tip — roles') }}</div>
        <p class="tip-body">
          {{ t('schools.teachers.tipRolesBody', "Admins manage staff, classes and settings. Teachers see only their own classes. Switch role any time from a teacher's row.") }}
        </p>
      </div>
      <div v-if="canManageStaff" class="schools-card schools-card-pad join-card">
        <div class="schools-kicker join-kicker">{{ t('schools.teachers.inviteTeachersKicker', 'Invite teachers') }}</div>
        <p class="join-body">
          {{ t('schools.teachers.inviteTeachersBody', 'Share this link however you reach your staff — Teams, WhatsApp, in person. Clicking it signs them straight in.') }}
        </p>
        <!-- HANDBOOK Invite a teacher to your school
             section: getting-people-in
             roles: school_admin
             place: teachers
             keywords: teacher, invite, link, staff, join, code
             What it's for. One standing link that turns anyone who opens it into a
             teacher of your school. It is the same link every time, so you can hand it
             to a whole staff room at once.
             Where it is. The **Teachers** page, the **Invite teachers** card below the
             list.
             How you do it.
             1. Open **Teachers**.
             2. Scroll to the **Invite teachers** card.
             3. Tap **Copy invite link**.
             4. Send it however you reach your staff — Teams, WhatsApp, printed on a
                slip.
             5. They open it, sign in once, and appear in your list as a teacher.
             Worth knowing. If you are standing in front of them rather than sending
             anything, **Show code instead** gives you a short code to read out or
             write on a whiteboard, and they type it in at saysomethingin.com/redeem.
             checked: 45f0541c.205d0aa0
        -->
        <InviteLinkField :url="teacherJoinLink" data-walk="teachers-invite-link" />

        <button
          v-if="!showCode"
          type="button"
          class="btn-text join-show-code"
          @click="showCode = true"
        >
          {{ t('schools.teachers.showCodeInstead', 'Show code instead') }}
        </button>
        <template v-else>
          <div class="join-code">{{ teacherJoinCode }}</div>
          <p class="join-body join-body-small">
            {{
              t(
                'schools.teachers.joinBodySmall',
                'For writing on a whiteboard — teachers enter it at {url}.',
              ).replace('{url}', 'saysomethingin.com/redeem')
            }}
          </p>
          <button
            type="button"
            class="btn-ghost btn-small join-copy"
            :class="{ copied: codeCopyState }"
            :disabled="teacherJoinCode === 'N/A'"
            @click="copyJoinCode"
          >
            {{ codeCopyState ? t('schools.teachers.copied', 'Copied') : t('schools.teachers.copyCode', 'Copy code') }}
          </button>
        </template>
      </div>
    </div>

    <AssignClassesModal
      :is-open="!!assignTarget"
      :teacher-name="assignTarget?.name ?? ''"
      :classes="assignClasses"
      :loading="classesLoading"
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
/* Sign-in link rescue panel */
.signin-link-panel {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.signin-link-body {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.45;
}
/* The code is the artefact: read aloud, copied off a screen, written on a
   slip. It is set big and widely tracked so none of that is a squint. */
.signin-link-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: clamp(1.5rem, 8vw, 2rem);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-align: center;
  padding: 0.75rem 0.5rem;
  margin-bottom: 0.625rem;
  border-radius: 10px;
  overflow-wrap: anywhere;
  background: var(--bg-primary, #e8e3dd);
  border: 1px solid rgba(0, 0, 0, 0.1);
}
.signin-link-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.signin-link-url {
  flex: 1 1 14rem;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.75rem;
  padding: 0.5rem 0.625rem;
  border-radius: 8px;
  background: var(--bg-primary, #e8e3dd);
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.signin-link-caveat {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.teachers {
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
  margin-bottom: 16px;
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
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.page-head-text { min-width: 280px; flex: 1; }

.page-title {
  font-size: 32px;
  line-height: 1.05;
}

.page-subtitle {
  font-size: 13px;
  margin-top: 4px;
}

.page-head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.invite-hint {
  margin-bottom: 12px;
  background: #fdf6df;
  border-color: #f0d97a;
  color: #5a3e10;
  font-size: 13px;
}

.remove-error {
  background: #fdeceb;
  border-color: var(--schools-red, #db1e17);
  color: var(--schools-red-deep, #a3130d);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.table-card { overflow: hidden; }

.teacher-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--schools-role-teacher);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.teacher-info { line-height: 1.3; min-width: 0; }
.teacher-name {
  font-weight: 600;
  font-size: 13.5px;
}
.teacher-sub {
  font-size: 11.5px;
  margin-top: 2px;
}

.role-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
  background: #f0f4ff;
  color: #1c3666;
}

.role-pill.admin {
  background: #fff5e5;
  color: #7a5418;
}

.section-row td {
  padding-top: 14px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle, #e0dbd4);
}

.section-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.section-note {
  margin-left: 10px;
  font-size: 12px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}
.status-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.status-cell .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.status-cell.active { color: var(--schools-success); }
.status-cell.invited { color: var(--schools-health-needs-attention); }

.cell-action {
  text-align: right;
  white-space: nowrap;
}

.assign-btn { margin-right: 6px; }

.remove-btn:hover {
  color: var(--schools-red-deep);
  border-color: var(--schools-red-deep);
}

.empty-row {
  text-align: center;
  padding: 32px 16px;
  color: var(--schools-fg-2);
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

.tip-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 14px;
}

.tip-card,
.join-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tip-body {
  font-size: 13px;
  color: var(--schools-fg-2);
  line-height: 1.5;
}

.join-card {
  background: #fdf6df;
  border-color: #f0d97a;
}

.join-kicker { color: #7a5418; }

.join-code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 22px;
  letter-spacing: 0.1em;
  color: var(--schools-fg);
  margin-top: 4px;
}

.join-body {
  font-size: 12px;
  color: #5a3e10;
  margin-top: 4px;
  line-height: 1.5;
}

.join-copy {
  align-self: flex-start;
  margin-top: 8px;
}

.join-copy.copied {
  background: var(--schools-success);
  border-color: var(--schools-success);
  color: #fff;
}

.join-copy:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.join-show-code {
  align-self: flex-start;
  margin-top: 8px;
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: #7a5418;
  text-decoration: underline;
  cursor: pointer;
}

.join-body-small {
  margin-top: 4px;
}

@media (max-width: 1100px) {
  .tip-grid { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 768px) {
  .teachers { padding: 18px 16px 28px; }
  .tip-grid { grid-template-columns: 1fr; }
  .table-card { overflow-x: auto; }
  .ssi-table { min-width: 760px; }
}
</style>
