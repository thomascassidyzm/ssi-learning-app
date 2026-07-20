<script setup lang="ts">
// WaysInLedger — the LINK LEDGER (founder scope-add 2026-07-20): every link
// minted anywhere in this node's SUBTREE, in one place. Each row: where
// (node/school/class), role + species (personal = someone's login; shareable
// = open), the link, uses n/max, status, created when/by — and the verbs:
// copy, revoke (undo = put back), re-mint (personal: rotates the code, same
// account). Filterable by role and by node like the children-list chips.
// Plain words only — "Ways in", never token/species jargon on screen.
import { ref, computed, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'

interface LedgerLink {
  role: 'leader' | 'school_leader' | 'teacher' | 'student'
  species: 'personal' | 'shareable'
  personalName: string | null
  code: string
  url: string
  where: { nodeId: string | null; name: string; kind: 'group' | 'school' | 'class' }
  uses: { count: number; max: number | null }
  status: 'active' | 'revoked' | 'expired' | 'exhausted'
  createdAt: string
  createdBy: string | null
}

const props = defineProps<{ nodeId: string }>()

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
    error.value = err instanceof Error ? err.message : 'Failed to load links'
  } finally {
    isLoading.value = false
  }
}
watch(() => props.nodeId, () => { void load() }, { immediate: true })
defineExpose({ load })

// ─── Filters: role chips + where chips (mirrors the children-list chips) ───
const ROLE_WORD: Record<string, string> = {
  leader: 'Group leader',
  school_leader: 'School leader',
  teacher: 'Teacher',
  student: 'Learner',
}
const roleFilter = ref<string>('all')
const whereFilter = ref<string>('all')
const roleChips = computed(() => {
  const present = [...new Set(links.value.map((l) => l.role))]
  return present.map((r) => ({ value: r, word: ROLE_WORD[r] || r }))
})
const whereChips = computed(() => {
  const seen = new Map<string, string>()
  for (const l of links.value) seen.set(l.where.name, l.where.name)
  return [...seen.keys()]
})
const visible = computed(() => links.value.filter((l) =>
  (roleFilter.value === 'all' || l.role === roleFilter.value) &&
  (whereFilter.value === 'all' || l.where.name === whereFilter.value)
))

function when(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// ─── Verbs ───
async function copyLink(l: LedgerLink): Promise<void> {
  try {
    await navigator.clipboard.writeText(l.url)
    copiedCode.value = l.code
    setTimeout(() => { if (copiedCode.value === l.code) copiedCode.value = null }, 2000)
  } catch { /* clipboard unavailable */ }
}

async function patch(l: LedgerLink, action: 'revoke' | 'reactivate' | 'rotate'): Promise<void> {
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
    if (action === 'rotate' && data.url) {
      try { await navigator.clipboard.writeText(data.url) } catch { /* clipboard unavailable */ }
      notice.value = `New link for ${l.personalName || 'this person'} — copied. The old one no longer works.`
    }
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'That didn\'t work — try again'
  } finally {
    busyCode.value = null
  }
}
</script>

<template>
  <section class="ways-in schools-card schools-card-pad">
    <div class="ways-in-head">
      <span class="schools-kicker">Ways in</span>
      <span v-if="!isLoading" class="ways-in-count">{{ visible.length }} link{{ visible.length === 1 ? '' : 's' }}</span>
    </div>

    <div v-if="links.length" class="ways-in-chips">
      <button type="button" class="chip" :class="{ 'is-on': roleFilter === 'all' }" @click="roleFilter = 'all'">All roles</button>
      <button
        v-for="c in roleChips" :key="c.value" type="button" class="chip"
        :class="{ 'is-on': roleFilter === c.value }"
        @click="roleFilter = roleFilter === c.value ? 'all' : c.value"
      >{{ c.word }}</button>
      <span v-if="whereChips.length > 1" class="chip-gap" />
      <template v-if="whereChips.length > 1">
        <button type="button" class="chip" :class="{ 'is-on': whereFilter === 'all' }" @click="whereFilter = 'all'">Everywhere</button>
        <button
          v-for="w in whereChips" :key="w" type="button" class="chip"
          :class="{ 'is-on': whereFilter === w }"
          @click="whereFilter = whereFilter === w ? 'all' : w"
        >{{ w }}</button>
      </template>
    </div>

    <p v-if="error" class="ways-in-note is-error">{{ error }}</p>
    <p v-else-if="notice" class="ways-in-note is-ok">{{ notice }}</p>

    <p v-if="isLoading && !links.length" class="ways-in-empty">Loading…</p>
    <p v-else-if="!links.length" class="ways-in-empty">No links yet — use “Invite a person” or “Get a shareable link” above.</p>

    <table v-else class="ways-in-table">
      <thead>
        <tr>
          <th>Who / what</th>
          <th>Where</th>
          <th>Link</th>
          <th class="num">Uses</th>
          <th>Status</th>
          <th>Created</th>
          <th class="verbs-col"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in visible" :key="l.code" :class="{ 'is-dead': l.status !== 'active' }">
          <td>
            <span class="row-role">{{ l.species === 'personal' ? (l.personalName || 'Personal link') : `Anyone — joins as ${(ROLE_WORD[l.role] || l.role).toLowerCase()}` }}</span>
            <span class="row-kind">{{ l.species === 'personal' ? `${ROLE_WORD[l.role] || l.role} · their own sign-in link` : 'shareable' }}</span>
          </td>
          <td>{{ l.where.name }}</td>
          <td class="mono">{{ l.code }}</td>
          <td class="num frost-mono-nums">{{ l.uses.count }}{{ l.uses.max ? ` / ${l.uses.max}` : '' }}</td>
          <td><span class="status-pill" :class="`is-${l.status}`">{{ l.status }}</span></td>
          <td class="muted">{{ when(l.createdAt) }}{{ l.createdBy ? ` · ${l.createdBy}` : '' }}</td>
          <td class="verbs-col">
            <button v-if="l.status === 'active'" type="button" class="row-verb" :class="{ 'is-copied': copiedCode === l.code }" @click="copyLink(l)">{{ copiedCode === l.code ? 'Copied!' : 'Copy' }}</button>
            <button v-if="l.status === 'active' && l.species === 'personal'" type="button" class="row-verb" :disabled="busyCode === l.code" @click="patch(l, 'rotate')">Re-mint</button>
            <button v-if="l.status === 'active'" type="button" class="row-verb is-danger" :disabled="busyCode === l.code" @click="patch(l, 'revoke')">Revoke</button>
            <button v-else-if="l.status === 'revoked'" type="button" class="row-verb" :disabled="busyCode === l.code" @click="patch(l, 'reactivate')">Put back</button>
          </td>
        </tr>
      </tbody>
    </table>
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

.verbs-col { text-align: right; white-space: nowrap; }
.row-verb {
  padding: 4px 9px; margin-left: 4px; font: inherit; font-size: var(--text-xs); font-weight: var(--font-semibold);
  border-radius: var(--radius-md); border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(255, 255, 255, 0.6); color: var(--schools-fg-2, #555); cursor: pointer;
}
.row-verb:hover:not(:disabled) { background: rgba(44, 38, 34, 0.08); }
.row-verb:disabled { opacity: 0.5; cursor: wait; }
.row-verb.is-danger { color: rgb(var(--tone-red)); border-color: rgba(var(--tone-red), 0.25); }
.row-verb.is-copied { background: rgba(var(--tone-green), 0.14); border-color: rgba(var(--tone-green), 0.4); color: rgb(var(--tone-green-ink)); }

@media (max-width: 720px) {
  .ways-in-table th:nth-child(6), .ways-in-table td:nth-child(6) { display: none; }
}
</style>
