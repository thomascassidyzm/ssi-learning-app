<script setup lang="ts">
/**
 * Question 6 — one person's story.
 *
 * "What is this one person's story, and what has gone wrong for them?" The
 * support console, in the five-part shape: who they are and their support
 * id, whether they count as a real person, what they can actually play and
 * through which door, where they are in each course, what they did last and
 * on what — and the verbs that fix things, across the top, each confirming
 * first and each calling the one endpoint that already does the job.
 *
 * What the old page had that this does not: its six diagnostic telemetry
 * sections — speaking opportunities, the L1 state, the per-LEGO metrics,
 * the entitlement-code history. Those were reads of raw tables for
 * debugging the player, not answers to a support call, and they live where
 * the player's own diagnostics live. Named here so nobody thinks they were
 * forgotten.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import QuestionPage from '@/intel/QuestionPage.vue'
import Pill from '@/intel/Pill.vue'
import VerbButton from '@/intel/VerbButton.vue'
import { useIntelApi } from '@/intel/useIntelApi'
import { questionBySlug } from '@/intel/questions'
import { metric } from '@/intel/metrics'

type ExclusionReason = 'demo' | 'internal' | 'class-account' | 'staff-role' | 'test-school-or-address'
interface Person {
  id: string
  authUserId: string
  supportId: string | null
  name: string | null
  emails: { email: string; primary: boolean; verified: boolean }[]
  createdAt: string
  platformRole: string | null
  educationalRole: string | null
  flags: { isDemo: boolean; isInternal: boolean; isClassEntity: boolean }
  counted: boolean
  excludedBecause: ExclusionReason[]
  standing: 'paying' | 'gifted' | 'free'
  subscriptions: { provider: string | null; status: string | null; periodEnd: string | null; cancelling: boolean }[]
  access: { id: string; accessType: string; courses: string[] | null; expiresAt: string | null; derived: boolean }[]
  memberships: { kind: string; id: string; role: string }[]
  positions: { course: string; legoId: string | null; knownText: string | null; targetText: string | null; lastPractisedAt: string | null }[]
  practice: { sessions30: number; days30: number; lastSessionAt: string | null }
  recent: { at: string; type: string; course: string | null; device: string | null; country: string | null; build: string | null }[]
  devices: string[]
  countries: string[]
}

const question = questionBySlug('person')!
const route = useRoute()
const personId = computed(() => (typeof route.query.person === 'string' ? route.query.person : null))
const { data, error, fetchedAt, load } = useIntelApi<Person>('/api/intel/person')

function reload(): void {
  if (personId.value) void load({ id: personId.value })
}
onMounted(reload)
watch(personId, reload)

const REASON_WORDS: Record<ExclusionReason, string> = {
  demo: 'a demo account',
  internal: 'marked internal',
  'class-account': 'a class account, not a person',
  'staff-role': 'SSi staff',
  'test-school-or-address': 'tied to a test school or a test address',
}

const displayName = computed(() => data.value?.name || data.value?.emails[0]?.email || 'Somebody with no name yet')

const populationNote = computed<string | null>(() => {
  const d = data.value
  if (!d) return null
  if (d.counted) return 'Counts as a real person in every number on this surface.'
  return `Left out of every number: ${d.excludedBecause.map((r) => REASON_WORDS[r]).join(', ')}.`
})

const answer = computed<string | null>(() => {
  if (!personId.value) return 'Pick a person under People on the left, or open a row on Leaving.'
  if (error.value) return error.value
  const d = data.value
  if (!d) return null
  const since = d.practice.lastSessionAt
    ? `last practised ${days(d.practice.lastSessionAt)}`
    : 'has not practised in the last thirty days'
  const standing = d.standing === 'paying' ? 'paying' : d.standing === 'gifted' ? 'on gifted access' : 'on free access'
  // A live subscription is its own door and has no entitlement row, so a
  // paying person reads as able to play everything through it — the live
  // probe of 2026-09-10 found a paying learner with zero entitlement rows.
  const play = d.standing === 'paying'
    ? 'can play everything through their subscription'
    : d.access.length
      ? `can play ${d.access.some((a) => a.accessType === 'full') ? 'everything' : d.access.flatMap((a) => a.courses ?? []).join(', ') || 'what their access allows'}`
      : 'can play only the free part of any course'
  return `${displayName.value} is ${standing}, ${play}, and ${since}: ${d.practice.days30} ${d.practice.days30 === 1 ? 'day' : 'days'} of practice in the last thirty.`
})

function days(iso: string | null): string {
  if (!iso) return 'never'
  const n = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (n <= 0) return 'today'
  return `${n} ${n === 1 ? 'day' : 'days'} ago`
}
function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// The verbs. Every one calls the endpoint that already does the job; the
// endpoint writes the audit row naming the human. Confirm text names what
// will change, in plain words.
const fullAccess = computed(() => data.value?.access.find((a) => a.accessType === 'full' && !a.derived) ?? null)
const isStaff = computed(() => !!data.value?.platformRole)
const signinLink = ref<string | null>(null)
const flagReason = ref('')
</script>

<template>
  <!-- HANDBOOK One person's story
       section: seeing-progress
       roles: admin
       place: intel
       keywords: person, support, account, access, sign in, role, trial, flag, position, story
       What it's for. Everything that answers a support call about one
       person: who they are, their support id, whether they count as a real
       person, what they can play and through which door, where they are in
       each course, what they did last and on what.
       Where it is. **One person**, under What's happening. Open a row on
       Leaving, or find them under People.
       How you do it.
       1. Read the sentence for their standing, their access and their last
          practice, and the pill beneath it for whether they count.
       2. Use the verbs across the top to act: give full access, take it
          back, make a one-off sign-in link, change their role, change their
          trial, or correct a wrong flag. Every verb says what it will change
          and asks before it does.
       3. Read the cards for their access, their memberships, their course
          positions and their last few events.
       Worth knowing. Every verb is recorded against your own name by the
       server. A comped person stays a real person; only staff and test are
       left out of the numbers.
       checked: 901ff5c0.db2eb464
  -->
  <QuestionPage
    data-intel="question-person"
    :question="question.question"
    :answer="answer"
    :fetched-at="fetchedAt"
    :people="data ? 1 : null"
    :population-note="populationNote"
    :person="data ? { id: data.id, name: displayName } : null"
  >
    <template #verbs>
      <template v-if="data">
        <VerbButton
          v-if="!fullAccess && data.standing !== 'paying'"
          label="Give full access"
          primary
          :confirm="`Give ${displayName} full access to every course for a year. They stay a real person in the numbers.`"
          endpoint="/api/admin/grant-entitlement"
          :body="{ learner_id: data.id, access_type: 'full', duration_type: 'time_limited', duration_days: 365 }"
          confirm-word="Give it"
          @done="reload"
        />
        <VerbButton
          v-else
          label="Take full access back"
          :confirm="`Take ${displayName}'s full access away. They keep the free part of every course.`"
          endpoint="/api/admin/revoke-entitlement"
          :body="{ entitlement_id: fullAccess.id }"
          confirm-word="Take it back"
          @done="reload"
        />
        <VerbButton
          label="Make a one-off sign-in link"
          :confirm="`Make a link that signs in as ${displayName} once. Whoever opens it becomes them, so hand it over carefully.`"
          endpoint="/api/admin/create-signin-link"
          :body="{ learner_id: data.id }"
          confirm-word="Make the link"
          :result="(b) => String(b.link ?? b.url ?? b.action_link ?? 'Made. Copy it from the response.')"
          @done="(b) => { signinLink = String(b.link ?? b.url ?? b.action_link ?? '') }"
        />
        <VerbButton
          v-if="isStaff"
          label="Make them a learner again"
          :confirm="`Take ${displayName}'s ${data.platformRole} role away. They keep the internal flag until you correct it on purpose.`"
          endpoint="/api/admin/update-user-role"
          :body="{ learner_id: data.id, field: 'platform_role', value: null }"
          confirm-word="Change it"
          @done="reload"
        />
        <VerbButton
          v-else
          label="Make them a tester"
          :confirm="`Make ${displayName} a tester: full content access, and marked internal from this moment so they leave every number.`"
          endpoint="/api/admin/update-user-role"
          :body="{ learner_id: data.id, field: 'platform_role', value: 'tester' }"
          confirm-word="Change it"
          @done="reload"
        />
        <VerbButton
          v-if="data.educationalRole === 'school_admin' || data.educationalRole === 'teacher' || data.educationalRole === 'tutor'"
          label="Restore their trial"
          :confirm="`Restore the platform trial on every school ${displayName} administers and on their own teacher record, each to its own window.`"
          endpoint="/api/admin/set-trial"
          :body="{ user_id: data.authUserId, action: 'restore' }"
          confirm-word="Restore it"
          @done="reload"
        />
        <span class="flag-verb">
          <input v-model="flagReason" class="reason" type="text" placeholder="why the flag is wrong" aria-label="Why the flag is wrong" />
          <VerbButton
            v-if="data.flags.isDemo || data.flags.isInternal"
            label="This is a real person"
            :confirm="`Mark ${displayName} as neither demo nor internal. They join every number from now on. Reason: ${flagReason || 'none given'}.`"
            endpoint="/api/admin/set-learner-flags"
            :body="{ learner_id: data.id, is_demo: false, is_internal: false, reason: flagReason }"
            confirm-word="Correct it"
            @done="reload"
          />
          <VerbButton
            v-else
            label="This is not a real person"
            :confirm="`Mark ${displayName} as internal. They leave every number from now on. Reason: ${flagReason || 'none given'}.`"
            endpoint="/api/admin/set-learner-flags"
            :body="{ learner_id: data.id, is_internal: true, reason: flagReason }"
            confirm-word="Correct it"
            @done="reload"
          />
        </span>
      </template>
    </template>

    <template #evidence>
      <div v-if="!personId" class="empty-state">Pick a person and this fills in.</div>
      <div v-else-if="data" class="evidence-cards">
        <div class="card">
          <p class="kicker">Who</p>
          <p class="big arsenal">{{ displayName }}</p>
          <p class="line" v-for="e in data.emails" :key="e.email">{{ e.email }} <Pill v-if="e.primary" tone="quiet">primary</Pill> <Pill v-if="!e.verified" tone="watch">unverified</Pill></p>
          <p class="line">Support id <span class="mono">{{ data.supportId ?? '–' }}</span></p>
          <p class="line">Joined {{ when(data.createdAt) }}</p>
          <p class="line">
            <Pill :tone="data.standing === 'paying' ? 'good' : data.standing === 'gifted' ? 'watch' : 'quiet'">{{ data.standing }}</Pill>
            <Pill v-if="data.platformRole" tone="quiet">{{ data.platformRole }}</Pill>
            <Pill v-if="data.educationalRole" tone="quiet">{{ data.educationalRole }}</Pill>
            <Pill v-if="data.flags.isDemo" tone="alarm">demo</Pill>
            <Pill v-if="data.flags.isInternal" tone="alarm">internal</Pill>
          </p>
          <p v-if="signinLink" class="line mono break">{{ signinLink }}</p>
        </div>
        <div class="card">
          <p class="kicker">What they can play</p>
          <p v-if="data.standing === 'paying'" class="line">Everything, through their subscription.</p>
          <p v-else-if="!data.access.length" class="line">Only the free part of any course. No door is open for them.</p>
          <p v-for="a in data.access" :key="a.id" class="line">
            {{ a.accessType === 'full' ? 'Everything' : (a.courses ?? []).join(', ') || a.accessType }}
            <span class="muted">{{ a.derived ? 'through a school, class or organisation' : 'given directly' }}{{ a.expiresAt ? `, until ${when(a.expiresAt)}` : '' }}</span>
          </p>
          <p v-for="(s, i) in data.subscriptions" :key="i" class="line">
            {{ s.provider }} subscription, {{ s.status }}<span v-if="s.cancelling">, cancelling</span><span v-if="s.periodEnd" class="muted">, period ends {{ when(s.periodEnd) }}</span>
          </p>
          <p v-for="m in data.memberships" :key="`${m.kind}:${m.id}`" class="line">
            <router-link :to="m.kind === 'class' ? `/admin/classes/${m.id}` : m.kind === 'school' ? `/admin/schools/${m.id}` : `/admin/groups/${m.id}`">{{ m.role }} in a {{ m.kind }}</router-link>
          </p>
        </div>
        <div class="card">
          <p class="kicker">{{ metric('personPractice', question.slug).label }}</p>
          <p class="big mono">{{ data.practice.sessions30 }} <span class="muted small">sessions</span> · {{ data.practice.days30 }} <span class="muted small">days</span></p>
          <p class="line">Last practised {{ days(data.practice.lastSessionAt) }}</p>
          <p class="line muted">{{ [...data.devices, ...data.countries].join(' · ') || 'no device or country seen yet' }}</p>
        </div>
      </div>
    </template>

    <template #rows>
      <div v-if="data" class="rows-card">
        <p class="rows-title">{{ metric('personPositions', question.slug).label }}</p>
        <p v-if="!data.positions.length" class="rows-empty">They have not opened a course.</p>
        <router-link
          v-for="p in data.positions"
          :key="p.course"
          class="row"
          :to="{ path: '/intel/weak-points', query: { course: p.course } }"
        >
          <span class="who">
            <span class="name">{{ p.course }}</span>
            <span class="muted small">{{ p.lastPractisedAt ? `practised ${days(p.lastPractisedAt)}` : 'never practised' }}</span>
          </span>
          <span class="position">
            <span v-if="p.knownText" class="known">{{ p.knownText }}</span>
            <span v-if="p.targetText" class="target">{{ p.targetText }}</span>
            <span v-if="!p.knownText && !p.targetText" class="muted small">at the start</span>
          </span>
        </router-link>
        <p class="rows-title">What they did last</p>
        <p v-if="!data.recent.length" class="rows-empty">Nothing recorded.</p>
        <p v-for="(e, i) in data.recent.slice(0, 12)" :key="i" class="event">
          <span class="mono small">{{ when(e.at) }}</span>
          <span>{{ e.type.replace(/_/g, ' ') }}</span>
          <span class="muted small">{{ [e.course, e.device, e.country, e.build?.slice(0, 7)].filter(Boolean).join(' · ') }}</span>
        </p>
      </div>
    </template>
  </QuestionPage>
</template>

<style scoped>
.empty-state {
  background: var(--schools-card);
  border: 1px dashed var(--schools-border-strong);
  border-radius: var(--schools-radius-lg);
  padding: 22px 20px;
  color: var(--schools-fg-2);
  font-size: 14px;
  max-width: 60ch;
}
.evidence-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.card, .rows-card {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg);
  padding: 14px 18px;
}
.rows-card { padding: 0; overflow: hidden; }
.kicker, .rows-title {
  margin: 0 0 6px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red);
}
.rows-title { padding: 14px 18px 8px; }
.rows-empty { padding: 0 18px 12px; margin: 0; color: var(--schools-fg-3); font-size: 14px; }
.big { margin: 0 0 6px; font-size: 22px; color: var(--schools-fg); }
.line { margin: 0 0 4px; font-size: 13.5px; color: var(--schools-fg); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.muted { color: var(--schools-fg-3); }
.small { font-size: 12px; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
.break { word-break: break-all; }
.flag-verb { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.reason {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border: 1px solid var(--schools-border-strong);
  border-radius: var(--schools-radius-md);
  background: var(--schools-card);
  color: var(--schools-fg);
  min-width: 18ch;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 18px;
  border-top: 1px solid var(--schools-border);
  color: var(--schools-fg);
  text-decoration: none;
}
.row:hover { background: var(--schools-bg); }
.who { display: flex; flex-direction: column; min-width: 0; }
.name { font-size: 14px; }
.position { display: flex; flex-direction: column; align-items: flex-end; text-align: right; min-width: 0; }
.known { font-size: 13.5px; }
.target { font-size: 12.5px; color: var(--schools-fg-3); }
.event { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; margin: 0; padding: 7px 18px; border-top: 1px solid var(--schools-border); font-size: 13px; }
</style>
