<script setup lang="ts">
// WaysInLedger — the LINK LEDGER (founder scope-add 2026-07-20): every link
// minted anywhere in this node's SUBTREE, in one place. Each row: where
// (node/school/class), role + species (personal = someone's login; shareable
// = open), the link, uses (joins for a shareable code; visits, or "Not yet",
// for a personal link — see the `uses` field below), status, created when/by — and the verbs:
// copy, revoke (undo = put back), re-mint (personal: rotates the code, same
// account). Filterable by role and by node like the children-list chips.
// Plain words only — "Ways in", never token/species jargon on screen.
import { ref, computed, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { courseShortName } from '@ssi/core'
import { useI18n } from '@/composables/useI18n'
import ShowAll from '@/components/shared/ShowAll.vue'
import { TOP_THREE } from '@/components/shared/topThree'

const { t } = useI18n()

interface LedgerLink {
  role: 'leader' | 'school_leader' | 'teacher' | 'student'
  species: 'personal' | 'shareable'
  personalName: string | null
  /** Set only when a real address is on file — gates the "Email again" verb. */
  personalEmail?: string | null
  code: string
  url: string
  where: { nodeId: string | null; classId?: string | null; name: string; kind: 'group' | 'school' | 'class' }
  /**
   * Two different kinds of number, deliberately labelled apart (2026-08-06):
   * 'redemption' = people who joined through a shareable code (invite_codes
   * .use_count). 'signin' = times the bound person opened their personal
   * link, derived from the possession_mint_attempts audit log — a personal
   * link's use_count is structurally frozen at 0, so it used to print a
   * confident "0" beside someone who had already signed in and practised.
   */
  uses: { count: number; max: number | null; kind: 'redemption' | 'signin'; lastAt: string | null }
  /**
   * Set only on a FUNDED-COHORT sign-up link (/enrol/<code>): the courses that
   * cohort's free year unlocks. Two of them — the Canolfan grants North and
   * South Welsh — means the leader can hand out a link per dialect, so each
   * course gets its own copy verb. Absent everywhere else, which is every
   * ordinary link.
   */
  enrolmentCourses?: string[]
  status: 'active' | 'revoked' | 'expired' | 'exhausted'
  createdAt: string
  createdBy: string | null
}

// `classId` = CLASS MODE: the ledger is mounted on a class page with the
// class's SCHOOL node as `nodeId` (that is the scope the endpoint answers on)
// and shows only the links minted for THIS class. Same ledger, same verbs,
// one filter — a leader standing on a class sees that class's ways in.
const props = defineProps<{ nodeId: string; classId?: string }>()

const { getAuthToken } = useAdminClient()
const links = ref<LedgerLink[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const busyCode = ref<string | null>(null)
const copiedCode = ref<string | null>(null)
const notice = ref<string | null>(null)

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.nodeId}/invites?scope=subtree`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    links.value = data.links || []
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.waysInLedger.failedLoadLinks', 'Failed to load links')
  } finally {
    isLoading.value = false
  }
}
watch(() => props.nodeId, () => { void load() }, { immediate: true })
defineExpose({ load })

const scoped = computed(() =>
  props.classId ? links.value.filter((l) => l.where.classId === props.classId) : links.value,
)

// ─── Filters: role chips + where chips (mirrors the children-list chips) ───
const ROLE_WORD = computed<Record<string, string>>(() => ({
  leader: t('org.ui.waysInLedger.roleGroupLeader', 'Group leader'),
  school_leader: t('org.ui.waysInLedger.roleSchoolLeader', 'School leader'),
  teacher: t('org.ui.waysInLedger.roleTeacher', 'Teacher'),
  student: t('org.ui.waysInLedger.roleLearner', 'Learner'),
}))
const STATUS_WORD = computed<Record<string, string>>(() => ({
  active: t('org.ui.waysInLedger.statusActive', 'active'),
  revoked: t('org.ui.waysInLedger.statusRevoked', 'revoked'),
  expired: t('org.ui.waysInLedger.statusExpired', 'expired'),
  exhausted: t('org.ui.waysInLedger.statusExhausted', 'exhausted'),
}))
const roleFilter = ref<string>('all')
const whereFilter = ref<string>('all')
const roleChips = computed(() => {
  const present = [...new Set(scoped.value.map((l) => l.role))]
  return present.map((r) => ({ value: r, word: ROLE_WORD.value[r] || r }))
})
// Class rows roll up to their school for filtering — a root node would
// otherwise grow one chip per class (30+ at the IME programme), which is
// noise, not navigation. `where.name` for a class is "Class — School".
function chipKey(l: LedgerLink): string {
  if (l.where.kind !== 'class') return l.where.name
  const dash = l.where.name.indexOf(' — ')
  return dash >= 0 ? l.where.name.slice(dash + 3) : l.where.name
}
const whereChips = computed(() => {
  const seen = new Set<string>()
  for (const l of scoped.value) seen.add(chipKey(l))
  return [...seen]
})
const visible = computed(() => scoped.value.filter((l) =>
  (roleFilter.value === 'all' || l.role === roleFilter.value) &&
  (whereFilter.value === 'all' || chipKey(l) === whereFilter.value)
))

// ─── GROUPED ROWS, then Show all (Option A, job #306, 2026-09-12) ───
// At St Alban's the ledger was fourteen rows, twelve of them reading "Anyone
// — joins as learner · shareable · 0 uses · active" with only the class name
// and code differing; on a phone that is twelve five-line cards saying one
// thing. The collapsed form that carries the meaning is one row per ROLE —
// "12 class links, none used yet · 1 teacher link, used twice · 1 school
// leader link" — with Copy kept on a single-link row because copying is the
// everyday verb, and Show all opening the ledger exactly as it was, chips,
// Revoke and all. A ledger of three links or fewer has nothing to fold and
// renders whole. Re-mint and Revoke live only in the open ledger: they are
// rare and one of them is dangerous.
const ROLE_ORDER: LedgerLink['role'][] = ['student', 'teacher', 'school_leader', 'leader']
const ledgerOpen = ref(false)
const folded = computed(() => scoped.value.length > TOP_THREE && !ledgerOpen.value)
interface LinkGroup { role: LedgerLink['role']; links: LedgerLink[]; uses: number; classLinks: boolean }
const groups = computed<LinkGroup[]>(() => {
  const by = new Map<LedgerLink['role'], LedgerLink[]>()
  for (const l of scoped.value) by.set(l.role, [...(by.get(l.role) || []), l])
  return ROLE_ORDER.filter((r) => by.has(r)).map((role) => {
    const links = by.get(role)!
    return {
      role,
      links,
      uses: links.reduce((n, l) => n + (l.uses?.count || 0), 0),
      // Twelve learner links, one per class, are class links to a head.
      classLinks: role === 'student' && links.every((l) => l.where.kind === 'class'),
    }
  })
})
function groupWord(g: LinkGroup): string {
  const n = String(g.links.length)
  const one = g.links.length === 1
  if (g.classLinks) return (one ? t('org.ui.waysInLedger.groupClassOne', '{n} class link') : t('org.ui.waysInLedger.groupClassMany', '{n} class links')).replace('{n}', n)
  if (g.role === 'student') return (one ? t('org.ui.waysInLedger.groupLearnerOne', '{n} learner link') : t('org.ui.waysInLedger.groupLearnerMany', '{n} learner links')).replace('{n}', n)
  if (g.role === 'teacher') return (one ? t('org.ui.waysInLedger.groupTeacherOne', '{n} teacher link') : t('org.ui.waysInLedger.groupTeacherMany', '{n} teacher links')).replace('{n}', n)
  if (g.role === 'school_leader') return (one ? t('org.ui.waysInLedger.groupSchoolLeaderOne', '{n} school leader link') : t('org.ui.waysInLedger.groupSchoolLeaderMany', '{n} school leader links')).replace('{n}', n)
  return (one ? t('org.ui.waysInLedger.groupLeaderOne', '{n} group leader link') : t('org.ui.waysInLedger.groupLeaderMany', '{n} group leader links')).replace('{n}', n)
}
function groupUses(g: LinkGroup): string {
  if (g.uses === 0) return t('org.ui.waysInLedger.groupNoneUsed', 'none used yet')
  if (g.uses === 1) return t('org.ui.waysInLedger.groupUsedOnce', 'used once')
  return t('org.ui.waysInLedger.groupUsedTimes', 'used {n} times').replace('{n}', String(g.uses))
}
const showAllLinksLabel = computed(() => t('org.ui.waysInLedger.showAllLinks', 'Show all {n} links').replace('{n}', String(scoped.value.length)))
// A new node is a new page: the ledger starts folded again.
watch(() => props.nodeId, () => { ledgerOpen.value = false })

function when(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// ─── The Uses cell ───
// A shareable code counts JOINS, and its cap means something, so it keeps the
// familiar "n / max". A personal link counts the one bound person's VISITS and
// is repeatable by design, so a cap is meaningless there — show the plain
// number, and say "Not yet" rather than a bare "0", which read as "this link
// isn't working" when in fact it just hadn't been opened.
function usesText(l: LedgerLink): string {
  if (l.uses.kind === 'signin') return l.uses.count === 0 ? t('org.ui.waysInLedger.notYet', 'Not yet') : String(l.uses.count)
  return `${l.uses.count}${l.uses.max ? ` / ${l.uses.max}` : ''}`
}

function usesTitle(l: LedgerLink): string {
  if (l.uses.kind !== 'signin') {
    return (l.uses.count === 1
      ? t('org.ui.waysInLedger.personJoinedWithLink', '{n} person has joined with this link')
      : t('org.ui.waysInLedger.peopleJoinedWithLink', '{n} people have joined with this link')
    ).replace('{n}', String(l.uses.count))
  }
  const who = l.personalName || t('org.ui.waysInLedger.they', 'They')
  if (l.uses.count === 0) return t('org.ui.waysInLedger.hasNotOpenedYet', '{who} hasn\'t opened this link yet').replace('{who}', who)
  const times = l.uses.count === 1 ? t('org.ui.waysInLedger.once', 'once') : t('org.ui.waysInLedger.nTimes', '{n} times').replace('{n}', String(l.uses.count))
  return l.uses.lastAt
    ? t('org.ui.waysInLedger.signedInTimesLastOn', '{who} has signed in with this link {times} — last on {date}').replace('{who}', who).replace('{times}', times).replace('{date}', when(l.uses.lastAt))
    : t('org.ui.waysInLedger.signedInTimes', '{who} has signed in with this link {times}').replace('{who}', who).replace('{times}', times)
}

// ─── Verbs ───
async function copyLink(l: LedgerLink): Promise<void> {
  try {
    await navigator.clipboard.writeText(l.url)
    copiedCode.value = l.code
    setTimeout(() => { if (copiedCode.value === l.code) copiedCode.value = null }, 2000)
  } catch { /* clipboard unavailable */ }
}

// ─── Per-dialect enrolment links ───
//
// One code, one cohort, one enrolment record — and a query string that says
// which of the cohort's courses the holder should land in. A North Wales
// tutor gets a North Welsh link, and their class is never asked a question
// they already know the answer to. The plain Copy above still hands out the
// link that asks, and every link minted before this keeps working exactly as
// it did, because a link with no `?course=` is the one that asks.
//
// Only offered where there is a real choice: one granted course means the
// plain link already lands there.
function dialectLinks(l: LedgerLink): { course: string; name: string; url: string }[] {
  const courses = l.enrolmentCourses || []
  if (courses.length < 2) return []
  return courses.map((course) => ({
    course,
    name: courseShortName(course) || course,
    url: `${l.url}?course=${encodeURIComponent(course)}`,
  }))
}

const copiedDialect = ref<string | null>(null)
async function copyDialect(l: LedgerLink, d: { course: string; url: string }): Promise<void> {
  try {
    await navigator.clipboard.writeText(d.url)
    copiedDialect.value = `${l.code}:${d.course}`
    setTimeout(() => { if (copiedDialect.value === `${l.code}:${d.course}`) copiedDialect.value = null }, 2000)
  } catch { /* clipboard unavailable */ }
}

async function patch(l: LedgerLink, action: 'revoke' | 'reactivate' | 'rotate' | 'resend'): Promise<void> {
  if (busyCode.value) return
  busyCode.value = l.code
  error.value = null
  notice.value = null
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.nodeId}/invites`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ code: l.code, action }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    if (action === 'resend') {
      const to = data.emailed?.to || l.personalEmail
      notice.value = data.emailed?.via === 'code'
        ? t('org.ui.waysInLedger.alreadyHasAccountSentCode', '{email} already has an account, so we sent a sign-in code rather than a link. Copy the link and send it if they need the one-click way in.').replace('{email}', to)
        : t('org.ui.waysInLedger.inviteEmailedAgainTo', 'Invite emailed again to {email}.').replace('{email}', to)
    } else if (action === 'rotate' && data.url) {
      try { await navigator.clipboard.writeText(data.url) } catch { /* clipboard unavailable */ }
      const forWho = l.personalName || t('org.ui.waysInLedger.thisPerson', 'this person')
      notice.value = data.emailed?.sent
        ? t('org.ui.waysInLedger.newLinkEmailedAndCopied', 'New link for {who} — emailed to {email} and copied. The old one no longer works.').replace('{who}', forWho).replace('{email}', data.emailed.to)
        : t('org.ui.waysInLedger.newLinkCopied', 'New link for {who} — copied. The old one no longer works.').replace('{who}', forWho)
    }
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('org.ui.waysInLedger.didntWorkTryAgain', 'That didn\'t work — try again')
  } finally {
    busyCode.value = null
  }
}
</script>

<template>
  <section class="ways-in schools-card schools-card-pad">
    <!-- data-walk sits on the head, not the section — a subtree ledger can be
         thousands of px tall, and a walk ring must fit in a viewport. -->
    <!-- HANDBOOK Ways in — who can get in, and how to change it
         section: getting-people-in
         roles: admin, leader, school_admin
         place: node-home
         keywords: ways in, links, revoke, re-mint, access, ledger, shareable
         walk: ways-in
         What it's for. The ledger of every way into this part of the tree — who has a live
         link, what it lets them do, and how to change your mind.
         Where it is. The node's home page, the **Ways in** section below the lists.
         How you do it.
         1. Open the node's home page and scroll to **Ways in**.
         2. With more than three links, read one row per role — class links, teacher
            links, leader links — each saying how many there are and how often they
            have been used. A row with a single link carries **Copy**.
         3. Tap **Show all** to open the full ledger: each row a live way in, personal
            or shareable, filterable by role and by place with the chips. **Show fewer**
            folds it back.
         4. **Copy** hands you the link again.
         5. **Re-mint** issues a fresh link and kills the old one on the spot.
         6. **Revoke** closes that way in entirely.
         Worth knowing. A shareable link is open to anyone who holds it, so revoke is the
         tool when a link has travelled further than you meant.
         checked: 9e409c9a.886545b6
    -->
    <div class="ways-in-head" data-walk="ways-in-ledger">
      <span class="schools-kicker">{{ t('org.ui.waysInLedger.waysIn', 'Ways in') }}</span>
      <span v-if="!isLoading" class="ways-in-count">{{ visible.length === 1 ? t('org.ui.waysInLedger.oneLink', '1 link') : t('org.ui.waysInLedger.nLinks', '{n} links').replace('{n}', String(visible.length)) }}</span>
    </div>

    <!-- HANDBOOK Open the folded ledger
         section: getting-people-in
         roles: admin, leader, school_admin
         place: node-home
         keywords: show all, fold, ledger, links, ways in, fewer
         What it's for. Turning the one-row-per-role summary of your links into the
         full ledger, where every link has its own row and its own verbs.
         Where it is. The **Ways in** section, the **Show all** line under the role
         rows. It only appears when there are more than three links.
         How you do it.
         1. Scroll to **Ways in** on the node's home page.
         2. Tap **Show all**.
         3. The ledger opens with its filter chips and every link's row.
         4. Tap **Show fewer** at the bottom to fold it back.
         Worth knowing. Nothing is ever hidden for good: every link is one tap away.
         checked: e23cb244.81cd02f3
    -->
    <template v-if="folded">
      <ul class="ways-in-groups">
        <li v-for="g in groups" :key="g.role" class="ways-in-group" :data-role="g.role">
          <span class="group-word">{{ groupWord(g) }}</span>
          <span class="group-uses">{{ groupUses(g) }}</span>
          <button v-if="g.links.length === 1 && g.links[0].status === 'active'" type="button" class="row-verb" :class="{ 'is-copied': copiedCode === g.links[0].code }" @click="copyLink(g.links[0])">{{ copiedCode === g.links[0].code ? t('org.ui.waysInLedger.copied', 'Copied!') : t('org.ui.waysInLedger.copy', 'Copy') }}</button>
        </li>
      </ul>
      <ShowAll data-walk="ways-in-show-all" :expanded="false" :label="showAllLinksLabel" @toggle="ledgerOpen = true" />
    </template>

    <div v-if="!folded && scoped.length && !classId" class="ways-in-chips">
      <button type="button" class="chip" :class="{ 'is-on': roleFilter === 'all' }" @click="roleFilter = 'all'">{{ t('org.ui.waysInLedger.allRoles', 'All roles') }}</button>
      <button
        v-for="c in roleChips" :key="c.value" type="button" class="chip"
        :class="{ 'is-on': roleFilter === c.value }"
        @click="roleFilter = roleFilter === c.value ? 'all' : c.value"
      >{{ c.word }}</button>
      <span v-if="whereChips.length > 1" class="chip-gap" />
      <template v-if="whereChips.length > 1">
        <button type="button" class="chip" :class="{ 'is-on': whereFilter === 'all' }" @click="whereFilter = 'all'">{{ t('org.ui.waysInLedger.everywhere', 'Everywhere') }}</button>
        <button
          v-for="w in whereChips" :key="w" type="button" class="chip"
          :class="{ 'is-on': whereFilter === w }"
          @click="whereFilter = whereFilter === w ? 'all' : w"
        >{{ w }}</button>
      </template>
    </div>

    <p v-if="error" class="ways-in-note is-error">{{ error }}</p>
    <p v-else-if="notice" class="ways-in-note is-ok">{{ notice }}</p>

    <p v-if="isLoading && !scoped.length" class="ways-in-empty">{{ t('org.ui.waysInLedger.loading', 'Loading…') }}</p>
    <template v-else-if="folded" />
    <p v-else-if="!scoped.length" class="ways-in-empty">{{ classId ? t('org.ui.waysInLedger.noLinksClass', 'No links for this class yet — use “Invite students” above.') : t('org.ui.waysInLedger.noLinksNode', 'No links yet — use “Invite a person” or “Get a shareable link” above.') }}</p>

    <table v-else class="ways-in-table">
      <thead>
        <tr>
          <th data-cell="who">{{ t('org.ui.waysInLedger.whoWhat', 'Who / what') }}</th>
          <th v-if="!classId" data-cell="where">{{ t('org.ui.waysInLedger.where', 'Where') }}</th>
          <th data-cell="link">{{ t('org.ui.waysInLedger.link', 'Link') }}</th>
          <th class="num" data-cell="uses">{{ t('org.ui.waysInLedger.uses', 'Uses') }}</th>
          <th data-cell="status">{{ t('org.ui.waysInLedger.status', 'Status') }}</th>
          <th data-cell="created">{{ t('org.ui.waysInLedger.created', 'Created') }}</th>
          <th class="verbs-col" data-cell="verbs"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in visible" :key="l.code" :class="{ 'is-dead': l.status !== 'active' }">
          <td data-cell="who">
            <span class="row-role">{{ l.species === 'personal' ? (l.personalName || t('org.ui.waysInLedger.personalLink', 'Personal link')) : t('org.ui.waysInLedger.anyoneJoinsAs', 'Anyone — joins as {role}').replace('{role}', (ROLE_WORD[l.role] || l.role).toLowerCase()) }}</span>
            <span class="row-kind">{{ l.species === 'personal' ? t('org.ui.waysInLedger.ownSignInLinkGoesStraightIn', '{role} · their own sign-in link, goes straight in').replace('{role}', ROLE_WORD[l.role] || l.role) : t('org.ui.waysInLedger.shareableNewArrivalsEnterName', 'shareable · new arrivals enter their name') }}</span>
          </td>
          <td v-if="!classId" data-cell="where" :data-label="t('org.ui.waysInLedger.where', 'Where')">{{ l.where.name }}</td>
          <td class="mono" data-cell="link" :data-label="t('org.ui.waysInLedger.link', 'Link')">{{ l.code }}</td>
          <td class="num frost-mono-nums" data-cell="uses" :data-label="t('org.ui.waysInLedger.uses', 'Uses')" :class="{ 'is-not-yet': l.uses.kind === 'signin' && l.uses.count === 0 }" :title="usesTitle(l)">{{ usesText(l) }}</td>
          <td data-cell="status"><span class="status-pill" :class="`is-${l.status}`">{{ STATUS_WORD[l.status] || l.status }}</span></td>
          <td class="muted" data-cell="created">{{ when(l.createdAt) }}{{ l.createdBy ? ` · ${l.createdBy}` : '' }}</td>
          <td class="verbs-col" data-cell="verbs">
            <div class="row-verbs">
            <button v-if="l.status === 'active'" type="button" class="row-verb" :class="{ 'is-copied': copiedCode === l.code }" data-walk="ways-in-copy" @click="copyLink(l)">{{ copiedCode === l.code ? t('org.ui.waysInLedger.copied', 'Copied!') : t('org.ui.waysInLedger.copy', 'Copy') }}</button>
            <!-- HANDBOOK Hand out a sign-up link for one course
                 section: getting-people-in
                 roles: admin, leader, school_admin
                 place: node-home
                 keywords: dialect, course, link, enrol, north, south, welsh, cohort
                 What it's for. Giving one group of learners a sign-up link that puts them
                 straight into a named course, when your funded year covers more than one.
                 A North Wales tutor hands out the North Welsh link and nobody in that room
                 is asked which Welsh they meant.
                 Where it is. The node's home page, the **Ways in** section, the course-named
                 buttons on your sign-up link's row. Tap **Show all** first if the ledger is
                 folded.
                 How you do it.
                 1. Scroll to **Ways in** on the node's home page.
                 2. Find the row for your sign-up link.
                 3. Tap the button named after the course you want, and it is copied.
                 4. Send that link to the learners who want that course.
                 Worth knowing. It is the same link and the same cohort either way — the
                 course name only decides where a learner lands. **Copy** still gives you the
                 link that asks them to choose, and everyone gets the whole free year
                 whichever link they came through.
                 checked: 6c50a4f5.ed924c89
            -->
            <button
              v-for="d in (l.status === 'active' ? dialectLinks(l) : [])"
              :key="`${l.code}:${d.course}`"
              type="button"
              class="row-verb"
              :class="{ 'is-copied': copiedDialect === `${l.code}:${d.course}` }"
              data-walk="ways-in-copy-course"
              :title="t('org.ui.waysInLedger.copyCourseLinkTitle', 'Copy a sign-up link that lands the learner in {course}').replace('{course}', d.name)"
              @click="copyDialect(l, d)"
            >{{ copiedDialect === `${l.code}:${d.course}` ? t('org.ui.waysInLedger.copied', 'Copied!') : t('org.ui.waysInLedger.copyCourse', 'Copy {course}').replace('{course}', d.name) }}</button>
            <!-- HANDBOOK Email someone their invite again
                 section: getting-people-in
                 roles: admin, leader, school_admin
                 place: node-home
                 keywords: resend, email, invite, again, lost, ways in
                 What it's for. Sending the same invite email a second time to
                 somebody who never found the first one. Nothing changes and no new
                 link is made, so the one they may yet dig out of a spam folder
                 still works.
                 Where it is. The node's home page, the **Ways in** section,
                 **Email again** on their row. Tap **Show all** first if the ledger
                 is folded.
                 How you do it.
                 1. Scroll to **Ways in** on the node's home page.
                 2. Find the person's row.
                 3. Tap **Email again**.
                 4. The note above the table names the address it went to.
                 Worth knowing. Only rows for a named person with an email on file
                 carry this button. If our mail is being eaten by their school's
                 gateway, read them the link instead of sending it a third time.
                 checked: 90255865.718a020e
            -->
            <button v-if="l.status === 'active' && l.species === 'personal' && l.personalEmail" type="button" class="row-verb" :disabled="busyCode === l.code" :title="t('org.ui.waysInLedger.sendInviteToAgain', 'Send the invite to {email} again').replace('{email}', l.personalEmail)" data-walk="ways-in-resend" @click="patch(l, 'resend')">{{ t('org.ui.waysInLedger.emailAgain', 'Email again') }}</button>
            <button v-if="l.status === 'active' && l.species === 'personal'" type="button" class="row-verb" :disabled="busyCode === l.code" data-walk="ways-in-remint" @click="patch(l, 'rotate')">{{ t('org.ui.waysInLedger.remint', 'Re-mint') }}</button>
            <button v-if="l.status === 'active'" type="button" class="row-verb is-danger" :disabled="busyCode === l.code" data-walk="ways-in-revoke" @click="patch(l, 'revoke')">{{ t('org.ui.waysInLedger.revoke', 'Revoke') }}</button>
            <button v-else-if="l.status === 'revoked'" type="button" class="row-verb" :disabled="busyCode === l.code" @click="patch(l, 'reactivate')">{{ t('org.ui.waysInLedger.putBack', 'Put back') }}</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <ShowAll v-if="!folded && scoped.length > TOP_THREE" :expanded="true" :label="showAllLinksLabel" @toggle="ledgerOpen = false" />
  </section>
</template>

<style scoped>
.ways-in { display: flex; flex-direction: column; gap: var(--space-3); }
.ways-in-head { display: flex; align-items: baseline; gap: var(--space-2); }
.ways-in-count { font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); }

.ways-in-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip {
  padding: 4px 10px; font: inherit; font-size: var(--text-xs); font-weight: var(--font-semibold);
  border-radius: var(--radius-full, 999px); border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(44, 38, 34, 0.04); color: var(--schools-fg-2, #555); cursor: pointer;
}
.chip.is-on { background: var(--schools-red, #DB1E17); border-color: transparent; color: #fff; }
.chip-gap { width: 10px; }

/* The folded form: one row per role, the count and the uses, Copy on a
   single-link row. */
.ways-in-groups { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.ways-in-group {
  display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
  padding: 10px 0; border-bottom: 1px solid rgba(44, 38, 34, 0.06); font-size: var(--text-sm);
}
.ways-in-group:last-child { border-bottom: none; }
.group-word { font-weight: var(--font-semibold); color: var(--schools-fg, #0F1212); }
.group-uses { color: var(--schools-fg-3, #8A8078); font-size: var(--text-xs); }
.group-uses::before { content: '· '; }
.ways-in-group .row-verb { margin-left: auto; }

.ways-in-note { margin: 0; font-size: var(--text-sm); }
.ways-in-note.is-error { color: rgb(var(--tone-red)); }
.ways-in-note.is-ok { color: rgb(var(--tone-green-ink)); }
.ways-in-empty { margin: 0; font-size: var(--text-sm); color: var(--schools-fg-3, #8A8078); }

.ways-in-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.ways-in-table th {
  text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--schools-fg-3, #8A8078); font-weight: var(--font-semibold);
  padding: 6px 10px 6px 0; border-bottom: 1px solid rgba(44, 38, 34, 0.10);
}
.ways-in-table td { padding: 8px 10px 8px 0; border-bottom: 1px solid rgba(44, 38, 34, 0.06); vertical-align: top; }
.ways-in-table tr.is-dead td { opacity: 0.55; }
.ways-in-table .num { text-align: right; }
/* "Not yet" is a state, not a quantity — quieten it so the eye reads the real
   counts first and never mistakes it for a suspicious zero. */
.ways-in-table .num.is-not-yet { color: var(--schools-fg-3, #8A8078); font-size: var(--text-xs); white-space: nowrap; }
.ways-in-table .mono { font-family: var(--font-mono); font-size: var(--text-xs); }
.ways-in-table .muted { color: var(--schools-fg-3, #8A8078); font-size: var(--text-xs); white-space: nowrap; }

.row-role { display: block; font-weight: var(--font-semibold); color: var(--schools-fg, #0F1212); }
.row-kind { display: block; font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); }

.status-pill {
  display: inline-block; padding: 2px 8px; border-radius: var(--radius-full, 999px);
  font-size: 10px; font-weight: var(--font-semibold); text-transform: uppercase; letter-spacing: 0.05em;
}
.status-pill.is-active { background: rgba(var(--tone-green), 0.12); color: rgb(var(--tone-green-ink)); }
.status-pill.is-revoked { background: rgba(var(--tone-red), 0.10); color: rgb(var(--tone-red)); }
.status-pill.is-expired, .status-pill.is-exhausted { background: rgba(44, 38, 34, 0.08); color: var(--schools-fg-3, #8A8078); }

/* DESKTOP FIRST (founder, 2026-09-09: "most people who are doing
   administration are going to be on a desktop"). The verbs used to be one
   nowrap line, so the column DEMANDED ~300px whatever the window was, and
   Who/what — the only column that can shrink — paid for it: at 1280px its
   caption wrapped to two lines, at 1152px three, at 1024px eight, one word per
   line, on a laptop. Now the verbs wrap onto a second line when the window is
   tight, and Who/what has a floor. Measured across 1024-1440, the caption
   stays on one line at every width. */
.verbs-col { text-align: right; }
.row-verbs { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.ways-in-table td[data-cell='who'] { min-width: 260px; }
/* Two verbs to a line at worst — below this the four buttons stacked one per
   line and the row grew to three times its height (1024px, 2026-09-09). */
.ways-in-table td[data-cell='verbs'] { min-width: 158px; }
.row-verb {
  padding: 4px 9px; font: inherit; font-size: var(--text-xs); font-weight: var(--font-semibold);
  border-radius: var(--radius-md); border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(255, 255, 255, 0.6); color: var(--schools-fg-2, #555); cursor: pointer;
}
.row-verb:hover:not(:disabled) { background: rgba(44, 38, 34, 0.08); }
.row-verb:disabled { opacity: 0.5; cursor: wait; }
.row-verb.is-danger { color: rgb(var(--tone-red)); border-color: rgba(var(--tone-red), 0.25); }
.row-verb.is-copied { background: rgba(var(--tone-green), 0.14); border-color: rgba(var(--tone-green), 0.4); color: rgb(var(--tone-green-ink)); }

/* Column order is not a promise: `Where` disappears in class mode, so the old
   nth-child(6) rule hid Created on a node page and the VERBS on a class page.
   Address the cells by what they ARE. */
/* Created is the audit stamp, not an action — it is the first thing to go when
   the window cannot hold every column without squeezing Who/what. Raised from
   720px to 1120px on 2026-09-09: at 1024 the six columns plus the verbs
   overflowed the node page's content area even with the verbs wrapping. */
@media (max-width: 1120px) {
  .ways-in-table [data-cell='created'] { display: none; }
}

/* PHONE (founder, 390px, 2026-09-09): as a grid the row actions ran off the
   right edge ("Email ag…") and Who/what was so narrow its caption set one word
   per line. Below 560px the table becomes the app's CARD idiom — the same
   stacked shape NodeChildrenList takes at the same breakpoint: the person on
   their own full-width line, the facts on one wrapped meta line beneath, the
   verbs wrapping under the row they belong to. Nothing is hidden; every column
   still shows, labelled, and Copy/Email stay on screen. */
@media (max-width: 559px) {
  .ways-in-table, .ways-in-table tbody, .ways-in-table tr, .ways-in-table td { display: block; }
  .ways-in-table thead { display: none; }
  .ways-in-table tr {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px;
    padding: 10px 0; border-bottom: 1px solid rgba(44, 38, 34, 0.10);
  }
  .ways-in-table td { padding: 0; border: none; }
  /* The name and its description own a full line, so the caption wraps as prose. */
  .ways-in-table td[data-cell='who'] { flex: 1 1 100%; margin-bottom: 4px; }
  .ways-in-table td[data-cell='where'],
  .ways-in-table td[data-cell='link'],
  .ways-in-table td[data-cell='uses'],
  .ways-in-table td[data-cell='status'],
  .ways-in-table td[data-cell='created'] { flex: 0 0 auto; text-align: left; }
  /* The header row is gone, so each fact carries its own word. */
  .ways-in-table td[data-label]::before {
    content: attr(data-label) ' ';
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--schools-fg-3, #8A8078); font-weight: var(--font-semibold);
  }
  .ways-in-table td[data-cell='who'] { min-width: 0; }
  .ways-in-table td[data-cell='verbs'] { flex: 1 1 100%; margin-top: 8px; text-align: left; }
  .ways-in-table td[data-cell='verbs'] .row-verbs { justify-content: flex-start; gap: 6px; }
  .ways-in-table td[data-cell='verbs'] .row-verb { padding: 6px 12px; }
}
</style>
