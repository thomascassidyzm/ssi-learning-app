<script setup lang="ts">
// Email allowlist — delivery-by-email-match on the direct-access primitive.
// Ported verbatim from AdminAccess.vue: the "grant" sub-flow (one named
// person, one magic link, ssi_admin only) plus the batch allowlist panel
// (many emails, granted automatically at sign-in) — same underlying
// entitlement mechanisms, both kept exactly as they behaved there.
import { ref, computed, onMounted } from 'vue'
import { useUserRole } from '@/composables/useUserRole'
import { useAdminClient } from '@/composables/useAdminClient'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'
import CoursePicker from './CoursePicker.vue'

interface CourseOption {
  course_code: string
  display_name: string | null
  known_lang: string
  target_lang: string
}

interface EmailAccessGrant {
  id: string
  email: string
  access_type: 'full' | 'courses'
  granted_courses: string[] | null
  duration_type: 'lifetime' | 'time_limited'
  duration_days: number | null
  label: string | null
  is_active: boolean
  created_at: string
  redeemed_at: string | null
}

const emit = defineEmits<{ created: [] }>()

const { isSsiAdmin } = useUserRole()
const { getClient, getAuthToken } = useAdminClient()

const allCourses = ref<CourseOption[]>([])

// ─── One person, one magic link (ssi_admin only) ──────────────────────────
const grantEmail = ref('')
const grantName = ref('')
const grantNote = ref('')
const grantAccessType = ref<'full' | 'courses'>('full')
const grantDurationType = ref<'lifetime' | 'time_limited'>('lifetime')
const grantDurationDays = ref<number | ''>('')
const grantSelectedCourses = ref<Set<string>>(new Set())
const grantMintedLink = ref<{ code: string; email: string } | null>(null)
const isCreatingGrant = ref(false)
const grantError = ref<string | null>(null)

const isGrantEmailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(grantEmail.value.trim()))

function grantLinkUrl(code: string): string {
  return `${window.location.origin}/redeem/${code}`
}

async function createGrantCode(): Promise<void> {
  if (!isGrantEmailValid.value) {
    grantError.value = 'Enter a valid email address'
    return
  }
  if (grantAccessType.value === 'courses' && grantSelectedCourses.value.size === 0) {
    grantError.value = 'Select at least one course'
    return
  }
  if (grantDurationType.value === 'time_limited' && (!grantDurationDays.value || Number(grantDurationDays.value) < 1)) {
    grantError.value = 'Duration days must be at least 1'
    return
  }

  isCreatingGrant.value = true
  grantError.value = null
  grantMintedLink.value = null

  try {
    const token = await getAuthToken()
    if (!token) {
      grantError.value = 'Not authenticated'
      return
    }

    const email = grantEmail.value.trim().toLowerCase()
    const name = grantName.value.trim()
    const note = grantNote.value.trim()

    const body: Record<string, unknown> = {
      access_type: grantAccessType.value,
      duration_type: grantDurationType.value,
      label: `Complimentary access — ${name || email}`,
      max_uses: 1,
      metadata: {
        granted_to_email: email,
        ...(name ? { name } : {}),
        ...(note ? { note } : {}),
      },
    }
    if (grantAccessType.value === 'courses') body.granted_courses = [...grantSelectedCourses.value]
    if (grantDurationType.value === 'time_limited') body.duration_days = Number(grantDurationDays.value)

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
    grantMintedLink.value = { code: result.code, email }
    emit('created')

    grantEmail.value = ''
    grantName.value = ''
    grantNote.value = ''
    grantSelectedCourses.value = new Set()
    grantDurationDays.value = ''
    grantAccessType.value = 'full'
    grantDurationType.value = 'lifetime'
  } catch (err) {
    grantError.value = err instanceof Error ? err.message : 'Failed to grant access'
    console.error('[EmailAllowlistForm] grant create error:', err)
  } finally {
    isCreatingGrant.value = false
  }
}

// ─── Allowlist (grant by email, many at once) ─────────────────────────────
const allowlistEmails = ref('')
const allowlistLabel = ref('')
const allowlistAccessType = ref<'full' | 'courses'>('full')
const allowlistGrants = ref<EmailAccessGrant[]>([])
const isGrantingEmails = ref(false)
const allowlistResult = ref<string | null>(null)
const allowlistError = ref<string | null>(null)

const parsedAllowlistEmails = computed<string[]>(() => {
  return allowlistEmails.value
    .split(/[\n,;]+/)
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
})

async function fetchAllowlist(): Promise<void> {
  try {
    const token = await getAuthToken()
    if (!token) return
    const res = await fetch('/api/access/list-grants', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      console.warn('[EmailAllowlistForm] allowlist load failed:', res.status)
      return
    }
    const json = await res.json()
    allowlistGrants.value = json.grants || []
  } catch (err) {
    console.warn('[EmailAllowlistForm] allowlist fetch error:', err)
  }
}

async function grantEmails(): Promise<void> {
  allowlistError.value = null
  allowlistResult.value = null
  if (parsedAllowlistEmails.value.length === 0) {
    allowlistError.value = 'Enter at least one valid email'
    return
  }
  isGrantingEmails.value = true
  try {
    const token = await getAuthToken()
    if (!token) {
      allowlistError.value = 'Your admin session has expired — reload the page and sign in again, then retry.'
      return
    }
    const body: Record<string, unknown> = {
      emails: parsedAllowlistEmails.value,
      access_type: allowlistAccessType.value,
      duration_type: 'lifetime',
    }
    if (allowlistLabel.value.trim()) body.label = allowlistLabel.value.trim()

    const res = await fetch('/api/access/grant-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${res.status}`)
    }
    const result = await res.json()
    if (result.created === 0 && result.applied_now === 0) {
      allowlistError.value = 'Already granted — an active grant for that email already exists (see the list below).'
    } else {
      allowlistResult.value =
        `${result.created} grant${result.created === 1 ? '' : 's'} created` +
        (result.applied_now > 0 ? ` · ${result.applied_now} applied to existing account${result.applied_now === 1 ? '' : 's'} now` : '')
      allowlistEmails.value = ''
      allowlistLabel.value = ''
      emit('created')
    }
    await fetchAllowlist()
  } catch (err) {
    allowlistError.value = err instanceof Error ? err.message : 'Failed to grant access'
    console.error('[EmailAllowlistForm] grant emails error:', err)
  } finally {
    isGrantingEmails.value = false
  }
}

function formatGrantAccess(g: EmailAccessGrant): string {
  const access = g.access_type === 'full'
    ? 'Full'
    : (g.granted_courses?.length ? `${g.granted_courses.length} course${g.granted_courses.length > 1 ? 's' : ''}` : 'Courses')
  const duration = g.duration_type === 'lifetime' ? 'Lifetime' : (g.duration_days ? `${g.duration_days}d` : '—')
  return `${access} · ${duration}`
}

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
    console.warn('[EmailAllowlistForm] courses fetch failed:', err)
  }
}

onMounted(() => {
  fetchCourses()
  fetchAllowlist()
})
</script>

<template>
  <div class="email-allowlist">
    <!-- One person, one magic link (ssi_admin only) -->
    <form v-if="isSsiAdmin" class="create-form magic-link-form" @submit.prevent="createGrantCode">
      <div class="form-section-label">Magic link for one person</div>
      <div v-if="grantError" class="banner banner-error">{{ grantError }}</div>

      <div class="field field-wide">
        <label class="schools-kicker">Email <span class="required">*</span></label>
        <input v-model="grantEmail" type="email" class="frost-input" placeholder="learner@example.com" />
      </div>

      <div class="field">
        <label class="schools-kicker">Name <span class="optional">(optional)</span></label>
        <input v-model="grantName" type="text" class="frost-input" placeholder="e.g. Jane Doe" />
      </div>

      <div class="field">
        <label class="schools-kicker">Note <span class="optional">(optional)</span></label>
        <input v-model="grantNote" type="text" class="frost-input" placeholder="e.g. press pass, competition winner…" />
      </div>

      <div class="field">
        <label class="schools-kicker">Access</label>
        <select v-model="grantAccessType" class="frost-select">
          <option value="full">Full access (all courses)</option>
          <option value="courses">Specific courses</option>
        </select>
      </div>

      <div class="field">
        <label class="schools-kicker">Duration</label>
        <select v-model="grantDurationType" class="frost-select">
          <option value="lifetime">Lifetime</option>
          <option value="time_limited">Time-limited</option>
        </select>
      </div>

      <div v-if="grantDurationType === 'time_limited'" class="field">
        <label class="schools-kicker">Duration (days)</label>
        <input v-model="grantDurationDays" type="number" min="1" class="frost-input" placeholder="30" />
      </div>

      <div v-if="grantAccessType === 'courses'" class="field field-wide">
        <label class="schools-kicker">Courses</label>
        <CoursePicker v-model="grantSelectedCourses" :courses="allCourses" />
      </div>

      <div v-if="grantMintedLink" class="field field-wide">
        <InviteLinkField
          :url="grantLinkUrl(grantMintedLink.code)"
          :label="`Magic link for ${grantMintedLink.email}`"
          copy-label="Copy magic link"
        />
      </div>

      <div class="field-actions">
        <button type="submit" class="btn-primary" :disabled="isCreatingGrant || !isGrantEmailValid">
          <svg v-if="!isCreatingGrant" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span v-else class="spinner"></span>
          {{ isCreatingGrant ? 'Creating…' : 'Create magic link' }}
        </button>
      </div>
    </form>

    <!-- Allowlist — many emails, granted automatically at sign-in -->
    <div class="allowlist-block">
      <div class="form-section-label">Allowlist — grant access by email</div>

      <Transition name="fade">
        <div v-if="allowlistResult" class="banner banner-success">{{ allowlistResult }}</div>
      </Transition>
      <Transition name="fade">
        <div v-if="allowlistError" class="banner banner-error">{{ allowlistError }}</div>
      </Transition>

      <form class="allowlist-form" @submit.prevent="grantEmails">
        <p class="allowlist-hint">
          Paste emails (one per line, or comma-separated). Those users get free
          access automatically when they sign in — no code to type. Already
          signed-up waiting users are granted immediately.
        </p>

        <div class="field field-wide">
          <label class="schools-kicker">Emails</label>
          <textarea
            v-model="allowlistEmails"
            class="frost-input allowlist-textarea"
            rows="5"
            placeholder="alice@example.com&#10;bob@example.com, carol@example.com"
          ></textarea>
          <span v-if="parsedAllowlistEmails.length" class="allowlist-count">
            {{ parsedAllowlistEmails.length }} valid email{{ parsedAllowlistEmails.length > 1 ? 's' : '' }}
          </span>
        </div>

        <div class="allowlist-row">
          <div class="field">
            <label class="schools-kicker">Access</label>
            <select v-model="allowlistAccessType" class="frost-select">
              <option value="full">Full / Lifetime (default)</option>
              <option value="courses" disabled>Specific courses — use a code for now</option>
            </select>
          </div>

          <div class="field">
            <label class="schools-kicker">Label <span class="optional">(optional)</span></label>
            <input v-model="allowlistLabel" type="text" class="frost-input" placeholder="e.g. Surrey pilot waitlist" />
          </div>
        </div>

        <div class="field-actions">
          <button type="submit" class="btn-primary" :disabled="isGrantingEmails || parsedAllowlistEmails.length === 0">
            <svg v-if="!isGrantingEmails" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span v-else class="spinner"></span>
            {{ isGrantingEmails ? 'Granting…' : 'Grant access' }}
          </button>
        </div>
      </form>

      <div v-if="allowlistGrants.length" class="allowlist-list">
        <table class="codes-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Access</th>
              <th>Label</th>
              <th>Claimed</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in allowlistGrants" :key="g.id" :class="{ 'is-inactive': !g.is_active }">
              <td class="cell-org">{{ g.email }}</td>
              <td class="cell-muted">{{ formatGrantAccess(g) }}</td>
              <td class="cell-muted">{{ g.label || '—' }}</td>
              <td>
                <span class="status-pill" :class="g.redeemed_at ? 'tone-green' : 'tone-muted'">
                  <span class="status-dot"></span>
                  {{ g.redeemed_at ? 'Claimed' : 'Pending' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.email-allowlist {
  display: flex;
  flex-direction: column;
}

.form-section-label {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
  padding: var(--space-4) var(--space-6) 0;
}

.magic-link-form {
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
  padding-bottom: var(--space-2);
}

.create-form {
  padding: var(--space-3) var(--space-6) var(--space-5);
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

.banner-success {
  background: rgba(var(--tone-green), 0.10);
  border: 1px solid rgba(var(--tone-green), 0.28);
  color: rgb(var(--tone-green-ink));
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

.allowlist-block {
  padding-bottom: var(--space-2);
}

.allowlist-form {
  padding: var(--space-3) var(--space-6) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.allowlist-hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--schools-fg-2, #6b6258);
  max-width: 64ch;
}

.allowlist-textarea {
  resize: vertical;
  min-height: 96px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.allowlist-count {
  font-size: var(--text-xs);
  color: rgb(var(--tone-green-ink));
  font-weight: var(--font-medium);
}

.allowlist-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.allowlist-list {
  border-top: 1px solid rgba(44, 38, 34, 0.06);
  padding: 0 var(--space-2);
}

.codes-table {
  width: 100%;
  border-collapse: collapse;
}

.codes-table thead th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: left;
  color: var(--schools-fg-3);
  padding: 14px 16px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
}

.codes-table td {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--schools-fg-2);
  font-size: var(--text-sm);
}

.codes-table tbody tr.is-inactive { opacity: 0.5; }

.cell-org {
  color: var(--schools-fg);
  font-weight: var(--font-medium);
}

.cell-muted {
  color: var(--schools-fg-3);
  white-space: nowrap;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 768px) {
  .create-form { grid-template-columns: 1fr; }
  .allowlist-row { grid-template-columns: 1fr; }
}
</style>
