<script setup lang="ts">
// New demo org — Nick's preset, still two fields (prospect name + course).
// One submit does two things: provisions the org tree (api/admin/demo-schools)
// AND mints the govt-admin invite bound to the new root group, expiry matched
// to the org's (per DESIGN.md §"New demo org") — so both the learner join
// link and the leader invite link are ready in one click.
import { ref, computed, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'

interface CourseOption {
  course_code: string
  display_name: string
}

const emit = defineEmits<{ created: [] }>()

const { getClient, getAuthToken } = useAdminClient()

const courses = ref<CourseOption[]>([])
const prospectName = ref('')
const courseCode = ref('')
const isCreating = ref(false)
const error = ref<string | null>(null)

interface Result {
  orgName: string
  courseCode: string
  expiresAt: string
  learnerLink: string
  leaderLink: string
}
const result = ref<Result | null>(null)

const canSubmit = computed(() => !!prospectName.value.trim() && !!courseCode.value && !isCreating.value)

async function fetchCourses(): Promise<void> {
  try {
    const client = getClient()
    const { data, error: err } = await client
      .from('courses')
      .select('course_code, display_name')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')
    if (err) throw err
    courses.value = (data || []).map((c: any) => ({ course_code: c.course_code, display_name: c.display_name || c.course_code }))
  } catch (err) {
    console.warn('[DemoOrgCreateForm] course fetch failed:', err)
  }
}

async function createDemo(): Promise<void> {
  error.value = null
  result.value = null
  isCreating.value = true
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')

    const orgResp = await fetch('/api/admin/demo-schools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'create', prospectName: prospectName.value.trim(), courseCode: courseCode.value }),
    })
    const orgData = await orgResp.json().catch(() => ({}))
    if (!orgResp.ok) throw new Error(orgData.error || `Request failed: ${orgResp.status}`)
    const org = orgData.org

    const inviteResp = await fetch('/api/invite/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        code_type: 'govt_admin',
        grants_group_id: org.groupId,
        metadata: { organization_name: prospectName.value.trim() },
        expires_at: org.expiresAt,
      }),
    })
    const inviteData = await inviteResp.json().catch(() => ({}))
    if (!inviteResp.ok) throw new Error(inviteData.error || `Leader invite failed: ${inviteResp.status}`)

    result.value = {
      orgName: org.orgName,
      courseCode: org.courseCode,
      expiresAt: org.expiresAt,
      learnerLink: `${window.location.origin}/with/${org.studentJoinCode}`,
      leaderLink: `${window.location.origin}/group/${inviteData.code}`,
    }
    prospectName.value = ''
    emit('created')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create demo'
  } finally {
    isCreating.value = false
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

onMounted(fetchCourses)
</script>

<template>
  <div class="demo-org-create">
    <form class="create-form" @submit.prevent="createDemo">
      <div v-if="error" class="banner banner-error">{{ error }}</div>

      <div class="field field-wide">
        <label class="schools-kicker">Prospect / org name <span class="required">*</span></label>
        <input v-model="prospectName" type="text" class="frost-input" placeholder="e.g. Riverside Learning Trust" />
      </div>

      <div class="field">
        <label class="schools-kicker">Language pair <span class="required">*</span></label>
        <select v-model="courseCode" class="frost-select">
          <option value="" disabled>Select a course…</option>
          <option v-for="c in courses" :key="c.course_code" :value="c.course_code">{{ c.display_name }}</option>
        </select>
      </div>

      <div class="field-actions">
        <button type="submit" class="btn-primary" :disabled="!canSubmit">
          {{ isCreating ? 'Creating…' : 'Create demo' }}
        </button>
      </div>
    </form>

    <div v-if="result" class="result-panel">
      <div class="result-name">{{ result.orgName }}</div>
      <div class="result-meta">{{ result.courseCode }} · expires {{ formatDate(result.expiresAt) }}</div>
      <InviteLinkField :url="result.learnerLink" label="Learner join link" copy-label="Copy link" />
      <InviteLinkField :url="result.leaderLink" label="Leader invite link" copy-label="Copy link" />
      <p class="result-hint">Grow this into a hierarchy below — add sub-groups and get a join code for any of them.</p>
    </div>
  </div>
</template>

<style scoped>
.demo-org-create {
  display: flex;
  flex-direction: column;
}

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

.field-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.required {
  color: rgb(var(--tone-red));
  font-weight: var(--font-bold);
  font-family: var(--font-mono);
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
  padding: 10px 18px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: var(--schools-red);
  color: #fff;
  cursor: pointer;
}

.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

.result-panel {
  padding: 0 var(--space-6) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  border-top: 1px solid rgba(44, 38, 34, 0.06);
  padding-top: var(--space-5);
}
.result-name { font-family: var(--font-display); font-size: var(--text-xl); color: var(--schools-fg); }
.result-meta { font-size: var(--text-sm); color: var(--schools-fg-3); }
.result-hint { font-size: var(--text-xs); color: var(--schools-fg-3); margin: 0; }

@media (max-width: 768px) {
  .create-form { grid-template-columns: 1fr; }
}
</style>
