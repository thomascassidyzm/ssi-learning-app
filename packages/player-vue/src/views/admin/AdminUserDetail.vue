<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminUserDetail } from '@/composables/admin/useAdminUserDetail'
import { parseCourseCode, getBeltForSeeds, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

const { getClient, getAuthToken } = useAdminClient()
const route = useRoute()
const router = useRouter()
const {
  profile,
  enrollments,
  sessions,
  userEntitlements,
  isLoading,
  error,
  roleUpdateStatus,
  fetchUserDetail,
  updateUserRole,
  grantEntitlement,
  revokeEntitlement,
  getCourseProgress,
} = useAdminUserDetail(getClient())

const showGrantForm = ref(false)
const grantAccessType = ref('full')
const grantDurationType = ref('lifetime')
const grantDurationDays = ref(365)
const grantCourses = ref<string[]>([])
const grantLoading = ref(false)

onMounted(() => {
  const learnerId = route.params.learnerId as string
  if (learnerId) {
    fetchUserDetail(learnerId)
  }
})

function goBack() {
  router.push('/admin/users')
}

function getUserInitials(name: string | undefined): string {
  if (!name) return '??'
  return name.substring(0, 2).toUpperCase()
}

type Tone = 'blue' | 'gold' | 'red' | 'green'

function beltTone(beltName: string): Tone | undefined {
  switch (beltName) {
    case 'yellow': return 'gold'
    case 'orange': return 'red'
    case 'green': return 'green'
    case 'blue': return 'blue'
    case 'purple': return 'blue'
    case 'brown': return 'gold'
    case 'black': return 'gold'
    default: return undefined
  }
}

function handlePlatformRoleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value || null
  if (profile.value) {
    updateUserRole(profile.value.id, 'platform_role', value)
  }
}

function handleEducationalRoleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value || null
  if (profile.value) {
    updateUserRole(profile.value.id, 'educational_role', value)
  }
}

async function handleGrant() {
  if (!profile.value) return
  grantLoading.value = true
  const success = await grantEntitlement(
    profile.value.id,
    {
      access_type: grantAccessType.value,
      granted_courses: grantAccessType.value === 'courses' ? grantCourses.value : undefined,
      duration_type: grantDurationType.value,
      duration_days: grantDurationType.value === 'time_limited' ? grantDurationDays.value : undefined,
    },
    getAuthToken
  )
  grantLoading.value = false
  if (success) {
    showGrantForm.value = false
    grantAccessType.value = 'full'
    grantDurationType.value = 'lifetime'
    grantCourses.value = []
  }
}

async function handleRevoke(entitlementId: string) {
  if (!profile.value || !confirm('Revoke this entitlement?')) return
  await revokeEntitlement(profile.value.id, entitlementId, getAuthToken)
}
</script>

<template>
  <div class="admin-user-detail">
    <!-- Breadcrumb -->
    <nav class="breadcrumb">
      <button class="breadcrumb-link" @click="goBack">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Users
      </button>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">{{ profile?.display_name || 'Loading…' }}</span>
      <button
        v-if="profile"
        class="breadcrumb-action"
        @click="$router.push(`/admin/users/${$route.params.learnerId}/progress`)"
        title="Open the learner's own progress dashboard"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        Learner dashboard
      </button>
    </nav>

    <!-- Error -->
    <div v-if="error" class="banner banner-error">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading user detail…</div>

    <template v-else-if="profile">
      <!-- Profile panel -->
      <FrostCard variant="panel" class="profile-panel">
        <div class="profile-layout">
          <div class="profile-avatar">
            {{ getUserInitials(profile.display_name) }}
          </div>
          <div class="profile-info">
            <div class="profile-header">
              <div class="profile-id-block">
                <h2 class="profile-name frost-display">
                  {{ profile.display_name || 'Anonymous' }}
                </h2>
                <div v-if="profile.emails.length > 0" class="profile-emails">
                  <div
                    v-for="email in profile.emails"
                    :key="email"
                    class="profile-email-row"
                  >
                    <span class="profile-email-text frost-mono-nums">{{ email }}</span>
                    <span v-if="email === profile.primary_email" class="email-primary-pill">primary</span>
                  </div>
                </div>
                <div class="profile-meta">
                  <span>Joined {{ new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }}</span>
                  <span class="meta-dot"></span>
                  <span class="profile-uid frost-mono-nums">{{ profile.user_id }}</span>
                </div>
              </div>
              <div class="profile-badges">
                <Badge v-if="profile.platform_role === 'ssi_admin'" variant="ssi-red" pill>Admin</Badge>
                <Badge v-if="profile.educational_role === 'god'" variant="ssi-gold" pill>God</Badge>
                <Badge
                  v-if="profile.educational_role && profile.educational_role !== 'god'"
                  variant="info"
                  pill
                >
                  {{ profile.educational_role }}
                </Badge>
              </div>
            </div>

            <!-- Role editor -->
            <div class="role-editor">
              <div class="role-field">
                <label class="frost-eyebrow">Platform role</label>
                <select
                  class="frost-select"
                  :value="profile.platform_role || ''"
                  @change="handlePlatformRoleChange"
                >
                  <option value="">None</option>
                  <option value="ssi_admin">ssi_admin</option>
                </select>
              </div>
              <div class="role-field">
                <label class="frost-eyebrow">Educational role</label>
                <select
                  class="frost-select"
                  :value="profile.educational_role || ''"
                  @change="handleEducationalRoleChange"
                >
                  <option value="">None</option>
                  <option value="god">god</option>
                  <option value="govt_admin">govt_admin</option>
                  <option value="school_admin">school_admin</option>
                  <option value="teacher">teacher</option>
                  <option value="student">student</option>
                </select>
              </div>
              <span
                v-if="roleUpdateStatus === 'saved'"
                class="role-status role-saved"
              >Saved</span>
              <span
                v-if="roleUpdateStatus === 'error'"
                class="role-status role-error"
              >Failed</span>
            </div>
          </div>
        </div>
      </FrostCard>

      <!-- Entitlements section -->
      <section class="section">
        <div class="section-head">
          <h3 class="section-title frost-display">
            Entitlements
            <span class="title-count frost-mono-nums">{{ userEntitlements.length }}</span>
          </h3>
          <button class="btn-ghost" @click="showGrantForm = !showGrantForm">
            {{ showGrantForm ? 'Cancel' : '+ Grant' }}
          </button>
        </div>

        <!-- Grant form (inline FrostCard panel) -->
        <Transition name="reveal">
          <FrostCard v-if="showGrantForm" variant="panel" class="grant-panel">
            <div class="panel-head">
              <span class="frost-eyebrow">Grant entitlement</span>
            </div>
            <div class="grant-form">
              <div class="grant-row">
                <div class="grant-field">
                  <label class="frost-eyebrow">Access</label>
                  <select v-model="grantAccessType" class="frost-select">
                    <option value="full">Full · all courses</option>
                    <option value="courses">Specific courses</option>
                  </select>
                </div>
                <div class="grant-field">
                  <label class="frost-eyebrow">Duration</label>
                  <select v-model="grantDurationType" class="frost-select">
                    <option value="lifetime">Lifetime</option>
                    <option value="time_limited">Time limited</option>
                  </select>
                </div>
                <div v-if="grantDurationType === 'time_limited'" class="grant-field grant-field-narrow">
                  <label class="frost-eyebrow">Days</label>
                  <input
                    v-model.number="grantDurationDays"
                    type="number"
                    min="1"
                    class="frost-input"
                  />
                </div>
              </div>
              <div v-if="grantAccessType === 'courses'" class="grant-field">
                <label class="frost-eyebrow">Course codes <span class="optional">(comma-separated)</span></label>
                <input
                  class="frost-input"
                  placeholder="e.g. spa_for_eng, fra_for_eng"
                  @input="grantCourses = ($event.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)"
                />
              </div>
              <div class="field-actions">
                <button class="btn-primary" :disabled="grantLoading" @click="handleGrant">
                  {{ grantLoading ? 'Granting…' : 'Grant entitlement' }}
                </button>
              </div>
            </div>
          </FrostCard>
        </Transition>

        <!-- Entitlements list -->
        <FrostCard
          v-if="userEntitlements.length > 0"
          variant="panel"
          class="list-panel"
        >
          <table class="list-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Access</th>
                <th>Courses</th>
                <th>Expires</th>
                <th>Granted</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ent in userEntitlements" :key="ent.id">
                <td class="cell-strong">{{ ent.label }}</td>
                <td>
                  <span
                    class="access-pill"
                    :class="ent.access_type === 'full' ? 'tone-green' : 'tone-blue'"
                  >
                    {{ ent.access_type }}
                  </span>
                </td>
                <td class="cell-muted">
                  {{ ent.granted_courses ? ent.granted_courses.join(', ') : 'All' }}
                </td>
                <td class="cell-muted frost-mono-nums">
                  {{ ent.expires_at ? new Date(ent.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Never' }}
                </td>
                <td class="cell-muted">{{ timeAgo(ent.redeemed_at) }}</td>
                <td class="cell-actions">
                  <button class="row-action is-danger" title="Revoke" @click="handleRevoke(ent.id)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </FrostCard>
        <FrostCard v-else variant="tile" class="ent-empty">
          <span>No active entitlements.</span>
        </FrostCard>
      </section>

      <!-- Course progress -->
      <section v-if="enrollments.length > 0" class="section">
        <h3 class="section-title frost-display">
          Courses
          <span class="title-count frost-mono-nums">{{ enrollments.length }}</span>
        </h3>
        <div class="course-grid">
          <FrostCard
            v-for="enrollment in enrollments"
            :key="enrollment.course_id"
            variant="tile"
            :tone="beltTone(getBeltForSeeds(getCourseProgress(enrollment.course_id).seeds_introduced).name)"
            :hoverable="true"
            class="course-tile"
          >
            <div class="course-inner">
              <div class="course-header">
                <span class="course-name">{{ parseCourseCode(enrollment.course_id).label }}</span>
                <Badge
                  :belt="getBeltForSeeds(getCourseProgress(enrollment.course_id).seeds_introduced).name as any"
                  size="sm"
                  pill
                >
                  {{ getBeltForSeeds(getCourseProgress(enrollment.course_id).seeds_introduced).name }}
                </Badge>
              </div>
              <div class="course-stats">
                <div class="course-stat">
                  <span class="stat-value frost-mono-nums">{{ getCourseProgress(enrollment.course_id).seeds_introduced }}</span>
                  <span class="stat-label">Seeds</span>
                </div>
                <div class="course-stat">
                  <span class="stat-value frost-mono-nums">{{ getCourseProgress(enrollment.course_id).legos_seen }}</span>
                  <span class="stat-label">LEGOs</span>
                </div>
                <div class="course-stat">
                  <span class="stat-value frost-mono-nums">{{ getCourseProgress(enrollment.course_id).legos_retired }}</span>
                  <span class="stat-label">Retired</span>
                </div>
                <div class="course-stat">
                  <span class="stat-value frost-mono-nums">{{ formatDuration(enrollment.total_practice_minutes || 0) }}</span>
                  <span class="stat-label">Practice</span>
                </div>
              </div>
              <div class="course-foot">
                Last active
                <span class="course-active-time frost-mono-nums">
                  {{ enrollment.last_practiced_at ? timeAgo(enrollment.last_practiced_at) : 'never' }}
                </span>
              </div>
            </div>
          </FrostCard>
        </div>
      </section>

      <!-- Sessions -->
      <section class="section">
        <h3 class="section-title frost-display">
          Recent sessions
          <span class="title-count frost-mono-nums">{{ sessions.length }}</span>
        </h3>
        <FrostCard
          v-if="sessions.length > 0"
          variant="panel"
          class="list-panel"
        >
          <table class="list-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Course</th>
                <th>Duration</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in sessions" :key="session.id">
                <td class="cell-muted frost-mono-nums">
                  {{ new Date(session.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}
                </td>
                <td>
                  <Badge variant="default" size="sm" pill>
                    {{ parseCourseCode(session.course_id).label }}
                  </Badge>
                </td>
                <td class="cell-muted frost-mono-nums">
                  {{ session.duration_seconds ? formatDuration(session.duration_seconds / 60) : '—' }}
                </td>
                <td class="cell-muted frost-mono-nums">{{ session.items_practiced || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </FrostCard>
        <FrostCard v-else variant="tile" class="ent-empty">
          <span>No sessions recorded.</span>
        </FrostCard>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin-user-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* ---------- Breadcrumb ---------- */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.breadcrumb-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.1);
  color: var(--ink-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  padding: 6px 12px;
  border-radius: var(--radius-full);
  transition: all var(--transition-base);
}

.breadcrumb-link:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.18);
  color: var(--ink-primary);
}

.breadcrumb-sep {
  color: var(--ink-faint);
}

.breadcrumb-current {
  color: var(--ink-primary);
  font-weight: var(--font-medium);
}

.breadcrumb-action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.1);
  border-radius: var(--radius-full);
  color: var(--ink-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  transition: all var(--transition-base);
}

.breadcrumb-action:hover {
  color: rgb(var(--tone-blue));
  border-color: rgba(var(--tone-blue), 0.45);
  background: rgba(var(--tone-blue), 0.10);
}

/* ---------- Banners ---------- */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

.loading {
  text-align: center;
  padding: var(--space-12);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* ---------- Profile panel ---------- */
.profile-panel {
  padding: var(--space-6);
}

.profile-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
}

.profile-avatar {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-lg);
  color: #fff;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  letter-spacing: 0.02em;
}

.profile-info {
  flex: 1;
  min-width: 0;
}

.profile-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
}

.profile-name {
  font-size: var(--text-2xl);
  margin: 0 0 4px;
  letter-spacing: -0.015em;
  color: var(--ink-primary);
}

.profile-emails {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 8px;
}

.profile-email-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.profile-email-text {
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  word-break: break-all;
}

.email-primary-pill {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: var(--font-medium);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.12);
  border: 1px solid rgba(var(--tone-green), 0.30);
  padding: 1px 7px;
  border-radius: var(--radius-full);
}

.profile-meta {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--ink-faint);
}

.profile-uid {
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  opacity: 0.8;
}

.profile-badges {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* Role editor */
.role-editor {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}

.role-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.role-status {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 4px 10px;
  border-radius: var(--radius-full);
}

.role-saved {
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.14);
}

.role-error {
  color: rgb(var(--tone-red));
  background: rgba(var(--tone-red), 0.14);
}

/* ---------- Section ---------- */
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  margin: 0;
  color: var(--ink-primary);
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.title-count {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--ink-muted);
}

/* ---------- Form controls (shared) ---------- */
.frost-input,
.frost-select {
  font: inherit;
  font-size: var(--text-base);
  padding: 9px 14px;
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder {
  color: var(--ink-faint);
}

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

.optional {
  color: var(--ink-faint);
  font-weight: var(--font-normal);
  text-transform: none;
  letter-spacing: 0;
}

/* ---------- Buttons ---------- */
.btn-primary,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 16px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-base);
}

.btn-primary {
  background: var(--ssi-red);
  color: #fff;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.08), 0 4px 14px rgba(194, 58, 58, 0.22);
}

.btn-primary:hover:not(:disabled) {
  background: var(--ssi-red-light);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.10), 0 8px 22px rgba(194, 58, 58, 0.28);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.55);
  color: var(--ink-secondary);
  border-color: rgba(44, 38, 34, 0.1);
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.18);
  color: var(--ink-primary);
}

/* ---------- Grant panel ---------- */
.grant-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.grant-form {
  padding: var(--space-5) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.grant-row {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.grant-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 180px;
}

.grant-field-narrow {
  flex: 0 0 100px;
  min-width: 100px;
}

.field-actions {
  display: flex;
  justify-content: flex-end;
}

.reveal-enter-active,
.reveal-leave-active {
  transition: all 240ms var(--ease-out-expo);
  overflow: hidden;
}

.reveal-enter-from,
.reveal-leave-to {
  opacity: 0;
  transform: translateY(-6px);
  max-height: 0;
}

.reveal-enter-to,
.reveal-leave-from {
  opacity: 1;
  max-height: 480px;
}

/* ---------- List panel + table ---------- */
.list-panel {
  padding: 0;
  overflow: hidden;
}

.list-table {
  width: 100%;
  border-collapse: collapse;
}

.list-table thead th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-muted);
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  background: rgba(255, 255, 255, 0.35);
}

.list-table thead th:last-child {
  width: 56px;
}

.list-table tbody tr {
  transition: background var(--transition-base);
}

.list-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.48);
}

.list-table td {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.list-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-strong {
  color: var(--ink-primary);
  font-weight: var(--font-medium);
}

.cell-muted {
  color: var(--ink-muted);
  white-space: nowrap;
}

.access-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.access-pill.tone-green {
  background: rgba(var(--tone-green), 0.14);
  border-color: rgba(var(--tone-green), 0.36);
  color: rgb(var(--tone-green));
}

.access-pill.tone-blue {
  background: rgba(var(--tone-blue), 0.14);
  border-color: rgba(var(--tone-blue), 0.32);
  color: rgb(var(--tone-blue));
}

.cell-actions {
  text-align: right;
  padding-right: 12px;
}

.row-action {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--ink-muted);
  cursor: pointer;
  opacity: 0;
  transform: translateX(4px);
  transition: all var(--transition-fast);
}

.list-table tbody tr:hover .row-action,
.list-table tbody tr:focus-within .row-action {
  opacity: 1;
  transform: translateX(0);
}

.row-action:hover {
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(44, 38, 34, 0.1);
}

.row-action.is-danger:hover {
  color: rgb(var(--tone-red));
  background: rgba(var(--tone-red), 0.10);
  border-color: rgba(var(--tone-red), 0.32);
}

/* Inline empty (smaller than canon §5.5 for nested sections) */
.ent-empty {
  padding: var(--space-6) var(--space-8);
  text-align: center;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* ---------- Course tiles ---------- */
.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

.course-tile {
  padding: 0;
}

.course-inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
}

.course-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}

.course-name {
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--ink-primary);
  letter-spacing: -0.005em;
}

.course-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  padding: var(--space-3) 0;
  border-top: 1px solid rgba(44, 38, 34, 0.08);
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
}

.course-stat {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-value {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: var(--ink-primary);
  line-height: 1;
  letter-spacing: -0.025em;
}

.stat-label {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.course-foot {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.course-active-time {
  color: var(--ink-secondary);
  font-weight: var(--font-medium);
}

/* ---------- Responsive ---------- */
@media (max-width: 768px) {
  .profile-layout {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .profile-header {
    flex-direction: column;
    align-items: center;
  }
  .profile-meta {
    justify-content: center;
  }
  .profile-badges {
    justify-content: center;
  }
  .role-editor {
    flex-wrap: wrap;
    justify-content: center;
  }
  .course-stats {
    grid-template-columns: repeat(2, 1fr);
  }
  .grant-row {
    flex-direction: column;
  }
  .breadcrumb-action {
    margin-left: 0;
  }
}
</style>
