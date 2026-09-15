<script setup lang="ts">
/**
 * ViewAsPicker — the ONE way into view-as. Lives in the admin top bar, so it
 * is reachable from every admin page rather than scattered as eye-icons over
 * a tree that has since been redesigned.
 *
 * Two ways to pick, which is exactly the two questions being asked:
 *   - a ROLE ("show me what any school leader sees") — for a school role this
 *     picks a REAL person of that role, so the pages carry a real school's
 *     numbers. A bare role with no scope rendered every count as 0 as if that
 *     were the truth (Tom on staging, 2026-09-11, job #265: "why the fucking
 *     hell are they all showing 0h progress") — a silent lie, so it no longer
 *     exists. Learner stays role-only: a learner has no school scope to fake.
 *     WHICH person (job #683, Tom 2026-09-14 16:20Z): the teacher or school
 *     leader whose classes played the most AS CLASS in the last seven days,
 *     never the most recently active — that landed him on Mr Williams at
 *     Monmouth, whose one class had 0 minutes, so every screen read zero.
 *     The figure is shown beside every name here and the list sorts by it.
 *     Group leader stays most-recently-active: a seven-day rollup across a
 *     whole group is out of price for a picker.
 *   - a PERSON (search) — their role AND their real school/group/class scope,
 *     so the pages render with their actual data.
 *
 * The person search runs against /api/admin/users, which is itself ssi_admin
 * only — so even the roster behind this control is server-gated.
 */
import { ref, computed, watch } from 'vue'
import { useViewAs } from '@/composables/useViewAs'
import { useUserRole, type ViewAsPersona } from '@/composables/useUserRole'
import { useAdminClient } from '@/composables/useAdminClient'
import { formatPracticeMinutes } from '@/composables/schools/practiceMinutes'

const { viewAs, viewAsError } = useViewAs()
const { canViewAs } = useUserRole()
const { getAuthToken } = useAdminClient()

const open = ref(false)
const query = ref('')
type Candidate = { persona: ViewAsPersona; minutes: number | null; school: string | null }
const results = ref<Candidate[]>([])
const searching = ref(false)

const ROLES: { role: ViewAsPersona['role']; label: string; hint: string }[] = [
  { role: 'student', label: 'Learner', hint: 'the app with no staff surfaces at all' },
  { role: 'teacher', label: 'Teacher', hint: 'the teacher whose classes played most this week, with their real classes' },
  { role: 'school_admin', label: 'School leader', hint: 'the school leader whose classes played most this week, with their real school' },
  { role: 'govt_admin', label: 'Group leader', hint: 'the most recently active group leader, with their real group' },
]

const resolvingRole = ref<ViewAsPersona['role'] | null>(null)

function toPersona(u: any): ViewAsPersona {
  return {
    key: u.user_id,
    userId: u.user_id,
    learnerId: u.id,
    role: u.educational_role as ViewAsPersona['role'],
    name: u.display_name || u.primary_email || 'Unnamed',
  }
}
const ROLE_LABEL: Record<string, string> = { teacher: 'Teacher', school_admin: 'School leader', govt_admin: 'Group leader', student: 'Learner' }
function toCandidate(u: any): Candidate {
  const hasMinutes = u.educational_role === 'teacher' || u.educational_role === 'school_admin'
  return { persona: toPersona(u), minutes: hasMinutes ? Number(u.class_minutes_7d ?? 0) : null, school: u.school_name || null }
}
/** "School leader · Chepstow · 272 min this week" — the line under a name. */
function candidateLine(c: Candidate): string {
  const parts = [ROLE_LABEL[c.persona.role] || c.persona.role]
  if (c.school) parts.push(c.school)
  if (c.minutes !== null) parts.push(`${formatPracticeMinutes(c.minutes)} this week`)
  return parts.join(' · ')
}
/** Most class minutes first; ties keep the server's order. A person with no figure sorts last. */
function byMinutes(a: Candidate, b: Candidate): number {
  return (b.minutes ?? -1) - (a.minutes ?? -1)
}

/**
 * A school role always lands on a REAL person of that role — the most
 * recently active one, so the pages carry live numbers — never a bare role
 * with no scope, which painted zeros as if they were true.
 */
async function asRole(role: ViewAsPersona['role'], label: string): Promise<void> {
  if (role === 'student') {
    open.value = false
    void viewAs({ key: `role:${role}`, userId: '', role, name: label })
    return
  }
  resolvingRole.value = role
  try {
    const auth = await getAuthToken()
    // Teacher / school leader: the server ranks the whole role by seven-day
    // play-as-class minutes and returns the busiest first. Group leader keeps
    // the most-recently-active pick.
    const ranked = role === 'teacher' || role === 'school_admin'
    const res = await fetch(`/api/admin/users?limit=50&role=${encodeURIComponent(role)}${ranked ? '&sort=class_minutes_7d' : ''}`, {
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    })
    const data = await res.json().catch(() => ({}))
    const users: any[] = (Array.isArray(data?.users) ? data.users : []).filter((u: any) => u.educational_role === role)
    if (users.length === 0) {
      viewAsError.value = `Nobody with the ${label.toLowerCase()} role has an account yet — search for a person instead.`
      return
    }
    const candidates = users.map(toCandidate)
    if (ranked) candidates.sort(byMinutes)
    else users.sort((a, b) => String(b.last_active || '').localeCompare(String(a.last_active || '')))
    open.value = false
    await viewAs(ranked ? candidates[0].persona : toPersona(users[0]))
  } catch {
    viewAsError.value = 'Could not find a person with that role — network error.'
  } finally {
    resolvingRole.value = null
  }
}

const VIEW_AS_ROLES = new Set(['teacher', 'school_admin', 'govt_admin', 'student'])

let searchToken = 0
async function search(): Promise<void> {
  const q = query.value.trim()
  if (q.length < 2) {
    results.value = []
    return
  }
  const token = ++searchToken
  searching.value = true
  try {
    const auth = await getAuthToken()
    const res = await fetch(`/api/admin/users?limit=25&class_minutes_7d=1&search=${encodeURIComponent(q)}`, {
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    })
    const data = await res.json().catch(() => ({}))
    if (token !== searchToken) return
    const users = Array.isArray(data?.users) ? data.users : []
    results.value = users
      .filter((u: any) => u.educational_role && VIEW_AS_ROLES.has(u.educational_role))
      .map(toCandidate)
      .sort(byMinutes)
  } catch {
    if (token === searchToken) results.value = []
  } finally {
    if (token === searchToken) searching.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => void search(), 250)
})

function pick(p: ViewAsPersona): void {
  open.value = false
  void viewAs(p)
}

const errorText = computed(() => viewAsError.value)
</script>

<template>
  <div v-if="canViewAs" class="vap">
    <button
      type="button"
      class="vap-trigger"
      data-testid="view-as-open"
      title="See every page as any role — read only"
      @click="open = !open"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <span>View as</span>
    </button>

    <div v-if="open" class="vap-menu">
      <p class="vap-head">A role</p>
      <button
        v-for="r in ROLES"
        :key="r.role"
        type="button"
        class="vap-item"
        :data-testid="`view-as-role-${r.role}`"
        :disabled="resolvingRole !== null"
        @click="asRole(r.role, r.label)"
      >
        <span class="vap-item-label">{{ r.label }}</span>
        <span class="vap-item-hint">{{ resolvingRole === r.role ? 'Finding one with real numbers…' : r.hint }}</span>
      </button>

      <p class="vap-head">Or a real person, with their own school and classes</p>
      <input
        v-model="query"
        class="vap-search"
        type="search"
        placeholder="Search name or email"
        data-testid="view-as-search"
      />
      <p v-if="searching" class="vap-note">Searching…</p>
      <p v-else-if="query.trim().length >= 2 && results.length === 0" class="vap-note">
        Nobody with a school role matches that.
      </p>
      <button
        v-for="c in results"
        :key="c.persona.key"
        type="button"
        class="vap-item"
        data-testid="view-as-result"
        @click="pick(c.persona)"
      >
        <span class="vap-item-label">{{ c.persona.name }}</span>
        <span class="vap-item-hint">{{ candidateLine(c) }}</span>
      </button>

      <p v-if="errorText" class="vap-error">{{ errorText }}</p>
    </div>
  </div>
</template>

<style scoped>
/* Colours come from the --schools-* tokens the admin top bar itself uses, so
   the trigger reads on the light bar. It used to carry white-on-translucent
   values written for the old dark bar, which made it invisible (2026-09-11). */
.vap {
  position: relative;
  display: inline-flex;
}
.vap-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--schools-fg-2);
  background: var(--schools-bg);
  border: 1px solid var(--schools-border-strong);
  border-radius: var(--schools-radius-md);
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.vap-trigger:hover {
  background: var(--schools-card);
  color: var(--schools-fg);
  border-color: var(--schools-fg-3);
}
.vap-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  z-index: 60;
  width: 300px;
  max-width: calc(100vw - 24px);
  max-height: 70vh;
  overflow-y: auto;
  background: var(--schools-card);
  color: var(--schools-fg);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg);
  box-shadow: var(--schools-shadow-lg);
  padding: 8px;
}
.vap-head {
  margin: 6px 6px 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--schools-fg-3);
}
.vap-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  font: inherit;
  background: none;
  border: none;
  border-radius: var(--schools-radius-md);
  padding: 7px 8px;
  cursor: pointer;
  color: var(--schools-fg);
}
.vap-item:hover {
  background: var(--schools-bg);
}
.vap-item-label {
  font-size: 14px;
  font-weight: 600;
}
.vap-item-hint {
  font-size: 12px;
  color: var(--schools-fg-3);
}
.vap-search {
  width: 100%;
  font: inherit;
  font-size: 14px;
  padding: 7px 9px;
  color: var(--schools-fg);
  background: var(--schools-card);
  border: 1px solid var(--schools-border-strong);
  border-radius: var(--schools-radius-md);
  margin: 2px 0 4px;
}
.vap-note {
  margin: 4px 8px;
  font-size: 12px;
  color: var(--schools-fg-3);
}
.vap-error {
  margin: 6px 8px 2px;
  font-size: 12px;
  color: var(--schools-red);
}

@media (max-width: 640px) {
  /* Icon only on a phone; the title still names it. */
  .vap-trigger span { display: none; }
  .vap-trigger { padding: 6px 8px; }
}
</style>
