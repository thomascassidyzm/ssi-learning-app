<script setup lang="ts">
// Into an organisation — pick WHO (role) x WHERE (org-tree node) x LIMITS,
// per docs/invites-redesign/DESIGN.md. Reuse-not-duplicate for teacher /
// school-admin-join (surfaces the school's standing codes instead of
// minting a new one); demo-leaf for learner joins, restricted to demo
// nodes only (real-class learner links belong to teachers).
import { ref, computed, onMounted, watch } from 'vue'
import { useUserRole } from '@/composables/useUserRole'
import { useAdminClient } from '@/composables/useAdminClient'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'

type Who = 'leader' | 'school_admin_new' | 'school_admin_join' | 'teacher' | 'learner_demo'

interface TreeGroup {
  id: string
  name: string
  type: string
  parent_id: string | null
  is_demo?: boolean
}

interface SchoolRow {
  id: string
  school_name: string
  group_id: string | null
  teacher_join_code: string
  admin_join_code: string
}

interface TreeOption { id: string; label: string; depth: number }

const props = defineProps<{ initialWho?: string }>()
const emit = defineEmits<{ created: [] }>()

const { isSsiAdmin, isGovtAdmin } = useUserRole()
const { getClient, getAuthToken } = useAdminClient()

const groups = ref<TreeGroup[]>([])
const schools = ref<SchoolRow[]>([])
const isLoading = ref(false)
const isSubmitting = ref(false)
const error = ref<string | null>(null)

function normalizeWho(v: string | undefined): Who {
  const valid: Who[] = ['leader', 'school_admin_new', 'school_admin_join', 'teacher', 'learner_demo']
  return (valid as string[]).includes(v || '') ? (v as Who) : (isSsiAdmin.value ? 'leader' : 'school_admin_join')
}

const who = ref<Who>(normalizeWho(props.initialWho))
watch(() => props.initialWho, (v) => { who.value = normalizeWho(v) })

const whereId = ref('')
const orgName = ref('')
const expiresAt = ref('')
const maxUses = ref<number | ''>('')

// Result state
const mintedLink = ref<string | null>(null)
const standingLink = ref<{ label: string; url: string } | null>(null)

function resetResult(): void {
  mintedLink.value = null
  standingLink.value = null
  error.value = null
}

watch(who, () => { whereId.value = ''; orgName.value = ''; resetResult() })

async function fetchGroups(): Promise<void> {
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/groups', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)
    groups.value = data.groups || []
  } catch (err) {
    console.warn('[OrgInviteForm] groups fetch failed:', err)
  }
}

async function fetchSchools(): Promise<void> {
  try {
    const client = getClient()
    const { data, error: err } = await client
      .from('schools')
      .select('id, school_name, group_id, teacher_join_code, admin_join_code')
      .order('school_name')
    if (err) throw err
    schools.value = data || []
  } catch (err) {
    console.warn('[OrgInviteForm] schools fetch failed:', err)
  }
}

function flattenGroups(list: TreeGroup[]): TreeOption[] {
  const byParent = new Map<string | null, TreeGroup[]>()
  for (const g of list) {
    const key = g.parent_id
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(g)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name))
  const out: TreeOption[] = []
  function walk(parentId: string | null, depth: number): void {
    for (const g of byParent.get(parentId) || []) {
      out.push({ id: g.id, label: `${depth > 0 ? '—'.repeat(depth) + ' ' : ''}${g.name}`, depth })
      walk(g.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

function groupName(id: string | null): string {
  if (!id) return '—'
  return groups.value.find(g => g.id === id)?.name || '—'
}

// WHERE kind per WHO: 'group' (any group), 'demo-group' (demo subtree only), 'school'
const whereKind = computed<'group' | 'demo-group' | 'school'>(() => {
  if (who.value === 'leader' || who.value === 'school_admin_new') return 'group'
  if (who.value === 'learner_demo') return 'demo-group'
  return 'school'
})

const groupOptions = computed(() => flattenGroups(groups.value))
const demoGroupOptions = computed(() => flattenGroups(groups.value.filter(g => g.is_demo)))
const schoolOptions = computed(() =>
  [...schools.value]
    .sort((a, b) => a.school_name.localeCompare(b.school_name))
    .map(s => ({ id: s.id, label: `${s.school_name} — ${groupName(s.group_id)}`, depth: 0 }))
)

const whereOptions = computed<TreeOption[]>(() => {
  if (whereKind.value === 'group') return groupOptions.value
  if (whereKind.value === 'demo-group') return demoGroupOptions.value
  return schoolOptions.value
})

const whoLabel = computed(() => ({
  leader: 'Group',
  school_admin_new: 'Group (school will be created under it)',
  school_admin_join: 'School',
  teacher: 'School',
  learner_demo: 'Demo group',
}[who.value]))

const canSubmit = computed(() => {
  if (!whereId.value) return false
  if (who.value === 'school_admin_new' && !orgName.value.trim()) return false
  return true
})

const submitLabel = computed(() => {
  if (who.value === 'school_admin_join' || who.value === 'teacher') return isSubmitting.value ? 'Fetching…' : 'Get link'
  if (who.value === 'learner_demo') return isSubmitting.value ? 'Creating…' : 'Create join link'
  return isSubmitting.value ? 'Creating…' : 'Create invite'
})

async function submit(): Promise<void> {
  resetResult()
  if (!canSubmit.value) return
  isSubmitting.value = true
  try {
    if (who.value === 'leader' || who.value === 'school_admin_new') {
      const token = await getAuthToken()
      const body: Record<string, unknown> = { code_type: who.value === 'leader' ? 'govt_admin' : 'school_admin', grants_group_id: whereId.value }
      if (who.value === 'school_admin_new') body.metadata = { organization_name: orgName.value.trim() }
      if (expiresAt.value) body.expires_at = new Date(expiresAt.value).toISOString()
      if (maxUses.value !== '') body.max_uses = Number(maxUses.value)

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const resp = await fetch('/api/invite/create', { method: 'POST', headers, body: JSON.stringify(body) })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)

      const path = who.value === 'leader' ? '/group/' : '/redeem/'
      mintedLink.value = `${window.location.origin}${path}${data.code}`
      emit('created')
      orgName.value = ''
      expiresAt.value = ''
      maxUses.value = ''
    } else if (who.value === 'school_admin_join' || who.value === 'teacher') {
      const school = schools.value.find(s => s.id === whereId.value)
      if (!school) throw new Error('School not found')
      const code = who.value === 'teacher' ? school.teacher_join_code : school.admin_join_code
      standingLink.value = {
        label: who.value === 'teacher' ? 'Teacher join link (standing)' : 'School admin join link (standing)',
        url: `${window.location.origin}/redeem/${code}`,
      }
    } else {
      const token = await getAuthToken()
      if (!token) throw new Error('Not authenticated')
      const resp = await fetch('/api/admin/demo-leaf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ group_id: whereId.value }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)
      mintedLink.value = `${window.location.origin}/with/${data.student_join_code}`
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create invite'
    console.error('[OrgInviteForm] submit error:', err)
  } finally {
    isSubmitting.value = false
  }
}

onMounted(async () => {
  isLoading.value = true
  await Promise.all([fetchGroups(), fetchSchools()])
  isLoading.value = false
})
</script>

<template>
  <form class="create-form" @submit.prevent="submit">
    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <div class="field">
      <label class="schools-kicker">Who</label>
      <select v-model="who" class="frost-select">
        <option v-if="isSsiAdmin || isGovtAdmin" value="leader">Group leader</option>
        <option v-if="isSsiAdmin" value="school_admin_new">School admin — new school</option>
        <option value="school_admin_join">School admin — join existing</option>
        <option value="teacher">Teacher</option>
        <option value="learner_demo">Learner — demo node</option>
      </select>
    </div>

    <div class="field">
      <label class="schools-kicker">{{ whoLabel }} <span class="required">*</span></label>
      <select v-model="whereId" class="frost-select">
        <option value="">— Select —</option>
        <option v-for="opt in whereOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
      </select>
      <span v-if="who === 'learner_demo' && demoGroupOptions.length === 0" class="field-hint">
        No demo organisations yet — create one in "New demo org" first.
      </span>
    </div>

    <div v-if="who === 'school_admin_new'" class="field field-wide">
      <label class="schools-kicker">Organisation / school name <span class="required">*</span></label>
      <input v-model="orgName" type="text" class="frost-input" placeholder="e.g. Ysgol Bryn Coch" />
    </div>

    <template v-if="who === 'leader' || who === 'school_admin_new'">
      <div class="field">
        <label class="schools-kicker">Expires <span class="optional">(optional)</span></label>
        <input v-model="expiresAt" type="date" class="frost-input" />
      </div>
      <div class="field">
        <label class="schools-kicker">Max uses <span class="optional">(blank = unlimited)</span></label>
        <input v-model="maxUses" type="number" min="1" class="frost-input" placeholder="Unlimited" />
      </div>
    </template>

    <div v-if="mintedLink" class="field field-wide">
      <InviteLinkField :url="mintedLink" label="Invite link created" copy-label="Copy link" />
    </div>
    <div v-if="standingLink" class="field field-wide">
      <InviteLinkField :url="standingLink.url" :label="standingLink.label" copy-label="Copy link" />
    </div>

    <div class="field-actions">
      <button type="submit" class="btn-primary" :disabled="isSubmitting || !canSubmit">
        <svg v-if="!isSubmitting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span v-else class="spinner"></span>
        {{ submitLabel }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.create-form {
  padding: var(--space-5) var(--space-6) var(--space-6);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.banner {
  grid-column: 1 / -1;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-wide { grid-column: 1 / -1; }

.field-hint {
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}

.field-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.field label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.required {
  color: rgb(var(--tone-red));
  font-weight: var(--font-bold);
  font-family: var(--font-mono);
}

.optional {
  color: var(--schools-fg-3);
  font-weight: var(--font-normal);
  text-transform: none;
  letter-spacing: 0;
}

.frost-input,
.frost-select {
  font: inherit;
  font-size: var(--text-base);
  padding: 10px 14px;
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder { color: var(--schools-fg-3); }

.frost-input:focus,
.frost-select:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}

.frost-select {
  appearance: none;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8078' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px 18px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: var(--schools-red);
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-base);
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.08), 0 4px 14px rgba(194, 58, 58, 0.22);
}

.btn-primary:hover:not(:disabled) {
  background: var(--schools-red-deep);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.10), 0 8px 22px rgba(194, 58, 58, 0.28);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .create-form { grid-template-columns: 1fr; }
}
</style>
