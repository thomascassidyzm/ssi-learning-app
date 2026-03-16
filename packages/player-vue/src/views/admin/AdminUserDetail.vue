<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminUserDetail } from '@/composables/admin/useAdminUserDetail'
import { parseCourseCode, getBeltForSeeds, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'
import Card from '@/components/schools/shared/Card.vue'

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

// Grant form state
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

function getBeltAccent(beltName: string): 'red' | 'gold' | 'green' | 'blue' | 'gradient' {
  switch (beltName) {
    case 'white': return 'gradient'
    case 'yellow': return 'gold'
    case 'orange': return 'red'
    case 'green': return 'green'
    case 'blue': return 'blue'
    case 'brown': return 'red'
    case 'black': return 'gradient'
    default: return 'gradient'
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
    <nav class="breadcrumb animate-in">
      <button class="breadcrumb-link" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Users
      </button>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-current">{{ profile?.display_name || 'Loading...' }}</span>
    </nav>

    <!-- Error -->
    <div v-if="error" class="error-banner animate-in delay-1">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading-state animate-in delay-1">
      Loading user detail...
    </div>

    <template v-else-if="profile">
      <!-- Profile card -->
      <Card accent="gradient" class="animate-in delay-1">
        <div class="profile-layout">
          <div class="profile-avatar">
            {{ getUserInitials(profile.display_name) }}
          </div>
          <div class="profile-info">
            <div class="profile-header">
              <div>
                <h2 class="profile-name">{{ profile.display_name || 'Anonymous' }}</h2>
                <div class="profile-meta">
                  <span>Joined {{ new Date(profile.created_at).toLocaleDateString() }}</span>
                  <span class="meta-dot"></span>
                  <span class="profile-id">{{ profile.user_id }}</span>
                </div>
              </div>
              <div class="profile-badges">
                <Badge v-if="profile.platform_role === 'ssi_admin'" variant="ssi-red" pill>Admin</Badge>
                <Badge v-if="profile.educational_role === 'god'" variant="ssi-gold" pill>God</Badge>
                <Badge v-if="profile.educational_role && profile.educational_role !== 'god'" variant="info" pill>
                  {{ profile.educational_role }}
                </Badge>
              </div>
            </div>

            <!-- Role editing -->
            <div class="role-editor">
              <div class="role-field">
                <label class="role-label">Platform Role</label>
                <select
                  class="role-select"
                  :value="profile.platform_role || ''"
                  @change="handlePlatformRoleChange"
                >
                  <option value="">None</option>
                  <option value="ssi_admin">ssi_admin</option>
                </select>
              </div>
              <div class="role-field">
                <label class="role-label">Educational Role</label>
                <select
                  class="role-select"
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
              <span v-if="roleUpdateStatus === 'saved'" class="role-status role-saved">Saved</span>
              <span v-if="roleUpdateStatus === 'error'" class="role-status role-error">Failed</span>
            </div>
          </div>
        </div>
      </Card>

      <!-- Entitlements -->
      <section class="section animate-in delay-2">
        <div class="section-header">
          <h3 class="section-title">Entitlements ({{ userEntitlements.length }})</h3>
          <button class="btn-small" @click="showGrantForm = !showGrantForm">
            {{ showGrantForm ? 'Cancel' : '+ Grant' }}
          </button>
        </div>

        <!-- Grant form -->
        <Card v-if="showGrantForm" accent="gold">
          <div class="grant-form">
            <div class="grant-row">
              <div class="grant-field">
                <label class="grant-label">Access</label>
                <select v-model="grantAccessType" class="role-select">
                  <option value="full">Full (all courses)</option>
                  <option value="courses">Specific courses</option>
                </select>
              </div>
              <div class="grant-field">
                <label class="grant-label">Duration</label>
                <select v-model="grantDurationType" class="role-select">
                  <option value="lifetime">Lifetime</option>
                  <option value="time_limited">Time limited</option>
                </select>
              </div>
              <div v-if="grantDurationType === 'time_limited'" class="grant-field">
                <label class="grant-label">Days</label>
                <input v-model.number="grantDurationDays" type="number" min="1" class="grant-input" />
              </div>
            </div>
            <div v-if="grantAccessType === 'courses'" class="grant-field">
              <label class="grant-label">Course codes (comma-separated)</label>
              <input
                class="grant-input grant-input-wide"
                placeholder="e.g. spa_for_eng, fra_for_eng"
                @input="grantCourses = ($event.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)"
              />
            </div>
            <button class="btn-grant" :disabled="grantLoading" @click="handleGrant">
              {{ grantLoading ? 'Granting...' : 'Grant Entitlement' }}
            </button>
          </div>
        </Card>

        <!-- Entitlements list -->
        <Card v-if="userEntitlements.length > 0">
          <div class="table-container">
            <table class="sessions-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Access</th>
                  <th>Courses</th>
                  <th>Expires</th>
                  <th>Granted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="ent in userEntitlements" :key="ent.id">
                  <td>{{ ent.label }}</td>
                  <td>
                    <Badge :variant="ent.access_type === 'full' ? 'green' : 'info'" size="sm" pill>
                      {{ ent.access_type }}
                    </Badge>
                  </td>
                  <td class="text-muted">
                    {{ ent.granted_courses ? ent.granted_courses.join(', ') : 'All' }}
                  </td>
                  <td class="text-muted">
                    {{ ent.expires_at ? new Date(ent.expires_at).toLocaleDateString() : 'Never' }}
                  </td>
                  <td class="text-muted">{{ timeAgo(ent.redeemed_at) }}</td>
                  <td>
                    <button class="btn-revoke" @click="handleRevoke(ent.id)">Revoke</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card v-else>
          <div class="empty-state">No active entitlements.</div>
        </Card>
      </section>

      <!-- Course progress cards -->
      <section v-if="enrollments.length > 0" class="section animate-in delay-3">
        <h3 class="section-title">Courses ({{ enrollments.length }})</h3>
        <div class="course-cards">
          <Card
            v-for="enrollment in enrollments"
            :key="enrollment.course_id"
            :accent="getBeltAccent(getBeltForSeeds(getCourseProgress(enrollment.course_id).seeds_introduced).name)"
            hoverable
            class="course-card"
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
                  <span class="course-stat-value">{{ getCourseProgress(enrollment.course_id).seeds_introduced }}</span>
                  <span class="course-stat-label">Seeds</span>
                </div>
                <div class="course-stat">
                  <span class="course-stat-value">{{ getCourseProgress(enrollment.course_id).legos_seen }}</span>
                  <span class="course-stat-label">LEGOs seen</span>
                </div>
                <div class="course-stat">
                  <span class="course-stat-value">{{ getCourseProgress(enrollment.course_id).legos_retired }}</span>
                  <span class="course-stat-label">Retired</span>
                </div>
                <div class="course-stat">
                  <span class="course-stat-value">{{ formatDuration(enrollment.total_practice_minutes || 0) }}</span>
                  <span class="course-stat-label">Practice</span>
                </div>
              </div>
              <div class="course-footer">
                <span class="course-last-active">
                  Last active: {{ enrollment.last_practiced_at ? timeAgo(enrollment.last_practiced_at) : 'never' }}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <!-- Session history -->
      <section class="section animate-in delay-4">
        <Card title="Recent Sessions" :subtitle="`${sessions.length} sessions`">
          <template #icon>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </template>
          <div v-if="sessions.length > 0" class="table-container">
            <table class="sessions-table">
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
                  <td>{{ new Date(session.started_at).toLocaleString() }}</td>
                  <td>
                    <Badge variant="default" size="sm" pill>
                      {{ parseCourseCode(session.course_id).label }}
                    </Badge>
                  </td>
                  <td class="text-muted">
                    {{ session.duration_seconds ? formatDuration(session.duration_seconds / 60) : '—' }}
                  </td>
                  <td class="text-muted">{{ session.items_practiced || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-state">No sessions recorded.</div>
        </Card>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin-user-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 1200px;
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.breadcrumb-link {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: none;
  border: none;
  color: var(--ssi-red);
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  transition: all var(--transition-base);
}

.breadcrumb-link:hover {
  background: var(--bg-elevated);
}

.breadcrumb-separator {
  color: var(--text-muted);
}

.breadcrumb-current {
  color: var(--text-secondary);
  font-weight: var(--font-medium, 500);
}

/* Profile card */
.profile-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
}

.profile-avatar {
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold, 700);
  font-size: var(--text-lg);
  color: white;
  flex-shrink: 0;
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
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-bold, 700);
  margin: 0;
  color: var(--text-primary);
}

.profile-meta {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-top: var(--space-1);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.meta-dot {
  width: 3px;
  height: 3px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
  opacity: 0.5;
}

.profile-id {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: var(--text-xs);
  opacity: 0.6;
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
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.role-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.role-label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.role-select {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
}

.role-select:focus {
  outline: none;
  border-color: var(--ssi-red);
}

.role-status {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold, 600);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
}

.role-saved {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.1);
}

.role-error {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

/* Section */
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold, 600);
  margin: 0;
  color: var(--text-primary);
}

/* Buttons */
.btn-small {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-base);
}

.btn-small:hover {
  background: var(--bg-elevated);
  border-color: var(--ssi-red);
  color: var(--ssi-red);
}

.btn-grant {
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: var(--ssi-red);
  color: white;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold, 600);
  font-family: inherit;
  cursor: pointer;
  transition: opacity var(--transition-base);
}

.btn-grant:hover {
  opacity: 0.9;
}

.btn-grant:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-revoke {
  padding: var(--space-1) var(--space-2);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-sm);
  background: none;
  color: #ef4444;
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-base);
}

.btn-revoke:hover {
  background: rgba(239, 68, 68, 0.1);
}

/* Grant form */
.grant-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.grant-row {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.grant-label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.grant-input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  width: 80px;
}

.grant-input-wide {
  width: 100%;
}

.grant-input:focus {
  outline: none;
  border-color: var(--ssi-red);
}

/* Course cards */
.course-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
}

.course-card :deep(.card-body) {
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
}

.course-name {
  font-weight: var(--font-semibold, 600);
  color: var(--text-primary);
}

.course-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.course-stat {
  text-align: center;
}

.course-stat-value {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-bold, 700);
  color: var(--text-primary);
  line-height: 1.2;
}

.course-stat-label {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-top: var(--space-1);
}

.course-footer {
  font-size: var(--text-sm);
}

.course-last-active {
  color: var(--text-muted);
}

/* Sessions table */
.table-container {
  overflow-x: auto;
}

.sessions-table {
  width: 100%;
  border-collapse: collapse;
}

.sessions-table th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-medium);
}

.sessions-table td {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.sessions-table tbody tr {
  transition: background var(--transition-base);
}

.sessions-table tbody tr:hover {
  background: var(--bg-secondary);
}

.text-muted {
  color: var(--text-muted);
}

/* Error */
.error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--error-muted, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--error, rgba(239, 68, 68, 0.3));
  border-radius: var(--radius-lg);
  color: var(--error, #ef4444);
  font-size: var(--text-sm);
}

.error-banner svg {
  flex-shrink: 0;
  opacity: 0.8;
}

/* Loading */
.loading-state {
  text-align: center;
  padding: var(--space-12);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* Empty */
.empty-state {
  text-align: center;
  padding: var(--space-8);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* Responsive */
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
    flex-wrap: wrap;
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
}
</style>
