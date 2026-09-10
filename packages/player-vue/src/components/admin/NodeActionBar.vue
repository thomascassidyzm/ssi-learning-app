<script setup lang="ts">
// NodeActionBar — the verbs, across the top of every node's dashboard page
// (founder-ruled 2026-07-19: "rows are links, verbs on the node page"). The
// same action set the Structure ⋯ menu carries — Invite people · Get join
// link · Add a group · Add a school · Mint a demo org · Courses · Rename ·
// Refresh demo activity · Delete — ordered most-common-first. Self-contained:
// calls the same server endpoints AdminStructure/the retired NodePanel used,
// then emits `changed` so the host page refetches. No "node"/"entitlement"
// jargon in any user-facing string (say school/group/courses).
import { ref, computed, inject, onMounted, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import NodeEntitlementControl from '@/components/schools/NodeEntitlementControl.vue'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import ManagerOnboardingGate from '@/components/admin/ManagerOnboardingGate.vue'
import { formatDeleteImpactLines, type DeleteImpact } from '@/components/admin/deleteImpact'
import { readDuplicateWarning } from '@/utils/duplicateNameWarning'
import { useOrgLeadership } from '@/composables/useOrgLeadership'
import FrostSelect from '@/components/FrostSelect.vue'
import { hasPasswordFlag, needsPasswordGate } from '@/composables/useManagerOnboarding'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

interface NodeShape {
  id: string
  name: string
  label: string
  is_demo?: boolean
  commercial?: { schoolId: string } | null
  rollup?: { teacherCount?: number; classCount?: number; childGroupCount?: number; learnerCount?: number }
}

// `member` = the /org mount (a leader on their own subtree). Leaders get the
// invite verbs AND Add-a-group — /api/groups/:id/invites and POST /api/groups
// both authorize a govt_admin on their governed node or any strict descendant
// — while the remaining structural verbs (school/rename/mint/delete/courses)
// stay admin-only: their endpoints are ssi_admin-gated, and a leader's
// create-school lane is a separate surface (POST /api/govt/create-school).
// `preset` = the vocabulary dressing (founder ruling 2026-08-02, groups all
// the way down): 'neutral' hides every school/teacher word — no Add-a-school
// verb, invites default to Group leader. Defaults to 'education' so mounts
// that don't pass it (legacy school surfaces) keep their vocabulary.
// `classId` = CLASS MODE (founder ruling 2026-09-07: "we need it to be easy
// to see how to add students to a class"). The bar is mounted on a class page
// with `node` set to the class's SCHOOL node — which is where the invite
// endpoint authorizes and where the class must live — and the class itself
// carried in `classId`. It collapses to ONE verb, Invite students, minting the
// same personal link the school page mints, scoped by personal.class_id so the
// student lands in this class. No other verb belongs on a class.
const props = withDefaults(
  defineProps<{ node: NodeShape; member?: boolean; preset?: 'education' | 'neutral'; classId?: string }>(),
  { preset: 'education' },
)
const classMode = computed(() => !!props.classId)
const emit = defineEmits<{ changed: []; renamed: [name: string]; minted: [] }>()

const neutral = computed(() => props.preset === 'neutral')

const { getClient, getAuthToken } = useAdminClient()
function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const shareUrl = ref<{ url: string; hint: string } | null>(null)
const copied = ref(false)

function announce(message: string, url: { url: string; hint: string } | null = null): void {
  notice.value = message
  shareUrl.value = url
  error.value = null
}

async function copyShare(): Promise<void> {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value.url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* clipboard unavailable */ }
}

// One inline form open at a time.
type Form = 'person' | 'invite' | 'group' | 'school' | 'class' | 'demo' | 'courses' | 'rename' | null
const openForm = ref<Form>(null)

// ─── Password before the first add (Deborah, 2026-08-06; Tom's ruling
// "Password before adding a group or a learner?") ───
// An org manager arrives by magic link and never sets a password, so when
// that session dies they cannot get back into the organisation they built.
// The three verbs a manager holds — invite a person, get a shareable link,
// add a group — are ALL "add a group or a learner", and all three pass
// through toggle(), which is why the gate lives on this single choke point.
// Gated on leadsOrg (server-verified 'organisation' leader row), NOT on
// `member` alone: the member mount also renders school nodes, and the
// schools lane is deliberately unchanged.
const auth = inject<any>('auth', null)
const { leadsOrg, ensureLoaded } = useOrgLeadership()
onMounted(() => { if (props.member) void ensureLoaded() })

const GATED_VERBS: ReadonlyArray<Exclude<Form, null>> = ['person', 'invite', 'group', 'class']
const gateOpen = ref(false)
const pendingVerb = ref<Exclude<Form, null> | null>(null)

const mustSetPassword = computed(() =>
  needsPasswordGate({
    member: !!props.member,
    leadsOrg: leadsOrg.value,
    hasPassword: hasPasswordFlag(auth?.user?.value ?? null),
  }),
)

function toggle(f: Exclude<Form, null>): void {
  if (mustSetPassword.value && GATED_VERBS.includes(f)) {
    pendingVerb.value = f
    gateOpen.value = true
    return
  }
  openForm.value = openForm.value === f ? null : f
  error.value = null
  notice.value = null
  shareUrl.value = null
}

/** Password saved — carry straight on into the verb they reached for. */
function resumePendingVerb(): void {
  const f = pendingVerb.value
  pendingVerb.value = null
  if (!f) return
  openForm.value = f
  error.value = null
  notice.value = null
  shareUrl.value = null
}

function closeGate(): void {
  gateOpen.value = false
  pendingVerb.value = null
}

const entitlementNodeId = computed(() => props.node.commercial?.schoolId ?? props.node.id)
const entitlementNodeType = computed<'group' | 'school'>(() => (props.node.commercial ? 'school' : 'group'))

// ─── Invite a person (species 1: personal link — the account is provisioned
// NOW with their name; the link is their login, zero screens on click) ───
// Under the neutral dressing the default role is GROUP LEADER, not teacher —
// a council is not a school (founder taste-test 2026-08-02).
const defaultRole = computed<'teacher' | 'leader'>(() => (neutral.value ? 'leader' : 'teacher'))
const personRole = ref<'teacher' | 'leader' | 'school_leader' | 'student'>(defaultRole.value)
const personName = ref('')
const personEmail = ref('')
const isInvitingPerson = ref(false)
async function submitPerson(): Promise<void> {
  if (isInvitingPerson.value || !personName.value.trim()) return
  isInvitingPerson.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.node.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({
        role: classMode.value ? 'student' : personRole.value,
        limits: {},
        personal: {
          name: personName.value.trim(),
          ...(personEmail.value.trim() ? { email: personEmail.value.trim() } : {}),
          // Class mode: the server binds the new account to this class and
          // mints the code with grants_class_id (api/groups/[id]/invites.ts).
          ...(props.classId ? { class_id: props.classId } : {}),
        },
      }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    openForm.value = null
    // Tester feedback (Aran 2026-08-03): entering an email should SEND the
    // invite, not tell the leader to post it themselves. The server does that
    // now; the link stays on screen because sharing it by WhatsApp is often
    // better, and because it is the fallback when the send fails.
    const name = personName.value.trim()
    // `via` (2026-08-05): 'link' is the invite email carrying a clickable way
    // in — the whole point, and now always the case, because the branded
    // Resend mail mints a link that works whether or not they have signed in
    // before. 'code' survives only on the legacy Supabase path (no
    // RESEND_API_KEY configured) for someone who has already accepted an
    // invite; say so plainly rather than letting the leader assume a link
    // went out.
    const emailed = data.emailed as { sent?: boolean; to?: string; via?: 'link' | 'code' } | undefined
    const message = emailed?.sent
      ? emailed.via === 'code'
        ? t('org.ui.nodeActionBar.inSignInCode', '{name} is in — {email} already has an account, so we sent a sign-in code. Send them this link too.').replace('{name}', name).replace('{email}', emailed.to || '')
        : t('org.ui.nodeActionBar.inviteSentIn', 'Invite sent to {email} — {name} is in.').replace('{email}', emailed.to || '').replace('{name}', name)
      : emailed
        ? t('org.ui.nodeActionBar.inNoEmail', '{name} is in, but we couldn\'t email the invite — send them this link.').replace('{name}', name)
        : t('org.ui.nodeActionBar.personalLinkCreatedFor', 'Personal link created for {name}').replace('{name}', name)
    announce(
      message,
      data.url
        ? {
            url: data.url,
            hint: emailed?.sent
              ? t('org.ui.nodeActionBar.sameLinkHint', 'Same link, if you\'d rather send it yourself too — clicking it signs them straight in.')
              : t('org.ui.nodeActionBar.sendLinkHint', 'Send this to them — clicking it signs them straight in.'),
          }
        : null,
    )
    personName.value = ''
    personEmail.value = ''
    emit('minted')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedCreatePersonalLink', 'Failed to create the personal link')
  } finally {
    isInvitingPerson.value = false
  }
}

// ─── Invite people ───
// Role-scoped links (founder-ruled 2026-07-20): every link names its role and
// its node — never one generic link. 'school_leader' appears only on school
// nodes (it grants the school-admin seat); 'student' is the learner join.
const inviteRole = ref<'teacher' | 'leader' | 'school_leader' | 'student'>(defaultRole.value)
// A node switch reuses this component instance — re-seed the defaults when
// the dressing flips so a neutral node never opens on 'Teacher'.
watch(defaultRole, (r) => {
  personRole.value = r
  inviteRole.value = r
})
const isInviting = ref(false)
const inviteHintByRole = computed<Record<string, string>>(() => ({
  teacher: t('org.ui.nodeActionBar.hintShareTeacher', 'Share this with the teacher it\'s for.'),
  leader: t('org.ui.nodeActionBar.hintShareLeader', 'Share this with the leader it\'s for.'),
  school_leader: t('org.ui.nodeActionBar.hintShareSchoolLeader', 'Share this with the school leader it\'s for.'),
  student: t('org.ui.nodeActionBar.hintAnyoneJoinsLearner', 'Anyone with this link joins as a learner.'),
}))
async function submitInvite(): Promise<void> {
  if (isInviting.value) return
  isInviting.value = true
  try {
    const token = await getAuthToken()
    // Reuse this node's existing shareable link for the role when one is
    // live (the old Get-join-link behaviour, now for every role) — keeps the
    // ledger free of duplicate open links.
    const listResp = await fetch(`/api/groups/${props.node.id}/invites`, { headers: authHeaders(token) })
    const listData = await listResp.json().catch(() => ({}))
    let link = listResp.ok
      ? (listData.links || []).find((l: any) => l.role === inviteRole.value && !l.personal)
      : null
    if (!link) {
      const resp = await fetch(`/api/groups/${props.node.id}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ role: inviteRole.value, limits: {} }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
      const path = inviteRole.value === 'leader' ? 'group' : 'redeem'
      link = data.url ? data : (data.code ? { url: `${window.location.origin}/${path}/${data.code}` } : null)
    }
    openForm.value = null
    try { if (link?.url) await navigator.clipboard.writeText(link.url) } catch { /* clipboard unavailable */ }
    announce(
      t('org.ui.nodeActionBar.shareableLinkFor', 'Shareable link for "{name}" — copied.').replace('{name}', props.node.name),
      link?.url ? { url: link.url, hint: inviteHintByRole.value[inviteRole.value] || t('org.ui.nodeActionBar.hintShareInviteLink', 'Share this invite link.') } : null,
    )
    emit('minted')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedCreateInvite', 'Failed to create invite')
  } finally {
    isInviting.value = false
  }
}

// ─── Add a group / Add a school ───
const newChildName = ref('')
const isAddingChild = ref(false)
// Duplicate-name warning — a sibling group under THIS node already slugs to
// the same string. Nothing was created; the creator changes the name or
// confirms, and confirming re-sends with confirm_duplicate: true.
const childDuplicateWarning = ref<string | null>(null)
watch(newChildName, () => { childDuplicateWarning.value = null })
watch(openForm, () => { childDuplicateWarning.value = null })

async function submitGroup(confirmDuplicate = false): Promise<void> {
  if (!newChildName.value.trim() || isAddingChild.value) return
  isAddingChild.value = true
  try {
    const token = await getAuthToken()
    const body: Record<string, unknown> = { name: newChildName.value.trim(), type: 'group', parent_id: props.node.id }
    if (confirmDuplicate) body.confirm_duplicate = true
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    const duplicate = readDuplicateWarning(resp.status, data, 'group')
    if (duplicate) {
      childDuplicateWarning.value = duplicate.message
      return
    }
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(t('org.ui.nodeActionBar.namedAdded', '"{name}" added.').replace('{name}', newChildName.value.trim()))
    newChildName.value = ''
    childDuplicateWarning.value = null
    openForm.value = null
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedAddGroup', 'Failed to add group')
  } finally {
    isAddingChild.value = false
  }
}
async function submitSchool(): Promise<void> {
  if (!newChildName.value.trim() || isAddingChild.value) return
  isAddingChild.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/admin/create-school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ school_name: newChildName.value.trim(), group_id: props.node.id }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(t('org.ui.nodeActionBar.schoolNamedAdded', 'School "{name}" added.').replace('{name}', newChildName.value.trim()))
    newChildName.value = ''
    openForm.value = null
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedAddSchool', 'Failed to add school')
  } finally {
    isAddingChild.value = false
  }
}

// ─── Add a class (founder ruling 2026-09-07) ───
// "can a class exist without a teacher? I think it can - but someone has to
// create it, so the class has to belong to a group somehow, even if the group
// is the root group - the org itself." So the verb lives HERE, on the node
// the leader is already standing on, and the class it makes carries that
// node's group_id and no teacher at all. A teacher is attached afterwards
// through the existing "Assign to a class" tick-list on the staff surface.
//
// Authority is NOT re-derived here: /api/school/create-class authorizes with
// the same subtree predicate the other node verbs use, so this button is
// simply hidden work, never the check itself.
const newClassName = ref('')
const newClassCourse = ref('')
const isAddingClass = ref(false)
const courses = ref<{ course_code: string; display_name: string | null }[]>([])
const courseOptions = computed(() =>
  courses.value.map((c) => ({ value: c.course_code, label: c.display_name || c.course_code.replace(/_/g, ' ') })),
)

// The live/beta catalogue — the SAME list NodeEntitlementControl and the
// school setup wizard read (schools stopped holding per-course
// entitlement_grants rows in the 2026-07-15 commercial model). Read through
// this bar's OWN client rather than the schools composable: the bar mounts on
// admin pages where the schools client is never initialised.
async function fetchCourses(): Promise<void> {
  if (courses.value.length) return
  try {
    const { data, error: fetchErr } = await getClient()
      .from('courses')
      .select('course_code, display_name')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')
    if (fetchErr) throw fetchErr
    courses.value = data || []
  } catch (err) {
    console.error('[NodeActionBar] fetch courses failed:', err)
  }
}

async function submitClass(): Promise<void> {
  if (!newClassName.value.trim() || !newClassCourse.value || isAddingClass.value) return
  isAddingClass.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/school/create-class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({
        group_id: props.node.id,
        class_name: newClassName.value.trim(),
        course_code: newClassCourse.value,
      }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(t('org.ui.nodeActionBar.classNamedAdded', 'Class "{name}" added — assign a teacher whenever you\'re ready.').replace('{name}', newClassName.value.trim()))
    newClassName.value = ''
    openForm.value = null
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedAddClass', 'Failed to add class')
  } finally {
    isAddingClass.value = false
  }
}

// The catalogue is fetched only when the form is actually opened — the bar
// renders on every node page and most visits never reach for this verb.
watch(openForm, (f) => { if (f === 'class') void fetchCourses() })

// ─── Mint a demo org ───
const demoName = ref('')
const demoLeaderEmail = ref('')
const isMinting = ref(false)
async function submitDemo(): Promise<void> {
  if (!demoName.value.trim() || isMinting.value) return
  isMinting.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.node.id}/demo-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ name: demoName.value.trim(), leader_email: demoLeaderEmail.value.trim() || undefined }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    const leaderLink = Array.isArray(data.links) ? data.links.find((l: any) => l.role === 'leader') : null
    openForm.value = null
    announce(
      t('org.ui.nodeActionBar.demoOrgMinted', 'Demo org "{name}" minted.').replace('{name}', demoName.value.trim()),
      leaderLink?.url ? { url: leaderLink.url, hint: t('org.ui.nodeActionBar.hintShareDemoLeader', 'Share this with the demo leader.') } : null,
    )
    demoName.value = ''
    demoLeaderEmail.value = ''
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedMintDemo', 'Failed to mint demo org')
  } finally {
    isMinting.value = false
  }
}

// ─── Rename ───
const renameValue = ref('')
const isRenaming = ref(false)
function openRename(): void {
  renameValue.value = props.node.name
  toggle('rename')
}
// Duplicate-name warning on rename — another group under the SAME parent
// already slugs to this name. Nothing was renamed; the caller changes the
// name or confirms, and confirming re-sends with confirm_duplicate: true.
const renameDuplicateWarning = ref<string | null>(null)
watch(renameValue, () => { renameDuplicateWarning.value = null })

/**
 * `confirmDuplicate` MUST be passed with explicit parens by every template
 * call site — @keyup.enter="submitRename" would hand this the KeyboardEvent,
 * which is truthy, and silently confirm a duplicate. Pinned by a test.
 */
async function submitRename(confirmDuplicate = false): Promise<void> {
  const name = renameValue.value.trim()
  if (!name || isRenaming.value) return
  if (name === props.node.name) { openForm.value = null; return }
  isRenaming.value = true
  try {
    const token = await getAuthToken()
    const body: Record<string, unknown> = { name }
    if (confirmDuplicate === true) body.confirm_duplicate = true
    const resp = await fetch(`/api/groups/${props.node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    const duplicate = readDuplicateWarning(resp.status, data, 'group', 'Renaming')
    if (duplicate) {
      renameDuplicateWarning.value = duplicate.message
      return
    }
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(t('org.ui.nodeActionBar.renamedTo', 'Renamed to "{name}".').replace('{name}', name))
    renameDuplicateWarning.value = null
    openForm.value = null
    emit('renamed', name)
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedRename', 'Failed to rename')
  } finally {
    isRenaming.value = false
  }
}

// ─── Refresh demo activity (demo nodes only) ───
const isRefreshing = ref(false)
async function refreshDemo(): Promise<void> {
  if (isRefreshing.value) return
  isRefreshing.value = true
  error.value = null
  notice.value = null
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.node.id}/demo-refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(data.noop
      ? t('org.ui.nodeActionBar.nothingToRefresh', 'Nothing to refresh — no demo learners below this node yet.')
      : t('org.ui.nodeActionBar.freshActivitySummary', 'Fresh activity for {learners} learners — {sessions} practice sessions, {rollups} daily rollups.')
          .replace('{learners}', String(data.learnersTouched))
          .replace('{sessions}', String(data.sessionsWritten))
          .replace('{rollups}', String(data.speakingRowsWritten ?? 0)))
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedRefreshDemo', 'Failed to refresh demo activity')
  } finally {
    isRefreshing.value = false
  }
}

// ─── Delete — honest impact lines (deleteImpact.ts states the actual
// cascade consequence with names/counts) ───
const deleteOpen = ref(false)
const deleteImpact = ref<DeleteImpact | null>(null)
const deleteSubmitting = ref(false)
const deleteError = ref('')
const deleteTitle = computed(() => (props.node.commercial
  ? t('org.ui.nodeActionBar.deleteSchool', 'Delete school')
  : t('org.ui.nodeActionBar.deleteGroup', 'Delete group')))
const deleteImpactLines = computed(() => formatDeleteImpactLines(deleteImpact.value))
async function requestDelete(): Promise<void> {
  deleteImpact.value = null
  deleteError.value = ''
  deleteOpen.value = true
  try {
    const token = await getAuthToken()
    const url = props.node.commercial
      ? `/api/admin/update-school?school_id=${encodeURIComponent(props.node.commercial.schoolId)}`
      : `/api/groups/${props.node.id}`
    const resp = await fetch(url, { method: 'GET', headers: authHeaders(token) })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || t('org.ui.nodeActionBar.failedLoadDeleteImpact', 'Failed to load deletion impact'))
    deleteImpact.value = data.impact
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedLoadDeleteImpact', 'Failed to load deletion impact')
  }
}
async function confirmDelete(typedName: string): Promise<void> {
  deleteSubmitting.value = true
  deleteError.value = ''
  try {
    const token = await getAuthToken()
    const headers = authHeaders(token)
    if (props.node.commercial) {
      const params = new URLSearchParams({ school_id: props.node.commercial.schoolId })
      if (typedName) params.set('confirm_name', typedName)
      const resp = await fetch(`/api/admin/update-school?${params.toString()}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || t('org.ui.nodeActionBar.failedDeleteSchool', 'Failed to delete school'))
    } else {
      const qp = typedName ? `?confirm_name=${encodeURIComponent(typedName)}` : ''
      const resp = await fetch(`/api/groups/${props.node.id}${qp}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || t('org.ui.nodeActionBar.failedDeleteGroup', 'Failed to delete group'))
    }
    deleteOpen.value = false
    emit('changed')
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : t('org.ui.nodeActionBar.failedDelete', 'Failed to delete')
  } finally {
    deleteSubmitting.value = false
  }
}
function closeDelete(): void {
  if (deleteSubmitting.value) return
  deleteOpen.value = false
  deleteImpact.value = null
  deleteError.value = ''
}
</script>

<template>
  <div class="node-actions">
    <!-- Verbs, most-common-first (founder-ruled 2026-07-19) -->
    <div class="verb-bar">
      <!-- Two link species, two verbs (founder-ruled 2026-07-20): a personal
           link for a known person, or a shareable link by role — the old
           learner-only "Get join link" folded into the shareable menu. -->
      <!-- Class mode: one verb, and it says what it does. -->
      <!-- HANDBOOK Add a student to a class
           section: getting-people-in
           roles: admin, leader, school_admin
           place: node-home
           keywords: student, invite, class, learner, join, link
           What it's for. Making one learner their own way into one class. The link puts
           them straight into that class with no forms and no sign-up, so a child can be
           learning within a minute of opening it.
           Where it is. The class's own page, **Invite students** along the top.
           How you do it.
           1. Open the class.
           2. Tap **Invite students**.
           3. Type the student's name.
           4. Add their email if you want us to send it, or leave it blank and you get a
              link to hand over yourself.
           5. Submit, and repeat for the next student.
           Worth knowing. One student at a time, on purpose — the link is theirs alone
           and carries the class with it. The **Students** page's **+ Invite students**
           button brings you here for exactly this reason.
           checked: 86c44e8f.68bb21d6
      -->
      <button v-if="classMode" type="button" class="verb" :class="{ 'is-open': openForm === 'person' }" data-walk="verb-invite-student" @click="toggle('person')">{{ t('org.ui.nodeActionBar.inviteStudents', 'Invite students') }}</button>
      <template v-else>
      <!-- HANDBOOK Bring your first person in
           section: getting-people-in
           roles: admin, leader, school_admin
           place: node-home
           keywords: invite, person, link, join, leader, learner
           walk: invite-first-person
           What it's for. Bringing anyone into this part of the tree — a leader, a
           teacher or a learner — with a personal link that is their login.
           Where it is. The node's home page, the buttons along the top, **Invite a
           person**.
           How you do it.
           1. Open the group, school or organisation you want them to belong to.
           2. Tap **Invite a person**.
           3. Pick the role they arrive as.
           4. Type their name and submit.
           5. Copy the minted link and send it.
           Worth knowing. Nothing is created until you submit. Every link you mint lands
           in **Ways in**.
           checked: 2886d113.52963dcb
      -->
      <button type="button" class="verb" :class="{ 'is-open': openForm === 'person' }" data-walk="verb-invite-person" @click="toggle('person')">{{ t('org.ui.nodeActionBar.inviteAPerson', 'Invite a person') }}</button>
      <!-- HANDBOOK Make a link anyone can use
           section: getting-people-in
           roles: admin, leader, school_admin
           place: node-home
           keywords: shareable, link, join, open, role, bulk
           What it's for. One link, by role, that you can put in a newsletter or on a
           slide and let a whole room use. Unlike a personal invite it is not tied to
           anybody, so new arrivals type their own name before they are in.
           Where it is. The node's home page, **Get a shareable link** along the top.
           How you do it.
           1. Open the home page of the group, school or organisation they should join.
           2. Tap **Get a shareable link**.
           3. Pick the role everyone using it will arrive as.
           4. Tap **Create invite link** and copy what comes back.
           Worth knowing. It is open to anyone holding it, so when a link has travelled
           further than you meant, revoke it in **Ways in** and make a fresh one. Use
           **Invite a person** instead when you can name who is coming.
           checked: 90c5fe0a.855a3e42
      -->
      <button type="button" class="verb" :class="{ 'is-open': openForm === 'invite' }" data-walk="verb-shareable-link" @click="toggle('invite')">{{ t('org.ui.nodeActionBar.getShareableLink', 'Get a shareable link') }}</button>
      <!-- Add a group is for LEADERS too (founder ruling 2026-08-02: any
           group can contain subgroups — the endpoint authorizes a leader on
           their own subtree). Add a school is education-dressing-only. -->
      <button type="button" class="verb" :class="{ 'is-open': openForm === 'group' }" @click="toggle('group')">{{ t('org.ui.nodeActionBar.addAGroup', 'Add a group') }}</button>
      <!-- HANDBOOK Add a school under a group
           section: your-school
           roles: admin
           place: node-home
           keywords: school, add, create, group, structure
           What it's for. Creating a school inside a group, so it has its own home page,
           its own staff and its own learners while still rolling up into whatever sits
           above it.
           Where it is. The group's home page, **Add a school** along the top.
           How you do it.
           1. Open the home page of the group the school belongs under.
           2. Tap **Add a school**.
           3. Type the school's name.
           4. Tap **Add**, and the school appears in the list below.
           Worth knowing. The verb only shows on a plain group. A school cannot contain
           another school, and an organisation using the neutral wording has groups
           rather than schools all the way down.
           checked: 99a1fcbe.410c0ecd
      -->
      <button v-if="!member && !node.commercial && !neutral" type="button" class="verb" :class="{ 'is-open': openForm === 'school' }" data-walk="verb-add-school" @click="toggle('school')">{{ t('org.ui.nodeActionBar.addASchool', 'Add a school') }}</button>
      <!-- Add a class is for LEADERS too (founder ruling 2026-09-07: a class
           belongs to a group, even when that group is the org itself, and it
           needs no teacher to exist). Education dressing only. -->
      <!-- HANDBOOK Add a class to a group
           parts: add-class-name, add-class-submit
           section: running-classes
           roles: admin, leader, school_admin
           place: node-home
           keywords: class, add, group, org, leader
           What it's for. Creating a class underneath a group you lead, before anyone is
           teaching it. Useful when you are setting a term up in advance and will put a
           teacher on each class later.
           Where it is. The group's own page, the **Add a class** button in the row of
           actions at the top.
           How you do it.
           1. Open the group the class belongs under.
           2. Tap **Add a class**.
           3. Type the class name.
           4. Choose the course the class will learn.
           5. Tap **Add**.
           Worth knowing. A class needs no teacher to exist. It sits under the group
           waiting, and you put a teacher on it whenever you are ready. The course must
           be one your group has cover for. A paid language you have not subscribed to
           and are not trialling is refused when you tap **Add**, and the message says so.
           checked: 6d513232.32cb8fc5
      -->
      <button v-if="!neutral" type="button" class="verb" :class="{ 'is-open': openForm === 'class' }" data-walk="verb-add-class" @click="toggle('class')">{{ t('org.ui.nodeActionBar.addAClass', 'Add a class') }}</button>
      <!-- HANDBOOK Set up a demo organisation
           section: your-school
           roles: admin
           place: node-home
           keywords: demo, sales, pilot, mint, trial, prospect
           What it's for. Standing up a whole organisation with plausible people and
           activity already in it, for showing somebody what the product looks like once
           it is running rather than what it looks like empty.
           Where it is. The home page of the node it should sit under, **Mint a demo
           org** along the top.
           How you do it.
           1. Open the home page of the node the demo belongs under.
           2. Tap **Mint a demo org**.
           3. Type a name for it, and a leader's email if somebody is to be handed it.
           4. Tap **Mint**, and copy the leader link that comes back.
           Worth knowing. A demo org's own page grows a **Refresh demo activity** button,
           which moves its learners on so a demo you minted weeks ago does not look
           abandoned when you next open it.
           checked: 3b0a49fe.e86abc2e
      -->
      <button v-if="!member" type="button" class="verb" :class="{ 'is-open': openForm === 'demo' }" data-walk="verb-mint-demo" @click="toggle('demo')">{{ t('org.ui.nodeActionBar.mintADemoOrg', 'Mint a demo org') }}</button>
      <!-- HANDBOOK Choose which courses a school can use
           section: courses-and-content
           roles: admin
           place: node-home
           keywords: courses, entitlement, trial, paid, access, catalogue
           What it's for. Setting what a school or group is allowed to learn: the whole
           catalogue when they are paid up, or a named course or two while they are
           trialling.
           Where it is. The node's home page, **Courses** along the top.
           How you do it.
           1. Open the home page of the school or group.
           2. Tap **Courses**.
           3. Choose the whole catalogue, or search for the courses the trial should
              carry.
           4. Save, and everyone below that node inherits it.
           Worth knowing. A trial runs for thirty days on a paid course and a year on a
           free or community one, and the server works the dates out on save — what you
           see before saving is a preview.
           checked: 3a31c89c.cd89c135
      -->
      <button v-if="!member" type="button" class="verb" :class="{ 'is-open': openForm === 'courses' }" data-walk="verb-courses" @click="toggle('courses')">{{ t('org.ui.nodeActionBar.courses', 'Courses') }}</button>
      <!-- HANDBOOK Rename a school or group
           section: your-school
           roles: admin
           place: node-home
           keywords: rename, name, change, school, group
           What it's for. Changing what a school or group is called everywhere it
           appears. Nothing else moves — the same people, classes and links carry on
           under the new name.
           Where it is. The node's home page, **Rename** along the top.
           How you do it.
           1. Open the home page of the school or group.
           2. Tap **Rename**.
           3. Type the new name.
           4. Tap **Save**.
           Worth knowing. If the new name matches something else already sitting beside
           it you are warned and asked to confirm, because two identical names in one
           list is usually a mistake rather than a plan.
           checked: 6926fba3.1ab1b0b4
      -->
      <button v-if="!member" type="button" class="verb" :class="{ 'is-open': openForm === 'rename' }" data-walk="verb-rename" @click="openRename">{{ t('org.ui.nodeActionBar.rename', 'Rename') }}</button>
      <button v-if="!member && node.is_demo" type="button" class="verb verb-demo" :disabled="isRefreshing" @click="refreshDemo">
        {{ isRefreshing ? t('org.ui.nodeActionBar.refreshing', 'Refreshing…') : t('org.ui.nodeActionBar.refreshDemoActivity', 'Refresh demo activity') }}
      </button>
      <!-- HANDBOOK Delete a school or group
           section: your-school
           roles: admin
           place: node-home
           keywords: delete, remove, school, group, close
           What it's for. Removing a school or group that should never have existed, or
           has been wound up. It is the one verb here that takes everything below it with
           it.
           Where it is. The node's home page, **Delete** at the end of the row of
           buttons.
           How you do it.
           1. Open the home page of the school or group.
           2. Tap **Delete**.
           3. Read the summary of what goes with it — classes, people and links are
              counted for you.
           4. Type the name back when asked, and confirm.
           Worth knowing. You are only asked to type the name when there is real activity
           underneath, which is the signal to stop and check. An empty shell deletes on a
           single confirm.
           checked: bbc6b74d.fdd02145
      -->
      <button v-if="!member" type="button" class="verb verb-danger" data-walk="verb-delete" @click="requestDelete">{{ t('org.ui.nodeActionBar.delete', 'Delete') }}</button>
      </template>
    </div>

    <!-- Inline forms (one at a time) -->
    <div v-if="openForm === 'person'" class="verb-form-block">
      <div class="verb-form">
        <!-- HANDBOOK Choose what role someone arrives as
             section: getting-people-in
             roles: admin, leader, school_admin
             place: node-home
             keywords: role, teacher, leader, learner, invite, permissions
             What it's for. The role you pick on an invite is the role the person lands
             in, and it travels with the link rather than being set afterwards. Teacher
             sees their own classes, group leader sees everything below their node,
             learner just learns.
             Where it is. Any node's home page, **Invite a person**, the role dropdown
             on the left of the form.
             How you do it.
             1. Tap **Invite a person** on the node you want them to belong to.
             2. Open the role dropdown.
             3. Pick the role they should hold in this place.
             4. Fill in their name and submit.
             Worth knowing. The place matters as much as the role — a group leader
             invited on a group leads that group and everything under it, so invite
             people on the node whose shape you actually mean.
             checked: 8119168f.215b02bb
        -->
        <select v-if="!classMode" v-model="personRole" class="frost-select" data-walk="invite-form-role">
          <option v-if="!neutral" value="teacher">{{ t('org.ui.nodeActionBar.roleTeacher', 'Teacher') }}</option>
          <option value="leader">{{ t('org.ui.nodeActionBar.roleGroupLeader', 'Group leader') }}</option>
          <option v-if="!neutral && node.commercial" value="school_leader">{{ t('org.ui.nodeActionBar.roleSchoolLeader', 'School leader') }}</option>
          <option value="student">{{ t('org.ui.nodeActionBar.roleLearner', 'Learner') }}</option>
        </select>
        <input v-model="personName" type="text" class="frost-input" :placeholder="classMode ? t('org.ui.nodeActionBar.studentsName', 'Student\'s name') : t('org.ui.nodeActionBar.theirName', 'Their name')" @keyup.enter="submitPerson" />
        <input v-model="personEmail" type="email" class="frost-input" :placeholder="t('org.ui.nodeActionBar.theirEmailWeSend', 'Their email — we\'ll send the invite')" />
        <button class="btn-primary-sm" data-walk="invite-form-submit" :disabled="isInvitingPerson || !personName.trim()" @click="submitPerson">
          {{ isInvitingPerson ? (personEmail.trim() ? t('org.ui.nodeActionBar.sending', 'Sending…') : t('org.ui.nodeActionBar.creating', 'Creating…')) : (personEmail.trim() ? t('org.ui.nodeActionBar.sendTheirInvite', 'Send their invite') : t('org.ui.nodeActionBar.createTheirLink', 'Create their link')) }}
        </button>
      </div>
      <p v-if="classMode" class="kind-hint">{{ t('org.ui.nodeActionBar.hintOneStudentAtATime', 'One student at a time — their link puts them straight into this class, no screens. Give an email and we send it for you; leave it blank and you get a link to share.') }}</p>
      <p v-else class="kind-hint">{{ t('org.ui.nodeActionBar.hintNamedInvite', 'Named invite — goes straight in, no screens. Give an email and we send it for you; leave it blank and you get a link to share.') }}</p>
    </div>
    <div v-else-if="openForm === 'invite'" class="verb-form-block">
      <div class="verb-form">
        <select v-model="inviteRole" class="frost-select">
          <option v-if="!neutral" value="teacher">{{ t('org.ui.nodeActionBar.roleTeacher', 'Teacher') }}</option>
          <option value="leader">{{ t('org.ui.nodeActionBar.roleGroupLeader', 'Group leader') }}</option>
          <option v-if="!neutral && node.commercial" value="school_leader">{{ t('org.ui.nodeActionBar.roleSchoolLeader', 'School leader') }}</option>
          <option value="student">{{ t('org.ui.nodeActionBar.roleLearner', 'Learner') }}</option>
        </select>
        <button class="btn-primary-sm" :disabled="isInviting" @click="submitInvite">
          {{ isInviting ? t('org.ui.nodeActionBar.creating', 'Creating…') : t('org.ui.nodeActionBar.createInviteLink', 'Create invite link') }}
        </button>
      </div>
      <p class="kind-hint">{{ t('org.ui.nodeActionBar.hintShareableNewArrivals', 'Shareable — new arrivals enter their name before they\'re in.') }}</p>
    </div>
    <div v-else-if="openForm === 'group'" class="verb-form-block">
      <div class="verb-form">
        <input v-model="newChildName" type="text" class="frost-input" :placeholder="t('org.ui.nodeActionBar.groupName', 'Group name')" @keyup.enter="submitGroup()" />
        <button class="btn-primary-sm" :disabled="isAddingChild || !newChildName.trim()" @click="submitGroup()">
          {{ isAddingChild ? t('org.ui.nodeActionBar.adding', 'Adding…') : t('org.ui.nodeActionBar.add', 'Add') }}
        </button>
      </div>
      <div v-if="childDuplicateWarning" class="duplicate-warning" role="alert">
        <p class="duplicate-warning-text">{{ childDuplicateWarning }}</p>
        <div class="duplicate-warning-actions">
          <button type="button" class="btn-ghost-sm" @click="childDuplicateWarning = null">{{ t('org.ui.nodeActionBar.changeTheName', 'Change the name') }}</button>
          <button type="button" class="btn-primary-sm" :disabled="isAddingChild" @click="submitGroup(true)">
            {{ isAddingChild ? t('org.ui.nodeActionBar.adding', 'Adding…') : t('org.ui.nodeActionBar.goAheadAnyway', 'Go ahead anyway') }}
          </button>
        </div>
      </div>
    </div>
    <div v-else-if="openForm === 'school'" class="verb-form">
      <input v-model="newChildName" type="text" class="frost-input" :placeholder="t('org.ui.nodeActionBar.schoolName', 'School name')" @keyup.enter="submitSchool" />
      <button class="btn-primary-sm" :disabled="isAddingChild || !newChildName.trim()" @click="submitSchool">
        {{ isAddingChild ? t('org.ui.nodeActionBar.adding', 'Adding…') : t('org.ui.nodeActionBar.add', 'Add') }}
      </button>
    </div>
    <div v-else-if="openForm === 'class'" class="verb-form-block">
      <div class="verb-form">
        <input v-model="newClassName" type="text" class="frost-input" :placeholder="t('org.ui.nodeActionBar.className', 'Class name')" data-walk="add-class-name" @keyup.enter="submitClass" />
        <span class="course-select-wrap">
          <FrostSelect
            v-model="newClassCourse"
            :options="courseOptions"
            filterable
            :filter-placeholder="t('org.ui.nodeActionBar.searchCourses', 'Search courses…')"
            :placeholder="t('org.ui.nodeActionBar.chooseCourse', 'Choose course')"
            :aria-label="t('org.ui.nodeActionBar.courseForThisClass', 'Course for this class')"
          />
        </span>
        <button class="btn-primary-sm" data-walk="add-class-submit" :disabled="isAddingClass || !newClassName.trim() || !newClassCourse" @click="submitClass">
          {{ isAddingClass ? t('org.ui.nodeActionBar.adding', 'Adding…') : t('org.ui.nodeActionBar.add', 'Add') }}
        </button>
      </div>
      <p class="kind-hint">{{ t('org.ui.nodeActionBar.hintNoTeacherNeeded', 'No teacher needed yet — the class exists on its own, and you can put a teacher on it any time from your staff list.') }}</p>
    </div>
    <div v-else-if="openForm === 'demo'" class="verb-form">
      <input v-model="demoName" type="text" class="frost-input" :placeholder="t('org.ui.nodeActionBar.demoOrgName', 'Demo org name')" @keyup.enter="submitDemo" />
      <input v-model="demoLeaderEmail" type="email" class="frost-input" :placeholder="t('org.ui.nodeActionBar.leaderEmailOptional', 'Leader email (optional)')" />
      <button class="btn-primary-sm" :disabled="isMinting || !demoName.trim()" @click="submitDemo">
        {{ isMinting ? t('org.ui.nodeActionBar.minting', 'Minting…') : t('org.ui.nodeActionBar.mint', 'Mint') }}
      </button>
    </div>
    <div v-else-if="openForm === 'rename'" class="verb-form-block">
      <div class="verb-form">
        <input v-model="renameValue" type="text" class="frost-input" :placeholder="t('org.ui.nodeActionBar.newName', 'New name')" @keyup.enter="submitRename()" @keyup.escape="openForm = null" />
        <button class="btn-primary-sm" :disabled="isRenaming || !renameValue.trim()" @click="submitRename()">
          {{ isRenaming ? t('org.ui.nodeActionBar.saving', 'Saving…') : t('org.ui.nodeActionBar.save', 'Save') }}
        </button>
      </div>
      <div v-if="renameDuplicateWarning" class="duplicate-warning" role="alert">
        <p class="duplicate-warning-text">{{ renameDuplicateWarning }}</p>
        <div class="duplicate-warning-actions">
          <button type="button" class="btn-ghost-sm" @click="renameDuplicateWarning = null">{{ t('org.ui.nodeActionBar.changeTheName', 'Change the name') }}</button>
          <button type="button" class="btn-primary-sm" :disabled="isRenaming" @click="submitRename(true)">
            {{ isRenaming ? t('org.ui.nodeActionBar.saving', 'Saving…') : t('org.ui.nodeActionBar.goAheadAnyway', 'Go ahead anyway') }}
          </button>
        </div>
      </div>
    </div>
    <div v-else-if="openForm === 'courses'" class="verb-form verb-form-block">
      <NodeEntitlementControl :node-id="entitlementNodeId" :node-type="entitlementNodeType" />
    </div>

    <!-- Result / error banners -->
    <p v-if="error" class="node-actions-banner is-error">{{ error }}</p>
    <div v-else-if="notice" class="node-actions-banner is-ok">
      <span>{{ notice }}</span>
      <button
        v-if="shareUrl" type="button" class="share-chip" :class="{ 'is-copied': copied }" @click="copyShare"
      >{{ copied ? t('org.ui.nodeActionBar.copied', 'Copied!') : shareUrl.url }}</button>
      <span v-if="shareUrl" class="share-hint">{{ shareUrl.hint }}</span>
    </div>

    <!-- Password before the first add, then the install nudge. Blocks only
         the password step; the install step is always escapable. -->
    <ManagerOnboardingGate :is-open="gateOpen" @passworded="resumePendingVerb" @close="closeGate" />

    <ConfirmDeleteModal
      :is-open="deleteOpen"
      :title="deleteTitle"
      :target-name="node.name"
      :impact-lines="deleteImpactLines"
      :require-typed-confirm="!!deleteImpact?.hasRealActivity"
      :submitting="deleteSubmitting"
      :error="deleteError"
      @close="closeDelete"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.node-actions { display: flex; flex-direction: column; gap: var(--space-3); }
.verb-bar { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.verb {
  padding: 8px 14px; font: inherit; font-size: var(--text-sm); font-weight: var(--font-semibold);
  border-radius: var(--radius-lg); border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(44, 38, 34, 0.05); color: var(--schools-fg, #0F1212); cursor: pointer;
  transition: all var(--transition-fast);
}
.verb:hover:not(:disabled) { background: rgba(44, 38, 34, 0.11); }
.verb.is-open { background: var(--schools-red, #DB1E17); border-color: transparent; color: #fff; }
.verb:disabled { opacity: 0.55; cursor: wait; }
.verb-demo { background: rgba(var(--tone-amber, 194 132 58), 0.16); border-color: rgba(var(--tone-amber, 194 132 58), 0.3); color: rgb(var(--tone-amber-ink, 154 96 24)); }
.verb-danger { color: rgb(var(--tone-red)); border-color: rgba(var(--tone-red), 0.28); }
.verb-danger:hover:not(:disabled) { background: rgba(var(--tone-red), 0.08); }

.verb-form { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.verb-form-block { display: block; }

/* The course picker on Add-a-class. ~74 live courses is far too long a list
   to scan, so it's the shared filterable FrostSelect rather than a native
   select; these vars are how that control wears this bar's typography (same
   pattern as SetupView's .select-wrap). */
.course-select-wrap {
  position: relative; display: flex; min-width: 200px;
  --fs-font: inherit; --fs-font-size: var(--text-sm); --fs-radius: var(--radius-lg);
  --fs-bg: rgba(255, 255, 255, 0.7); --fs-border: rgba(44, 38, 34, 0.12);
  --rc-entity: var(--tone-red); --rc-entity-ink: var(--schools-red);
}
.course-select-wrap > * { flex: 1; min-width: 0; }

/* Duplicate-name warning — information, not an error. Nothing has gone
   wrong; there is just a choice to make. */
.duplicate-warning { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2); }
.duplicate-warning-text {
  margin: 0; font-size: var(--text-sm); color: var(--schools-fg-2); line-height: 1.5;
  background: rgba(var(--tone-red), 0.06); border: 1px solid rgba(var(--tone-red), 0.18);
  border-radius: var(--radius-lg); padding: var(--space-3);
}
.duplicate-warning-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.btn-ghost-sm {
  padding: 6px 12px; font-size: var(--text-xs); font-weight: var(--font-medium); border-radius: var(--radius-md);
  border: 1px solid rgba(44, 38, 34, 0.14); background: rgba(255, 255, 255, 0.6); color: var(--schools-fg-2); cursor: pointer; white-space: nowrap;
}
.btn-ghost-sm:hover:not(:disabled) { background: rgba(255, 255, 255, 0.9); }
.btn-ghost-sm:disabled { opacity: 0.5; cursor: not-allowed; }
.kind-hint { margin: 6px 0 0; font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); }
.frost-input, .frost-select {
  font: inherit; font-size: var(--text-sm); padding: 8px 12px; color: var(--schools-fg, #0F1212);
  background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(44, 38, 34, 0.12); border-radius: var(--radius-lg);
}
.frost-input:focus, .frost-select:focus { outline: none; border-color: rgba(var(--tone-red), 0.55); box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14); }
.btn-primary-sm {
  padding: 8px 16px; font: inherit; font-size: var(--text-sm); font-weight: var(--font-semibold);
  border-radius: var(--radius-full, 999px); border: none; background: var(--schools-red, #DB1E17); color: #fff; cursor: pointer;
}
.btn-primary-sm:disabled { opacity: 0.5; cursor: not-allowed; }

.node-actions-banner {
  display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); font-size: var(--text-sm);
}
.node-actions-banner.is-ok { background: rgba(var(--tone-green), 0.10); border: 1px solid rgba(var(--tone-green), 0.28); color: rgb(var(--tone-green-ink)); }
.node-actions-banner.is-error { background: rgba(var(--tone-red), 0.08); border: 1px solid rgba(var(--tone-red), 0.28); color: rgb(var(--tone-red)); }
.share-chip {
  font-family: var(--font-mono); font-size: var(--text-xs); padding: 5px 10px; cursor: pointer;
  background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(44, 38, 34, 0.10); border-radius: var(--radius-md);
  color: var(--schools-fg-2, #555); word-break: break-all; text-align: left;
}
.share-chip.is-copied { background: rgba(var(--tone-green), 0.16); border-color: rgba(var(--tone-green), 0.45); color: rgb(var(--tone-green-ink)); }
.share-hint { font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); }
</style>
