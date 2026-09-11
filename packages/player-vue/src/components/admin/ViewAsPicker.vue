<script setup lang="ts">
/**
 * ViewAsPicker — the ONE way into view-as. Lives in the admin top bar, so it
 * is reachable from every admin page rather than scattered as eye-icons over
 * a tree that has since been redesigned.
 *
 * Two ways to pick, which is exactly the two questions being asked:
 *   - a ROLE ("show me what any learner sees") — no person, no foreign scope;
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

const { viewAs, viewAsError } = useViewAs()
const { canViewAs } = useUserRole()
const { getAuthToken } = useAdminClient()

const open = ref(false)
const query = ref('')
const results = ref<ViewAsPersona[]>([])
const searching = ref(false)

const ROLES: { role: ViewAsPersona['role']; label: string; hint: string }[] = [
  { role: 'student', label: 'Learner', hint: 'the app with no staff surfaces at all' },
  { role: 'teacher', label: 'Teacher', hint: 'a class-scoped teacher' },
  { role: 'school_admin', label: 'School leader', hint: 'a whole school' },
  { role: 'govt_admin', label: 'Group leader', hint: 'a group of schools' },
]

function asRole(role: ViewAsPersona['role'], label: string): void {
  open.value = false
  // Role-only: no userId, so nothing foreign is loaded — the app simply
  // wears that role. Pick a person below to get their real data too.
  void viewAs({ key: `role:${role}`, userId: '', role, name: label })
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
    const res = await fetch(`/api/admin/users?limit=25&search=${encodeURIComponent(q)}`, {
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    })
    const data = await res.json().catch(() => ({}))
    if (token !== searchToken) return
    const users = Array.isArray(data?.users) ? data.users : []
    results.value = users
      .filter((u: any) => u.educational_role && VIEW_AS_ROLES.has(u.educational_role))
      .map((u: any) => ({
        key: u.user_id,
        userId: u.user_id,
        learnerId: u.id,
        role: u.educational_role as ViewAsPersona['role'],
        name: u.display_name || u.primary_email || 'Unnamed',
      }))
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
        @click="asRole(r.role, r.label)"
      >
        <span class="vap-item-label">{{ r.label }}</span>
        <span class="vap-item-hint">{{ r.hint }}</span>
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
        v-for="p in results"
        :key="p.key"
        type="button"
        class="vap-item"
        @click="pick(p)"
      >
        <span class="vap-item-label">{{ p.name }}</span>
        <span class="vap-item-hint">{{ p.role }}</span>
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
