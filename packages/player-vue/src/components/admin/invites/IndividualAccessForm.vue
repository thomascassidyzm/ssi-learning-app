<script setup lang="ts">
// Individual access — the person-first form for "let this human in".
//
// Supersedes DirectCodeForm (the verbatim port of AdminAccess.vue's "direct"
// mode), which asked for a Label and nothing else about WHO. Everything an
// individual needs was already in entitlement_codes and POST
// /api/entitlement/create — access_type + granted_courses (which courses),
// duration_type + duration_days (for how long), max_uses (how many sign-ups
// the link is good for, enforced atomically in api/code/redeem.ts) — so this
// is a re-framing of an existing primitive, not new machinery.
//
// The difference from an organisation: individuals get NO trial. They get a
// deliberate complimentary grant, scoped by course and duration, and the
// admin says out loud how many people the link may let in.
//
// Mounted in two places, same component: the "+ Add individual" panel on
// /admin/structure (a peer of "+ Add organisation") and the create card on
// /admin/invites.
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

// WHO
const personName = ref('')
const personEmail = ref('')
// Roles beyond a learner are org-shaped (teacher / school admin / group
// leader all need a node to belong to) and stay on the organisation invite
// path. What an individual can be, platform-wide, is these three.
const role = ref<'learner' | 'ssi_admin' | 'popty_user'>('learner')
// WHAT
const accessType = ref<'full' | 'courses'>('full')
const selectedCourses = ref<Set<string>>(new Set())
// FOR HOW LONG
const durationType = ref<'lifetime' | 'time_limited'>('lifetime')
const durationDays = ref<number | ''>('')
// LIMITS — one person, one sign-up, unless the admin says otherwise.
const maxUses = ref<number | ''>(1)
const expiresAt = ref('')

const grantsRole = computed(() => role.value !== 'learner')

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
    console.warn('[IndividualAccessForm] courses fetch failed:', err)
  }
}

function reset(): void {
  personName.value = ''
  personEmail.value = ''
  role.value = 'learner'
  accessType.value = 'full'
  selectedCourses.value = new Set()
  durationType.value = 'lifetime'
  durationDays.value = ''
  maxUses.value = 1
  expiresAt.value = ''
}

async function createCode(): Promise<void> {
  if (!personName.value.trim()) {
    error.value = 'Name is required — it is how you find this grant again'
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
  if (maxUses.value !== '' && Number(maxUses.value) < 1) {
    error.value = 'Sign-ups must be at least 1'
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

    const metadata: Record<string, string> = { recipient_name: personName.value.trim() }
    if (personEmail.value.trim()) metadata.recipient_email = personEmail.value.trim()

    const body: Record<string, unknown> = {
      access_type: accessType.value,
      duration_type: durationType.value,
      label: personName.value.trim(),
      metadata,
    }
    if (accessType.value === 'courses') body.granted_courses = [...selectedCourses.value]
    if (durationType.value === 'time_limited') body.duration_days = Number(durationDays.value)
    if (maxUses.value !== '') body.max_uses = Number(maxUses.value)
    if (expiresAt.value) body.expires_at = new Date(expiresAt.value).toISOString()
    if (grantsRole.value) body.grants_platform_role = role.value

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
    reset()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create access'
    console.error('[IndividualAccessForm] create error:', err)
  } finally {
    isCreating.value = false
  }
}

onMounted(fetchCourses)
</script>

<template>
  <form class="create-form" @submit.prevent="createCode">
    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <div class="field">
      <label class="schools-kicker">Name <span class="required">*</span></label>
      <input
        v-model="personName"
        type="text"
        class="frost-input"
        placeholder="Who is this for?"
      />
    </div>

    <div class="field">
      <label class="schools-kicker">Email <span class="optional">(optional)</span></label>
      <input v-model="personEmail" type="email" class="frost-input" placeholder="name@example.com" />
    </div>

    <div class="field">
      <label class="schools-kicker">They sign in as</label>
      <select v-model="role" class="frost-select">
        <option value="learner">Learner</option>
        <option value="ssi_admin">SSi admin</option>
        <option value="popty_user">Popty user</option>
      </select>
    </div>

    <div class="field">
      <label class="schools-kicker">Access</label>
      <select v-model="accessType" class="frost-select">
        <option value="full">Every course</option>
        <option value="courses">Chosen courses only</option>
      </select>
    </div>

    <div v-if="accessType === 'courses'" class="field field-wide">
      <label class="schools-kicker">Courses</label>
      <CoursePicker v-model="selectedCourses" :courses="allCourses" />
    </div>

    <div class="field">
      <label class="schools-kicker">For how long</label>
      <select v-model="durationType" class="frost-select">
        <option value="lifetime">Forever</option>
        <option value="time_limited">A set number of days</option>
      </select>
    </div>

    <div v-if="durationType === 'time_limited'" class="field">
      <label class="schools-kicker">Days of access</label>
      <input v-model="durationDays" type="number" min="1" class="frost-input" placeholder="30" />
    </div>

    <div class="field">
      <label class="schools-kicker">Sign-ups <span class="optional">(blank = unlimited)</span></label>
      <input v-model="maxUses" type="number" min="1" class="frost-input" placeholder="Unlimited" />
    </div>

    <div class="field">
      <label class="schools-kicker">Link expires <span class="optional">(optional)</span></label>
      <input v-model="expiresAt" type="date" class="frost-input" />
    </div>

    <p class="hint field-wide">
      Individuals do not get a trial — this is a complimentary grant. The link
      stops working once it has been used
      <strong>{{ maxUses === '' ? 'any number of' : maxUses }}</strong>
      {{ Number(maxUses) === 1 ? 'time' : 'times' }}.
      <template v-if="grantsRole">
        Codes that hand out a role are always given an expiry and a use cap, even
        if you leave those blank.
      </template>
    </p>

    <div v-if="linkUrl" class="field field-wide">
      <InviteLinkField :url="linkUrl" label="Access created" copy-label="Copy link" />
    </div>

    <div class="field-actions">
      <button type="submit" class="btn-primary" :disabled="isCreating || !personName.trim()">
        <svg v-if="!isCreating" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span v-else class="spinner"></span>
        {{ isCreating ? 'Creating…' : 'Create access' }}
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

.hint {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.55;
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
