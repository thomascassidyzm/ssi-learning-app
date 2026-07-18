<script setup lang="ts">
// Direct access code — ported from AdminAccess.vue's "direct" mode verbatim
// (label, full|courses access, duration, limits -> POST /api/entitlement/create).
import { ref, computed, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'
import CoursePicker from './CoursePicker.vue'

interface CourseOption {
  course_code: string
  display_name: string | null
  known_lang: string
  target_lang: string
}

const emit = defineEmits<{ created: [] }>()

const { getClient, getAuthToken } = useAdminClient()

const allCourses = ref<CourseOption[]>([])
const isCreating = ref(false)
const error = ref<string | null>(null)
const mintedCode = ref<string | null>(null)

const label = ref('')
const accessType = ref<'full' | 'courses'>('full')
const durationType = ref<'lifetime' | 'time_limited'>('lifetime')
const durationDays = ref<number | ''>('')
const selectedCourses = ref<Set<string>>(new Set())
const expiresAt = ref('')
const maxUses = ref<number | ''>('')

const linkUrl = computed(() => mintedCode.value ? `${window.location.origin}/redeem/${mintedCode.value}` : '')

async function fetchCourses(): Promise<void> {
  try {
    const client = getClient()
    const { data, error: err } = await client
      .from('courses')
      .select('course_code, display_name, known_lang, target_lang')
      .order('display_name')
    if (err) throw err
    allCourses.value = data || []
  } catch (err) {
    console.warn('[DirectCodeForm] courses fetch failed:', err)
  }
}

async function createCode(): Promise<void> {
  if (!label.value.trim()) {
    error.value = 'Label is required'
    return
  }
  if (accessType.value === 'courses' && selectedCourses.value.size === 0) {
    error.value = 'Select at least one course'
    return
  }
  if (durationType.value === 'time_limited' && (!durationDays.value || Number(durationDays.value) < 1)) {
    error.value = 'Duration days must be at least 1'
    return
  }

  isCreating.value = true
  error.value = null
  mintedCode.value = null

  try {
    const token = await getAuthToken()
    if (!token) {
      error.value = 'Not authenticated'
      return
    }

    const body: Record<string, unknown> = {
      access_type: accessType.value,
      duration_type: durationType.value,
      label: label.value.trim(),
    }
    if (accessType.value === 'courses') body.granted_courses = [...selectedCourses.value]
    if (durationType.value === 'time_limited') body.duration_days = Number(durationDays.value)
    if (maxUses.value !== '') body.max_uses = Number(maxUses.value)
    if (expiresAt.value) body.expires_at = new Date(expiresAt.value).toISOString()

    const response = await fetch('/api/entitlement/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }

    const result = await response.json()
    mintedCode.value = result.code
    emit('created')

    label.value = ''
    selectedCourses.value = new Set()
    durationDays.value = ''
    accessType.value = 'full'
    durationType.value = 'lifetime'
    expiresAt.value = ''
    maxUses.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create code'
    console.error('[DirectCodeForm] create error:', err)
  } finally {
    isCreating.value = false
  }
}

onMounted(fetchCourses)
</script>

<template>
  <form class="create-form" @submit.prevent="createCode">
    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <div class="field field-wide">
      <label class="schools-kicker">Label <span class="required">*</span></label>
      <input
        v-model="label"
        type="text"
        class="frost-input"
        placeholder="e.g. Welsh Govt 2026, Press Pass…"
      />
    </div>

    <div class="field">
      <label class="schools-kicker">Access</label>
      <select v-model="accessType" class="frost-select">
        <option value="full">Full access (all courses)</option>
        <option value="courses">Specific courses</option>
      </select>
    </div>

    <div class="field">
      <label class="schools-kicker">Duration</label>
      <select v-model="durationType" class="frost-select">
        <option value="lifetime">Lifetime</option>
        <option value="time_limited">Time-limited</option>
      </select>
    </div>

    <div v-if="durationType === 'time_limited'" class="field">
      <label class="schools-kicker">Duration (days)</label>
      <input v-model="durationDays" type="number" min="1" class="frost-input" placeholder="30" />
    </div>

    <div v-if="accessType === 'courses'" class="field field-wide">
      <label class="schools-kicker">Courses</label>
      <CoursePicker v-model="selectedCourses" :courses="allCourses" />
    </div>

    <div class="field">
      <label class="schools-kicker">Expires <span class="optional">(optional)</span></label>
      <input v-model="expiresAt" type="date" class="frost-input" />
    </div>

    <div class="field">
      <label class="schools-kicker">Max uses <span class="optional">(blank = unlimited)</span></label>
      <input v-model="maxUses" type="number" min="1" class="frost-input" placeholder="Unlimited" />
    </div>

    <div v-if="linkUrl" class="field field-wide">
      <InviteLinkField :url="linkUrl" label="Code created" copy-label="Copy link" />
    </div>

    <div class="field-actions">
      <button type="submit" class="btn-primary" :disabled="isCreating || !label.trim()">
        <svg v-if="!isCreating" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span v-else class="spinner"></span>
        {{ isCreating ? 'Creating…' : 'Create code' }}
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
